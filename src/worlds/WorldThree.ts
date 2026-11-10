import * as THREE from 'three';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { ShadowFauna } from './ShadowFauna';
import { HellLandscape, hellGroundOffset } from './HellLandscape';
import { EnvironmentalPresence } from './EnvironmentalPresence';
import { WorldCollisions } from './WorldCollisions';
import { HellRelics } from './HellRelics';
import { HellSkyLife } from './HellSkyLife';

/** A single closed island: triangulated landing, rounded rim and stone underside. */
export class IslandSurface {
  readonly geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private edge: number[] = [];

  constructor(readonly radius: number, depth: number, seed: number, readonly rings = 44, readonly sectors = 128, groundOffset: (x:number,z:number)=>number = () => 0) {
    const p: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
    const sage = new THREE.Color(0xa1a6b2), rim = new THREE.Color(0x7a7d88), rock = new THREE.Color(0x696d7b);
    const c = new THREE.Color();
    const profile = (a: number) => radius * (1 + 0.026 * Math.sin(a * 3 + seed) + 0.012 * Math.sin(a * 7 - seed * 0.3));
    const topY = (x: number, z: number, r: number) => {
      const landing = THREE.MathUtils.smoothstep(Math.hypot(x, z - 2), 2.3, 5.5);
      const waves = 0.17 * Math.sin(x * 0.32 + seed) * Math.cos(z * 0.25) + 0.12 * Math.sin(z * 0.4 + x * 0.13);
      const berm = 0.28 * Math.exp(-Math.pow((r - 0.78) / 0.16, 2));
      return 0.035 + waves * landing + berm - 0.4 * Math.pow(r, 8) + groundOffset(x,z);
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

/** Volcanic horror caldera with the original creator-authored horror figures. */
export class WorldThree {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly leakColor = new THREE.Color(0xff501b);
  readonly soundSpots = { drone: new THREE.Vector3(0, 4, -18), chimes: new THREE.Vector3(-7, 2, -8),
    near: new THREE.Vector3(-4, .4, -3), lava: new THREE.Vector3(14, .35, -13), volcano: new THREE.Vector3(4, 13, -43) };
  readonly leanDetails: THREE.MeshBasicMaterial[] = [];
  readonly islands: DriftIsland[] = [];
  readonly groundAttachments: {object: THREE.Object3D; instance?: number; island: number}[] = [];
  readonly presence = new EnvironmentalPresence();
  readonly collisions = new WorldCollisions(this.root);
  readonly landscape: HellLandscape;
  readonly fauna: ShadowFauna;
  readonly relics: HellRelics;
  readonly skyLife: HellSkyLife;
  readonly ready: Promise<void>;
  skyStatus: 'loading' | 'ready' | 'failed' = 'loading';
  stencilLayer = 1;
  private sample = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private orientation = new THREE.Quaternion();

  constructor(origin: THREE.Vector3) {
    this.root.name = 'The Cinder Rift';
    this.root.position.set(origin.x, 0, origin.z); this.scene.add(this.root);
    this.scene.fog = new THREE.FogExp2(0x260d0b, .009);
    const terrain = new IslandSurface(56, 8, 2.1, 96, 160, hellGroundOffset);
    const heightAt = (x: number, z: number) => terrain.heightAt(x, z);
    this.landscape = new HellLandscape(this.root, heightAt, () => this.stencilLayer, this.collisions);
    const material = this.landscape.groundMaterial;
    const uv = terrain.geometry.getAttribute('uv');
    for (let i=0;i<uv.count;i++) uv.setXY(i,uv.getX(i)*28,uv.getY(i)*28);
    // One broad closed ground surface. Its distant edge is beyond the fog;
    // there are no floating islands, pedestal props or decorative arch stage.
    const surface = new THREE.Mesh(terrain.geometry, [material, material]);
    surface.name = 'Continuous cooled basalt floor'; surface.receiveShadow = true;
    const groundRoot = new THREE.Group(); groundRoot.add(surface); this.root.add(groundRoot);
    this.islands.push({ root: groundRoot, surface, terrain });
    this.fauna = new ShadowFauna(this.root, heightAt, () => this.stencilLayer, this.collisions);
    this.relics = new HellRelics(this.root, heightAt, () => this.stencilLayer, this.collisions);
    this.skyLife = new HellSkyLife(this.root, heightAt, () => this.stencilLayer);
    this.buildLights();
    this.ready = Promise.all([this.landscape.ready, this.fauna.ready, this.relics.ready, this.skyLife.ready]).then(() => { this.skyStatus='ready'; this.refreshStencil(); });
    this.refreshStencil();
  }

  refreshStencil() { applyStencilLayer(this.scene, this.stencilLayer); }
  alignTo(anchor: THREE.Object3D) {
    anchor.getWorldPosition(this.sample); anchor.getWorldQuaternion(this.orientation);
    this.direction.set(0, 0, 1).applyQuaternion(this.orientation);
    this.root.position.set(this.sample.x, 0, this.sample.z);
    this.root.rotation.set(0, Math.atan2(this.direction.x, this.direction.z), 0);
    this.root.updateMatrixWorld(true);
  }
  groundAt(worldX: number, worldZ: number) {
    this.root.updateWorldMatrix(true, false);
    this.sample.set(worldX, this.root.position.y, worldZ); this.root.worldToLocal(this.sample);
    this.sample.y = this.islands[0].terrain.heightAt(this.sample.x, this.sample.z);
    return this.root.localToWorld(this.sample).y;
  }
  get walkBounds() {
    this.root.updateWorldMatrix(true, false);
    return { center: this.root.localToWorld(new THREE.Vector3(0, 0, -3)), radius: 15 };
  }
  get nextSeamHint() {
    this.root.updateWorldMatrix(true, false);
    return this.root.localToWorld(new THREE.Vector3(0, this.islands[0].terrain.heightAt(0, 0), 0));
  }
  updateView(viewerPosition: THREE.Vector3, _viewerForward: THREE.Vector3, active: boolean, dt: number) {
    this.presence.update(viewerPosition, active, dt); this.fauna.update(viewerPosition, active, dt);
  }
  consumeReturnHint() { return this.fauna.consumeReturnHint(); }
  getSkyCreaturePositions(out: THREE.Vector3[]) { return this.skyLife.getAudioPositions(out); }
  update(time: number, _lean: number) { this.landscape.update(time); this.skyLife.update(time); }

  private buildLights() {
    this.root.add(new THREE.HemisphereLight(0x9f736f, 0xb32608, 1.05));
    const rim = new THREE.DirectionalLight(0xffb287, 2.1);
    rim.position.set(-14, 24, 7); rim.target.position.set(0, 0, -8); rim.castShadow = true;
    rim.shadow.mapSize.set(1024, 1024); rim.shadow.camera.left = rim.shadow.camera.bottom = -24;
    rim.shadow.camera.right = rim.shadow.camera.top = 24; rim.shadow.camera.far = 90;
    rim.shadow.normalBias = .04; rim.shadow.bias = -.00015;
    const lava = new THREE.PointLight(0xff4813, 38, 38, 2); lava.position.set(12, 2, -12);
    const back = new THREE.DirectionalLight(0xf93612, .7); back.position.set(5, 12, -35);
    this.root.add(rim, rim.target, lava, back);
  }
}
