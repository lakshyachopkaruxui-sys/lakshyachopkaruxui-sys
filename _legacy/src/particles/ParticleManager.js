import * as THREE from 'three';
import { createSoftDotTexture } from '../utils/proceduralTextures.js';
import { CONFIG } from '../config/config.js';

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, tex.a * vAlpha);
  }
`;

let sharedDotTexture = null;

// Sparse leakage particles (dust/light motes/fibres) drifting out of the
// tear toward the viewer — brief: "the leakage should feel accidental...
// Particle density should respond to tear energy." One pool per veil,
// small enough (see CONFIG.particles) to stay well within the project's
// overall particle budget even with all three veils loaded at once.
export class ParticleManager {
  constructor(veilAnchor, color, poolSize = 70) {
    if (!sharedDotTexture) sharedDotTexture = createSoftDotTexture(32);

    this.poolSize = poolSize;
    this.positions = new Float32Array(poolSize * 3);
    this.sizes = new Float32Array(poolSize);
    this.alphas = new Float32Array(poolSize);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uMap: { value: sharedDotTexture }, uColor: { value: color.clone() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    veilAnchor.add(this.points);

    this._data = Array.from({ length: poolSize }, () => ({
      alive: false,
      age: 0,
      life: 1,
      vx: 0, vy: 0, vz: 0,
      size: 0.01
    }));
    this._spawnAccumulator = 0;
  }

  update(dt, signal) {
    const spawnRate = CONFIG.particles.spawnPerTearEnergy * (0.15 + signal.energy) * THREE.MathUtils.smoothstep(signal.openAmount, 0.02, 0.3);
    this._spawnAccumulator += spawnRate * dt;

    while (this._spawnAccumulator >= 1) {
      this._spawnAccumulator -= 1;
      this._spawnOne(signal);
    }

    for (let i = 0; i < this.poolSize; i++) {
      const p = this._data[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        this.alphas[i] = 0;
        continue;
      }
      this.positions[i * 3] += p.vx * dt;
      this.positions[i * 3 + 1] += p.vy * dt;
      this.positions[i * 3 + 2] += p.vz * dt;

      const lifeT = p.age / p.life;
      this.alphas[i] = Math.sin(Math.PI * lifeT) * 0.8;
      this.sizes[i] = p.size * (0.6 + lifeT * 0.6);
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  setColor(color) {
    this.material.uniforms.uColor.value.copy(color);
  }

  _spawnOne(signal) {
    const idx = this._data.findIndex((p) => !p.alive);
    if (idx === -1) return;
    const p = this._data[idx];

    const a = THREE.MathUtils.lerp(0.01, 0.55, signal.openAmount);
    const b = THREE.MathUtils.lerp(0.01, 0.34, signal.openAmount);
    const angle = Math.random() * Math.PI * 2;
    const ca = Math.cos(signal.directionAngle), sa = Math.sin(signal.directionAngle);
    const ex = Math.cos(angle) * a * (0.7 + Math.random() * 0.3);
    const ey = Math.sin(angle) * b * (0.7 + Math.random() * 0.3);
    const x = signal.centerLocal.x + ex * ca - ey * sa;
    const y = signal.centerLocal.y + ex * sa + ey * ca;

    this.positions[idx * 3] = x;
    this.positions[idx * 3 + 1] = y;
    this.positions[idx * 3 + 2] = 0.02;

    p.alive = true;
    p.age = 0;
    p.life = 1.4 + Math.random() * 1.6;
    p.vx = (Math.random() - 0.5) * 0.04;
    p.vy = (Math.random() - 0.5) * 0.04 + 0.015;
    p.vz = 0.05 + Math.random() * 0.09 + signal.energy * 0.05;
    p.size = 0.006 + Math.random() * 0.01;
  }
}
