import * as THREE from 'three';
import { mulberry32 } from '../utils/math';
import { CONFIG } from '../config/config';

export type WaterThresholdOptions = {
  active: boolean;
  openness: number;
  gap: number;
  centre: THREE.Vector2;
  /** Actual forest terrain height, in world space. */
  floorY: number;
  /** Optional exact terrain sampler for sloping banks; coordinates are world metres. */
  groundAt?: (x: number, z: number) => number;
  /** Portal crossing progress, 0 before crossing and 0…1 during it. */
  crossing: number;
};

const CAPACITY = 168;
const COLUMNS = 10;
const ROWS = 20;
const RIPPLE_SEGMENTS = 12;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A small, physical spill from the forest's underwater tear. The effect lives
 * in the overlay scene, deliberately without the portal stencil: water has
 * crossed into the forest. It copies position/yaw, NEVER the swallow scale.
 * All pools and geometries are fixed-size; neither camera nor hands are moved.
 */
export class WaterThreshold {
  readonly root = new THREE.Group();
  private readonly sheet: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly impact: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions = new Float32Array(CAPACITY * 3);
  private readonly velocities = new Float32Array(CAPACITY * 3);
  private readonly lives = new Float32Array(CAPACITY * 2);
  private readonly sizes = new Float32Array(CAPACITY);
  private readonly kinds = new Float32Array(CAPACITY); // 0 falling water, 1 foam, 2 bubbles
  private readonly worldPosition = new THREE.Vector3();
  private readonly worldRotation = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private rng = mulberry32(6047);
  private cursor = 0;
  private emission = 0;
  private bubbleEmission = 0;
  private elapsed = 0;
  private opacity = 0;
  private width = 0;
  private floor = 0;
  private drop = 0;
  private reach = 0;
  private yawSin = 0;
  private yawCos = 1;
  private groundAt?: (x: number, z: number) => number;
  private readonly landingHeights = new Float32Array(COLUMNS + 1);
  private readonly geometryState = new Float64Array(10).fill(NaN);
  private readonly nextGeometryState = new Float64Array(10);

  constructor(overlay: THREE.Scene) {
    this.root.name = 'Water crossing the forest threshold';
    this.root.visible = false;
    const sheetMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.z += sin(uv.x * 32.0 + uv.y * 12.0 - uTime * 4.2)
            * sin(uv.y * 3.14159) * 0.013;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOpacity; varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.10, vUv.x) * (1.0 - smoothstep(0.90, 1.0, vUv.x));
          float threads = pow(0.5 + 0.5 * sin(vUv.x * 64.0 + sin(vUv.y * 8.0 - uTime * 2.0)), 8.0);
          float current = 0.5 + 0.5 * sin(vUv.y * 37.0 + uTime * 8.0 + sin(vUv.x * 17.0));
          float crest = pow(current, 12.0) * 0.12;
          float alpha = edge * (0.13 + threads * 0.25 + crest) * uOpacity;
          alpha *= smoothstep(0.0, 0.055, vUv.y);
          gl_FragColor = vec4(mix(vec3(0.06, 0.44, 0.54), vec3(0.72, 0.96, 0.97), threads * 0.65 + crest), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, COLUMNS, ROWS), sheetMaterial);
    this.sheet.name = 'Flowing water curtain';
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = -3;

    const impactMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uOpacity; varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float radius = length(p);
          if (radius > 1.0) discard;
          float ring = pow(0.5 + 0.5 * sin(radius * 31.0 - uTime * 3.8), 18.0);
          float fade = (1.0 - smoothstep(0.24, 1.0, radius)) * smoothstep(0.04, 0.20, radius);
          float foam = (1.0 - smoothstep(0.02, 0.32, radius)) * 0.20;
          gl_FragColor = vec4(0.55, 0.87, 0.90, (ring * fade * 0.22 + foam) * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
    this.impact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, RIPPLE_SEGMENTS, RIPPLE_SEGMENTS), impactMaterial);
    this.impact.name = 'Fading water impact ripples';
    this.impact.frustumCulled = false;
    this.impact.renderOrder = -4;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('life', new THREE.BufferAttribute(this.lives, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('kind', new THREE.BufferAttribute(this.kinds, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      transparent: true, depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec2 life; attribute float size; attribute float kind;
        varying float vAlpha; varying float vKind;
        void main() {
          float t = life.y > 0.0 ? clamp(life.x / life.y, 0.0, 1.0) : 1.0;
          vAlpha = life.y > 0.0 ? smoothstep(0.0, 0.08, t) * (1.0 - t) : 0.0;
          vKind = kind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * 390.0 / max(-mv.z, 0.1), 1.0, 19.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying float vAlpha; varying float vKind;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0 || vAlpha <= 0.0) discard;
          float soft = 1.0 - smoothstep(0.35, 1.0, d);
          float bubble = smoothstep(0.42, 0.69, d) * (1.0 - smoothstep(0.79, 1.0, d));
          float shape = vKind > 1.5 ? bubble * 0.60 : soft * 0.72;
          gl_FragColor = vec4(mix(vec3(0.46, 0.83, 0.91), vec3(0.87, 0.98, 0.98), step(0.5, vKind)), shape * vAlpha * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    this.points.name = 'Threshold droplets foam and crossing bubbles';
    this.points.frustumCulled = false;
    this.points.renderOrder = -2;
    this.root.add(this.sheet, this.impact, this.points);
    overlay.add(this.root);
  }

  update(_time: number, dt: number, anchor: THREE.Object3D, options: WaterThresholdOptions) {
    const openness = finiteClamp(options.openness, 0, 1);
    const gap = finiteClamp(options.gap, 0, 1.25);
    const crossing = finiteClamp(options.crossing, 0, 1);
    if (!options.active || openness < 0.012 || gap < 0.01 || crossing >= 0.72 ||
      !Number.isFinite(options.floorY) || !Number.isFinite(options.centre.x) || !Number.isFinite(options.centre.y)) {
      this.reset();
      return;
    }
    // Lost XR focus freezes every animation, emission and geometry update.
    // _time is deliberately not used: resuming never advances by wall time.
    const step = finiteClamp(dt, 0, 0.05);
    if (step === 0) return;

    anchor.updateWorldMatrix(true, false);
    anchor.getWorldPosition(this.worldPosition);
    anchor.getWorldQuaternion(this.worldRotation);
    this.forward.set(0, 0, 1).applyQuaternion(this.worldRotation);
    this.root.position.copy(this.worldPosition);
    const yaw = Math.atan2(this.forward.x, this.forward.z);
    this.root.quaternion.setFromAxisAngle(UP, yaw);
    this.yawSin = Math.sin(yaw);
    this.yawCos = Math.cos(yaw);
    this.root.scale.setScalar(1);
    const groundChanged = this.groundAt !== options.groundAt;
    this.groundAt = options.groundAt;
    this.floor = options.floorY - this.worldPosition.y;
    this.reach = 0.22 + openness * 0.45;
    this.floor = this.terrainHeight(options.centre.x, this.reach + 0.025);
    const emitterY = options.centre.y;
    this.drop = emitterY - this.floor - 0.018;
    // Below-ground and implausibly high sources must not produce a giant sheet.
    if (this.drop <= 0.025 || this.drop > 4) { this.reset(); return; }

    this.elapsed += step;
    const target = THREE.MathUtils.smoothstep(openness, 0.012, 0.38)
      * (1 - THREE.MathUtils.smoothstep(crossing, 0.12, 0.70));
    this.opacity += (target - this.opacity) * (1 - Math.exp(-step * 8));
    this.width = Math.min(gap, openness * CONFIG.tear.fullyOpenGap, 1.0625) * 0.64;
    this.root.visible = this.opacity > 0.002;
    // Rebuild terrain contacts only when the seam, terrain transform or opening
    // changes. The flow itself animates on the GPU; a held tear costs no repeated
    // grid sampling and does not allocate a new mesh or array each frame.
    const state = this.nextGeometryState;
    state[0] = this.worldPosition.x; state[1] = this.worldPosition.y; state[2] = this.worldPosition.z;
    state[3] = yaw; state[4] = options.centre.x; state[5] = options.centre.y;
    state[6] = this.width; state[7] = this.reach; state[8] = this.floor; state[9] = options.floorY;
    let dirty = groundChanged;
    for (let i = 0; i < state.length; i++) if (state[i] !== this.geometryState[i]) dirty = true;
    if (dirty) {
      this.geometryState.set(state);
      this.updateGeometry(options.centre.x, emitterY);
    }
    this.sheet.material.uniforms.uTime.value = this.elapsed;
    this.sheet.material.uniforms.uOpacity.value = this.opacity;
    this.impact.material.uniforms.uTime.value = this.elapsed;
    this.impact.material.uniforms.uOpacity.value = this.opacity;
    this.points.material.uniforms.uOpacity.value = this.opacity;

    this.emission += step * (18 + openness * 46) * this.opacity;
    while (this.emission >= 1) {
      this.emission--;
      this.spawn(0, options.centre.x + (this.rng() - 0.5) * this.width * 0.85, emitterY, 0.028);
    }
    if (crossing > 0) {
      this.bubbleEmission += step * 85 * Math.sin(crossing * Math.PI) * this.opacity;
      while (this.bubbleEmission >= 1) {
        this.bubbleEmission--;
        this.spawn(2, options.centre.x + (this.rng() - 0.5) * this.width, emitterY - this.rng() * Math.min(this.drop, 0.55), 0.04 + this.rng() * 0.14);
      }
    }
    for (let i = 0; i < CAPACITY; i++) {
      if (this.lives[i * 2 + 1] <= 0) continue;
      const age = this.lives[i * 2] += step;
      if (age >= this.lives[i * 2 + 1]) { this.lives[i * 2 + 1] = 0; continue; }
      const j = i * 3;
      if (this.kinds[i] < 1.5) this.velocities[j + 1] -= 3.6 * step;
      this.positions[j] += this.velocities[j] * step;
      this.positions[j + 1] += this.velocities[j + 1] * step;
      this.positions[j + 2] += this.velocities[j + 2] * step;
      const particleFloor = this.terrainHeight(this.positions[j], this.positions[j + 2]);
      if (this.positions[j + 1] < particleFloor + 0.025) {
        this.positions[j + 1] = particleFloor + 0.025;
        if (this.kinds[i] === 0) {
          this.kinds[i] = 1;
          this.velocities[j] *= 2;
          this.velocities[j + 1] = 0.16 + this.rng() * 0.28;
          this.velocities[j + 2] *= 0.2;
          this.sizes[i] *= 1.3;
          this.lives[i * 2] = 0;
          this.lives[i * 2 + 1] = 0.22 + this.rng() * 0.23;
        } else this.lives[i * 2 + 1] = 0;
      }
    }
    this.markParticlesDirty();
  }

  private terrainHeight(x: number, z: number) {
    if (!this.groundAt) return this.floor;
    const height = this.groundAt(
      this.worldPosition.x + x * this.yawCos + z * this.yawSin,
      this.worldPosition.z - x * this.yawSin + z * this.yawCos
    );
    return Number.isFinite(height) ? height - this.worldPosition.y : this.floor;
  }

  private updateGeometry(centreX: number, emitterY: number) {
    const position = this.sheet.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let column = 0; column <= COLUMNS; column++) {
      const x = centreX + (column / COLUMNS - 0.5) * this.width * 1.68;
      this.landingHeights[column] = this.terrainHeight(x, this.reach + 0.025) + 0.018;
    }
    for (let row = 0; row <= ROWS; row++) {
      const t = row / ROWS;
      const z = 0.025 + this.reach * Math.sin(t * Math.PI / 2);
      for (let column = 0; column <= COLUMNS; column++) {
        const x = centreX + (column / COLUMNS - 0.5) * this.width * (1 + 0.68 * t);
        const y = emitterY + (this.landingHeights[column] - emitterY) * Math.pow(t, 1.24);
        position.setXYZ(row * (COLUMNS + 1) + column, x, y, z);
      }
    }
    position.needsUpdate = true;
    const ripple = this.impact.geometry.getAttribute('position') as THREE.BufferAttribute;
    const width = 0.65 + this.width * 1.9, depth = 0.64 + this.width * 1.25;
    this.impact.position.set(centreX, this.floor + 0.021, this.reach + 0.025);
    for (let row = 0; row <= RIPPLE_SEGMENTS; row++) for (let column = 0; column <= RIPPLE_SEGMENTS; column++) {
      const x = (column / RIPPLE_SEGMENTS - 0.5) * width;
      const z = (row / RIPPLE_SEGMENTS - 0.5) * depth;
      const y = this.terrainHeight(centreX + x, this.reach + 0.025 + z) - this.floor;
      ripple.setXYZ(row * (RIPPLE_SEGMENTS + 1) + column, x, y, z);
    }
    ripple.needsUpdate = true;
  }

  private markParticlesDirty() {
    const attributes = this.points.geometry.attributes;
    attributes.position.needsUpdate = true;
    attributes.life.needsUpdate = true;
    attributes.size.needsUpdate = true;
    attributes.kind.needsUpdate = true;
  }

  private spawn(kind: number, x: number, y: number, z: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % CAPACITY;
    const j = i * 3;
    this.positions[j] = x;
    this.positions[j + 1] = y;
    this.positions[j + 2] = z;
    this.velocities[j] = (this.rng() - 0.5) * (kind === 2 ? 0.09 : 0.17);
    this.velocities[j + 1] = kind === 2 ? 0.28 + this.rng() * 0.45 : -0.08 - this.rng() * 0.22;
    this.velocities[j + 2] = kind === 2 ? 0.12 + this.rng() * 0.16 : this.reach / Math.sqrt(2 * this.drop / 3.6);
    this.lives[i * 2] = 0;
    this.lives[i * 2 + 1] = kind === 2 ? 0.8 + this.rng() * 0.6 : 1.75;
    this.sizes[i] = kind === 2 ? 0.032 + this.rng() * 0.043 : 0.016 + this.rng() * 0.022;
    this.kinds[i] = kind;
  }

  reset() {
    if (!this.root.visible && this.elapsed === 0 && this.opacity === 0) return;
    this.root.visible = false;
    this.opacity = this.elapsed = this.emission = this.bubbleEmission = this.cursor = 0;
    this.width = this.drop = this.reach = this.floor = 0;
    this.groundAt = undefined;
    this.geometryState.fill(NaN);
    this.lives.fill(0);
    this.positions.fill(0);
    this.velocities.fill(0);
    this.sizes.fill(0);
    this.kinds.fill(0);
    this.rng = mulberry32(6047);
    for (const material of [this.sheet.material, this.impact.material, this.points.material]) material.uniforms.uOpacity.value = 0;
    this.sheet.material.uniforms.uTime.value = this.impact.material.uniforms.uTime.value = 0;
    this.markParticlesDirty();
  }

  /** Snapshot for geometric/behavioural QA, never used by the animation loop. */
  get diagnostics() {
    let alive = 0, bubbles = 0, foam = 0;
    for (let i = 0; i < CAPACITY; i++) if (this.lives[i * 2 + 1] > 0) {
      alive++;
      if (this.kinds[i] === 2) bubbles++;
      if (this.kinds[i] === 1) foam++;
    }
    return { capacity: CAPACITY, alive, bubbles, foam, elapsed: this.elapsed,
      opacity: this.opacity, width: this.width, floorLocalY: this.floor,
      sheetVertices: this.sheet.geometry.getAttribute('position').count };
  }
}

function finiteClamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, min, max) : min;
}
