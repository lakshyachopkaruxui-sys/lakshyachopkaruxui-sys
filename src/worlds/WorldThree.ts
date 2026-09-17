import * as THREE from 'three';
import { mulberry32 } from '../utils/math';
import { dotTexture } from '../utils/sprites';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { surfaceMaps } from './nature';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { fitProp, measureProp } from './props';
import { WorldWatcher, type WatcherCover } from './WorldWatcher';

/** A single closed island: triangulated landing, rounded rim and stone underside. */
export class IslandSurface {
  readonly geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private edge: number[] = [];

  constructor(readonly radius: number, depth: number, seed: number, readonly rings = 44, readonly sectors = 128) {
    const p: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
    const sage = new THREE.Color(0xb2a4c3), rim = new THREE.Color(0x988aaa), rock = new THREE.Color(0x9b90af);
    const c = new THREE.Color();
    const profile = (a: number) => radius * (1 + 0.026 * Math.sin(a * 3 + seed) + 0.012 * Math.sin(a * 7 - seed * 0.3));
    const topY = (x: number, z: number, r: number) => {
      const landing = THREE.MathUtils.smoothstep(Math.hypot(x, z - 2), 2.3, 5.5);
      const waves = 0.17 * Math.sin(x * 0.32 + seed) * Math.cos(z * 0.25) + 0.12 * Math.sin(z * 0.4 + x * 0.13);
      const berm = 0.28 * Math.exp(-Math.pow((r - 0.78) / 0.16, 2));
      return 0.035 + waves * landing + berm - 0.4 * Math.pow(r, 8);
    };
    const add = (x: number, y: number, z: number, color: THREE.Color) => {
      p.push(x, y, z); colors.push(color.r, color.g, color.b); uv.push(x / radius / 2 + 0.5, z / radius / 2 + 0.5);
    };
    c.copy(sage); add(0, topY(0, 0, 0), 0, c);
    for (let ring = 1; ring <= rings; ring++) {
      const r = ring / rings;
      for (let j = 0; j < sectors; j++) {
        const a = j / sectors * Math.PI * 2;
        const x = Math.cos(a) * profile(a) * r, z = Math.sin(a) * profile(a) * r;
        const shade = 0.94 + 0.055 * Math.sin(x * 0.56) * Math.cos(z * 0.39) + 0.035 * Math.sin(z * 1.1 + x * 0.3);
        c.copy(sage).lerp(rim, THREE.MathUtils.smoothstep(r, 0.84, 1) * 0.82).multiplyScalar(shade);
        add(x, topY(x, z, r), z, c);
        if (ring === rings) this.edge.push(p.length / 3 - 1);
      }
    }
    for (let j = 0; j < sectors; j++) indices.push(0, 1 + (j + 1) % sectors, 1 + j);
    const connect = (inner: number, outer: number) => {
      for (let j = 0; j < sectors; j++) {
        const next = (j + 1) % sectors;
        const a = inner + j, b = inner + next, c = outer + j, d = outer + next;
        indices.push(a, d, c, a, b, d);
      }
    };
    for (let ring = 1; ring < rings; ring++) connect(1 + (ring - 1) * sectors, 1 + ring * sectors);
    const topIndexCount = indices.length;
    // A rounded shoulder and irregular, downward taper. Shared boundary
    // vertices make this continuous with the top rather than a disc on a cone.
    const levels = [[1.008, 0.035], [0.996, 0.10], [0.96, 0.19], [0.885, 0.34], [0.74, 0.54], [0.54, 0.74], [0.31, 0.89], [0.13, 0.965], [0.045, 0.995]];
    let previous = 1 + (rings - 1) * sectors;
    for (let row = 0; row < levels.length; row++) {
      const [scale, drop] = levels[row];
      const start = p.length / 3;
      for (let j = 0; j < sectors; j++) {
        const a = j / sectors * Math.PI * 2;
        const shape = 1 + Math.sin(row / (levels.length - 1) * Math.PI) * (0.032 * Math.sin(a * 5 + row * 0.58 + seed) + 0.012 * Math.sin(a * 11));
        const x = Math.cos(a) * profile(a) * scale * shape + radius * 0.075 * drop * drop;
        const z = Math.sin(a) * profile(a) * scale * shape - radius * 0.035 * drop * drop;
        const edgeY = p[this.edge[j] * 3 + 1];
        const y = edgeY * (1 - drop) - depth * drop + Math.sin(a * 4 + seed) * 0.08 * Math.sin(drop * Math.PI);
        c.copy(rim).lerp(rock, Math.min(1, drop * 1.7)).multiplyScalar(0.96 + 0.05 * Math.sin(a * 3 + drop * 8));
        add(x, y, z, c);
      }
      connect(previous, start); previous = start;
    }
    const bottom = p.length / 3;
    add(radius * 0.075, -depth * 1.015, -radius * 0.035, rock);
    for (let j = 0; j < sectors; j++) indices.push(previous + j, previous + (j + 1) % sectors, bottom);
    this.positions = new Float32Array(p);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.geometry.setIndex(indices);
    this.geometry.addGroup(0, topIndexCount, 0);
    this.geometry.addGroup(topIndexCount, indices.length - topIndexCount, 1);
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /** Exact barycentric height on the rendered top triangles, not an analytic approximation. */
  heightAt(x: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return this.positions[1];
    if (Math.hypot(x, z) < 1e-8) return this.positions[1];
    let angle = Math.atan2(z, x);
    if (angle < 0) angle += Math.PI * 2;
    const j = Math.min(this.sectors - 1, Math.floor(angle / (Math.PI * 2) * this.sectors));
    const next = (j + 1) % this.sectors;
    const a = this.edge[j] * 3, b = this.edge[next] * 3;
    const ax = this.positions[a], az = this.positions[a + 2], bx = this.positions[b], bz = this.positions[b + 2];
    const det = ax * bz - az * bx;
    let fraction = (x * bz - z * bx + ax * z - az * x) / det;
    if (fraction >= 1) {
      const scale = (1 - 1e-7) / fraction;
      x *= scale; z *= scale; fraction = 1 - 1e-7;
    }
    const ring = Math.floor(fraction * this.rings);
    if (ring < 1) return this.interpolate(x, z, 0, 1 + next, 1 + j).height;
    const innerA = 1 + (ring - 1) * this.sectors + j;
    const innerB = 1 + (ring - 1) * this.sectors + next;
    const outerA = 1 + ring * this.sectors + j;
    const outerB = 1 + ring * this.sectors + next;
    const first = this.interpolate(x, z, innerA, outerB, outerA);
    return first.inside ? first.height : this.interpolate(x, z, innerA, innerB, outerB).height;
  }

  private interpolate(x: number, z: number, a: number, b: number, c: number) {
    const p = this.positions;
    a *= 3; b *= 3; c *= 3;
    const det = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
    const wa = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / det;
    const wb = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / det;
    const wc = 1 - wa - wb;
    return { height: wa * p[a + 1] + wb * p[b + 1] + wc * p[c + 1], inside: wa >= -1e-6 && wb >= -1e-6 && wc >= -1e-6 };
  }
}

export interface DriftIsland {
  root: THREE.Group;
  surface: THREE.Mesh;
  terrain: IslandSurface;
}

/** The Drift: a silent violet dimension where the stars fall upward. */
export class WorldThree {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly leakColor = new THREE.Color(0xa58bda);
  readonly soundSpots = { drone: new THREE.Vector3(0, 5, -18), chimes: new THREE.Vector3(-7, 2, -8), near: new THREE.Vector3(0, 1, -0.6) };
  readonly leanDetails: THREE.MeshBasicMaterial[] = [];
  readonly islands: DriftIsland[] = [];
  readonly groundAttachments: { object: THREE.Object3D; instance?: number; island: number }[] = [];
  readonly watcher: WorldWatcher;
  readonly ready: Promise<void>;
  readonly jellies: { root: THREE.Group; model: THREE.Object3D; mixer: THREE.AnimationMixer; base: THREE.Vector3; rate: number; phase: number; duration: number }[] = [];
  stencilLayer = 1;
  private drifters: { root: THREE.Group; y: number; phase: number }[] = [];
  private skyUniforms = { uTime: { value: 0 } };
  private rising: THREE.Points;
  private starBase = new Float32Array(450 * 3);
  private starSpeed = new Float32Array(450);
  private sample = new THREE.Vector3();
  private alignmentDirection = new THREE.Vector3();
  private alignmentQuaternion = new THREE.Quaternion();
  private rng = mulberry32(77);
  // All secondary stone props share these GPU textures; varying their tint
  // and normal strength does not require another copy of the same image set.
  private detailMaps = surfaceMaps('rock', 1.5);
  private growthGeo = this.frondGeometry();
  private crystalMaterial = new THREE.MeshStandardMaterial({ color: 0x9fa9ce, emissive: 0x373660, emissiveIntensity: 0.34, roughness: 0.40, metalness: 0.05 });

  constructor(origin: THREE.Vector3) {
    this.root.position.set(origin.x, 0, origin.z);
    this.scene.add(this.root);
    this.scene.fog = new THREE.Fog(0x44345c, 35, 115);
    this.buildSky();
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, ...surfaceMaps('rock', 8), normalScale: new THREE.Vector2(0.43, 0.43) });
    const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, ...surfaceMaps('rock', 5), normalScale: new THREE.Vector2(0.32, 0.32) });
    const materials = [groundMat, stoneMat];
    this.addIsland(14.5, 8.4, new THREE.Vector3(0, 0, -2), 2.1, materials, true);
    const distant = [
      { p: [-25, 1.9, -29], r: 7.2, d: 5.8, seed: 3.5 },
      { p: [26, 4, -37], r: 8.4, d: 6.4, seed: 5.2 },
      { p: [-3, 6.2, -60], r: 10.5, d: 7.6, seed: 7 },
      { p: [-32, -2, 18], r: 7.8, d: 6, seed: 9.1 }
    ];
    for (const d of distant) {
      const island = this.addIsland(d.r, d.d, new THREE.Vector3(...d.p as [number, number, number]), d.seed, materials, false);
      this.drifters.push({ root: island.root, y: island.root.position.y, phase: d.seed });
    }
    this.buildLights();
    this.rising = this.buildUpwardStars();
    const covers = this.buildObserverStones();
    const home = this.islands[0];
    this.watcher = new WorldWatcher(home.root, covers, (x, z) => home.terrain.heightAt(x, z), () => this.stencilLayer);
    this.ready = Promise.all([this.loadJellies(), this.watcher.ready]).then(() => {});
    this.refreshStencil();
  }

  refreshStencil() { applyStencilLayer(this.scene, this.stencilLayer); }

  alignTo(anchor: THREE.Object3D) {
    anchor.getWorldPosition(this.sample);
    anchor.getWorldQuaternion(this.alignmentQuaternion);
    this.alignmentDirection.set(0, 0, 1).applyQuaternion(this.alignmentQuaternion);
    this.root.position.set(this.sample.x, 0, this.sample.z);
    // Rotate the whole composition together, including the observer's cover
    // and sounds, while preserving a level landing beneath the participant.
    this.root.rotation.set(0, Math.atan2(this.alignmentDirection.x, this.alignmentDirection.z), 0);
    this.root.updateMatrixWorld(true);
  }

  groundAt(worldX: number, worldZ: number) {
    this.root.updateWorldMatrix(true, false);
    this.sample.set(worldX, this.root.getWorldPosition(new THREE.Vector3()).y, worldZ);
    this.root.worldToLocal(this.sample);
    const home = this.islands[0];
    this.sample.y = home.terrain.heightAt(this.sample.x - home.root.position.x, this.sample.z - home.root.position.z) + home.root.position.y;
    return this.root.localToWorld(this.sample).y;
  }

  get walkBounds() {
    this.root.updateWorldMatrix(true, false);
    return { center: this.root.localToWorld(new THREE.Vector3(0, 0, -2)), radius: 8 };
  }

  get nextSeamHint() {
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(new THREE.Vector3(0, this.islands[0].terrain.heightAt(0, 2), 0));
  }

  updateView(viewerPosition: THREE.Vector3, viewerForward: THREE.Vector3, active: boolean, dt: number) {
    this.watcher.update(viewerPosition, viewerForward, active, dt);
  }

  consumeReturnHint() { return this.watcher.consumeReturnHint(); }

  private addIsland(radius: number, depth: number, position: THREE.Vector3, seed: number, materials: THREE.Material[], home: boolean) {
    const terrain = new IslandSurface(radius, depth, seed, home ? 44 : 18, home ? 128 : 80);
    const root = new THREE.Group(); root.position.copy(position);
    root.name = home ? 'quiet landing in the drift' : 'distant suspended stone';
    const surface = new THREE.Mesh(terrain.geometry, materials);
    surface.name = 'continuous closed island'; surface.receiveShadow = true;
    root.add(surface); this.root.add(root);
    const island = { root, surface, terrain };
    this.islands.push(island);
    this.plantStrangeGrowth(this.islands.length - 1, home, seed);
    this.placeStones(this.islands.length - 1, home ? 12 : 5, mulberry32(Math.round(seed * 99)));
    if (home || this.islands.length < 4) this.buildBentBasalt(this.islands.length - 1, home);
    if (home) this.buildMinerals(this.islands.length - 1);
    return island;
  }

  private frondGeometry() {
    const geometry = new THREE.SphereGeometry(1, 12, 18);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = (p.getY(i) + 1) / 2;
      const width = p.getX(i) * 0.14 * Math.pow(Math.max(0, Math.sin(y * Math.PI)), 0.35);
      const twist = y * 2.4;
      // A closed waxy blade curls back toward itself; it does not resemble
      // normal grass, a flowering stalk, or a camera-facing plant card.
      const bend = y * 2.35;
      p.setXYZ(i, Math.cos(twist) * width + Math.sin(bend) * 0.16,
        y - Math.pow(y, 5) * 0.16,
        Math.sin(twist) * width + p.getZ(i) * 0.022 + (1 - Math.cos(bend)) * 0.22);
    }
    geometry.computeVertexNormals(); return geometry;
  }

  private plantStrangeGrowth(index: number, home: boolean, seed: number) {
    const island = this.islands[index], random = mulberry32(Math.round(seed * 107));
    const clusters = home ? 34 : 12;
    const growth = new THREE.InstancedMesh(this.growthGeo, new THREE.MeshStandardMaterial({ color: 0x70688c, roughness: 0.61, emissive: 0x171026, emissiveIntensity: 0.10 }), clusters * 5);
    growth.name = 'rooted curling alien fronds';
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let i = 0; i < clusters; i++) {
      const a = i * 2.399 + seed;
      const foreground = home && i >= 20;
      const bed = i % 2 === 0 ? [-3.2, -2.3] : [3.7, -4.0];
      const d = foreground ? 0.25 + random() * 0.72 : island.terrain.radius * (0.64 + random() * 0.22);
      const x = foreground ? bed[0] + Math.cos(a) * d : Math.cos(a) * d;
      const z = foreground ? bed[1] + Math.sin(a) * d : Math.sin(a) * d;
      const base = new THREE.Vector3(x, island.terrain.heightAt(x, z), z);
      const height = foreground ? 0.42 + random() * 0.35 : 0.75 + random() * 1.0;
      for (let k = 0; k < 5; k++) {
        rotation.setFromEuler(new THREE.Euler(0.10 + random() * 0.28, a + k * 1.257, 0, 'YXZ'));
        const h = height * (0.72 + random() * 0.35);
        growth.setMatrixAt(i * 5 + k, matrix.compose(base, rotation, scale.set(h * 0.9, h, h)));
        growth.setColorAt(i * 5 + k, new THREE.Color().setHSL(0.67 + random() * 0.07, 0.12, 0.72 + random() * 0.18));
        this.groundAttachments.push({ object: growth, instance: i * 5 + k, island: index });
      }
    }
    growth.instanceMatrix.needsUpdate = true;
    if (growth.instanceColor) growth.instanceColor.needsUpdate = true;
    growth.computeBoundingSphere(); island.root.add(growth);
  }

  private stoneGeometry() {
    const geometry = new THREE.SphereGeometry(1, 22, 16);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.09 * Math.sin(x * 4 + z * 3) * Math.cos(y * 5) + 0.025 * Math.sin(z * 8);
      p.setXYZ(i, x * k, (y + 1) / 2, z * k * 0.8);
    }
    geometry.computeVertexNormals(); return geometry;
  }

  private placeStones(index: number, count: number, random: () => number) {
    const island = this.islands[index];
    const stones = new THREE.InstancedMesh(this.stoneGeometry(), new THREE.MeshStandardMaterial({ color: 0x777287, roughness: 0.95, ...this.detailMaps, normalScale: new THREE.Vector2(0.25, 0.25) }), count);
    stones.name = 'grounded strange weathered stones';
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = i * 2.399 + index, d = island.terrain.radius * (0.76 + random() * 0.12);
      const x = Math.cos(a) * d, z = Math.sin(a) * d, size = 0.40 + random() * 0.65;
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a);
      stones.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, island.terrain.heightAt(x, z), z), rotation, scale.set(size * 1.05, size * 0.9, size)));
      this.groundAttachments.push({ object: stones, instance: i, island: index });
    }
    stones.instanceMatrix.needsUpdate = true; stones.computeBoundingSphere(); island.root.add(stones);
  }

  private buildObserverStones() {
    const home = this.islands[0], covers: WatcherCover[] = [];
    const locations = [[-11.2, 4.0, 0.95], [11.2, 4.0, 0.95], [-3.8, -3.2, 0.85], [4.9, -6.3, 0.92], [-6.8, 1.4, 0.83], [6.5, 3.0, 0.9], [-2.2, -9.4, 0.86], [6.3, -10, 0.9]];
    const material = new THREE.MeshStandardMaterial({ color: 0x938698, roughness: 0.95, ...this.detailMaps, normalScale: new THREE.Vector2(0.32, 0.32) });
    const geometry = this.stoneGeometry();
    for (const [x, z, height] of locations) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'observer cover stone';
      mesh.position.set(x, home.terrain.heightAt(x, z), z);
      mesh.scale.set(0.95, height, 0.9);
      home.root.add(mesh);
      this.groundAttachments.push({ object: mesh, island: 0 });
      covers.push({ position: mesh.position.clone(), radius: 0.86, height, mesh });
    }
    return covers;
  }

  private buildBentBasalt(index: number, home: boolean) {
    const island = this.islands[index];
    const material = new THREE.MeshStandardMaterial({ color: 0x716b83, roughness: 0.91, ...this.detailMaps, normalScale: new THREE.Vector2(0.33, 0.33) });
    const positions = home ? [[-10.6, -3.4, 2.6], [8.8, -7.1, 3.0]] : [[index === 1 ? -2.4 : 2.4, -1.3, 3.2]];
    for (const [x, z, height] of positions) {
      // An eroded column bends and twists against gravity. Its base is a
      // closed surface at Y=0; the thin tip never becomes a simple cone.
      const geometry = new THREE.CylinderGeometry(0.16, 0.34, 1, 18, 20);
      geometry.translate(0, 0.5, 0);
      const vertices = geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const y = vertices.getY(i), a = y * 2.2;
        const px = vertices.getX(i), pz = vertices.getZ(i);
        vertices.setXYZ(i, px * Math.cos(a) - pz * Math.sin(a) + Math.sin(y * 2.8) * 0.68,
          y * height, px * Math.sin(a) + pz * Math.cos(a) + Math.pow(y, 2) * 0.48);
      }
      geometry.computeVertexNormals();
      const spire = new THREE.Mesh(geometry, material);
      spire.name = 'bent basalt anomaly';
      spire.position.set(x, island.terrain.heightAt(x, z), z);
      spire.rotation.y = x < 0 ? -0.5 : 0.9;
      island.root.add(spire);
      this.groundAttachments.push({ object: spire, island: index });
    }
  }

  private buildMinerals(index: number) {
    const island = this.islands[index];
    for (let i = 0; i < 5; i++) {
      const height = 0.25 + i % 3 * 0.14;
      const geometry = new THREE.CylinderGeometry(0.035, 0.06, height, 7);
      geometry.translate(0, height / 2, 0);
      const crystal = new THREE.Mesh(geometry, this.crystalMaterial);
      crystal.name = 'dim mineral seam';
      const x = -7.9 - i * 0.15, z = -6.2 + i * 0.16;
      crystal.position.set(x, island.terrain.heightAt(x, z), z);
      island.root.add(crystal); this.groundAttachments.push({ object: crystal, island: index });
    }
  }

  private loadJellies() {
    return new Promise<void>(resolve => new GLTFLoader().load('/models/Jellyfish.glb', gltf => {
      const idle = THREE.AnimationClip.findByName(gltf.animations, 'idle');
      const placements = [
        [-5.5, 4.5, -10, 1.8], [7.2, 6.2, -17, 2.05], [-16, 8.5, -24, 1.7],
        [17, 11.0, -28, 2.15], [-9, 13.0, 18, 1.8], [23, 7.2, 12, 1.65]
      ];
      placements.forEach(([x, y, z, size], index) => {
        const model = cloneSkinned(gltf.scene);
        const mixer = new THREE.AnimationMixer(model);
        if (idle) mixer.clipAction(idle).play();
        mixer.setTime(0);
        fitProp(model, size);
        const bounds = measureProp(model);
        model.position.sub(bounds.getCenter(new THREE.Vector3()));
        model.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          const materials = originals.map(source => {
            const material = (source as THREE.MeshStandardMaterial).clone();
            // The source atlas is coloured. Remove colour modulation while
            // retaining the original geometry, normal detail and idle rig.
            material.map = null;
            material.emissiveMap = null;
            material.vertexColors = false;
            material.color.set(0xffffff);
            material.emissive.set(0xffffff);
            material.emissiveIntensity = 0.72;
            material.metalness = 0;
            material.transparent = true; material.opacity = 0.78;
            material.depthWrite = false; material.roughness = 0.62;
            return material;
          });
          mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
          mesh.frustumCulled = false;
        });
        const root = new THREE.Group(); root.name = 'original floating jellyfish';
        root.add(model); root.position.set(x, y, z);
        applyStencilLayer(root, this.stencilLayer);
        this.root.add(root);
        this.jellies.push({ root, model, mixer, base: root.position.clone(), rate: 0.05 + index * 0.006, phase: index * 1.73, duration: idle?.duration ?? 0 });
      });
      resolve();
    }, undefined, () => resolve()));
  }

  private buildLights() {
    this.root.add(new THREE.HemisphereLight(0xb5a1d4, 0x211b32, 1.22));
    const moon = new THREE.DirectionalLight(0xc3b8df, 1.65);
    moon.position.set(-12, 18, -14); moon.target.position.set(0, 0, -2);
    const low = new THREE.PointLight(0x686faf, 20, 32, 1.6); low.position.set(0, -5, -8);
    const fill = new THREE.DirectionalLight(0x666795, 0.36);
    fill.position.set(16, 5, 8); fill.target.position.set(0, 0, -2);
    this.root.add(moon, moon.target, low, fill, fill.target);
  }

  private buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(145, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUniforms,
      vertexShader: 'varying vec3 vDir; void main(){vDir=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        uniform float uTime; varying vec3 vDir;
        float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        void main(){
          vec3 d=normalize(vDir);float h=d.y;
          vec3 horizon=vec3(0.145,0.065,0.25),upper=vec3(0.024,0.012,0.06),lower=vec3(0.19,0.065,0.17);
          vec3 c=h>0.0?mix(horizon,upper,pow(h,0.55)):mix(horizon,lower,pow(-h,0.7));
          vec3 p=d*3.3+vec3(0.0,uTime*0.002,0.0);
          float mist=noise(p)*0.62+noise(p*2.1)*0.26+noise(p*4.0)*0.12;
          c+=vec3(0.12,0.055,0.17)*smoothstep(0.46,0.74,mist)*exp(-pow((h-0.08)/0.34,2.0));
          float star=hash(floor(d*390.0));c+=vec3(0.43,0.45,0.58)*smoothstep(0.9987,1.0,star)*smoothstep(-0.10,0.55,h);
          float moon=1.0-smoothstep(0.028,0.031,distance(d,normalize(vec3(-0.45,0.38,-0.80))));
          float other=1.0-smoothstep(0.011,0.014,distance(d,normalize(vec3(0.61,0.18,-0.77))));
          c=mix(c,vec3(0.43,0.39,0.49),moon*0.65);c=mix(c,vec3(0.29,0.33,0.48),other*0.7);
          gl_FragColor=vec4(c,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    sky.name = 'violet impossible sky'; sky.renderOrder = -1; this.root.add(sky);
  }

  private buildUpwardStars() {
    const colors = new Float32Array(this.starBase.length);
    const color = new THREE.Color();
    for (let i = 0; i < this.starSpeed.length; i++) {
      const angle = this.rng() * Math.PI * 2, distance = 5 + this.rng() * 30;
      this.starBase[i * 3] = Math.cos(angle) * distance;
      this.starBase[i * 3 + 1] = -8 + this.rng() * 28;
      this.starBase[i * 3 + 2] = Math.sin(angle) * distance - 2;
      this.starSpeed[i] = 0.22 + this.rng() * 0.47;
      color.setHSL(0.63 + this.rng() * 0.12, 0.16, 0.42 + this.rng() * 0.25);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.starBase.slice(), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: 0.055, map: dotTexture(), transparent: true, opacity: 0.61, depthWrite: false, blending: THREE.AdditiveBlending }));
    stars.name = 'stars falling upward'; stars.frustumCulled = false;
    this.root.add(stars); return stars;
  }

  update(time: number, lean: number) {
    this.skyUniforms.uTime.value = time;
    for (const island of this.drifters) island.root.position.y = island.y + Math.sin(time * 0.065 + island.phase) * 0.24;
    for (const jelly of this.jellies) {
      jelly.root.position.set(jelly.base.x + Math.sin(time * jelly.rate + jelly.phase) * 0.65, jelly.base.y + Math.sin(time * jelly.rate * 1.3 + jelly.phase) * 0.65, jelly.base.z + Math.cos(time * jelly.rate * 0.7 + jelly.phase) * 0.5);
      jelly.root.rotation.y = Math.sin(time * 0.04 + jelly.phase) * 0.24;
      if (jelly.duration > 0) jelly.mixer.setTime((time * 0.32 + jelly.phase) % jelly.duration);
    }
    const p = this.rising.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, this.starBase[i * 3] + Math.sin(time * 0.06 + i) * 0.24, ((this.starBase[i * 3 + 1] + 8 + time * this.starSpeed[i]) % 28) - 8, this.starBase[i * 3 + 2] + Math.cos(time * 0.05 + i) * 0.24);
    }
    p.needsUpdate = true;
    this.crystalMaterial.emissiveIntensity = 0.25 + THREE.MathUtils.clamp(lean, 0, 1) * 0.16;
  }
}
