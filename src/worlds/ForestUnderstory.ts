import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../utils/assetUrl';
import { mulberry32 } from '../utils/math';
import { applyStencilLayer } from '../portal/PortalRenderer';
import type { EnvironmentalPresence } from './EnvironmentalPresence';
import { forestCoverAt, forestObjectClearanceAt } from './ForestHabitat';
import { forestGrowthAt } from './ForestGround';
import { inForestSample } from './ForestSampleLayout';
import { applyForestLitter } from './ForestLitter';
import type { ForestSample } from './ForestSample';
import type { WorldCollisions } from './WorldCollisions';
import type { ForestFauna } from './ForestFauna';
import { forestLeafMaterial } from './ForestLeafMaterial';
import { useForestBoxCulling } from './ForestCulling';
import { forestGrassGeometries, applyForestGrassMorph, FOREST_GRASS_MORPH } from './ForestGrassGeometry';
import { ForestGrassWind } from './ForestGrassWind';

type Spot = { x: number; y: number; z: number; yaw: number; width: number; height: number;
  species: number; seed: number; cosine?: number; sine?: number };
type Cell = { x: number; z: number; base: Spot[]; spots: Spot[]; props: Spot[] };
type Batch = { mesh: THREE.InstancedMesh; width: number; height: number; triangles: number;
  capacity: number; bounds: THREE.Box3; farGeometry?: THREE.BufferGeometry; nearGeometry?: THREE.BufferGeometry };
type Patch = { batch: Batch; species: number; kind: 'detail' | 'props';
  origins: THREE.Box2; range: THREE.IUniform<THREE.Vector2> };
export type ForestPreparationMesh = Readonly<{
  mesh: THREE.InstancedMesh;
  geometries: readonly THREE.BufferGeometry[];
}>;
const GRASS = ['grass_large_b', 'grass_mid_b', 'grass_small_b', 'grass_tiny_a', 'grass_tall_a'];
const PROPS = ['pebble_03', 'branch_b', 'branch_c', 'rock_03', 'rock_06'];
const WIDTHS = [.75, .50, .35, .22, .25], WIDTH_RANGES = [.20, .22, .20, .13, .17];
const HEIGHTS = [.30, .24, .14, .09, .42], HEIGHT_RANGES = [.16, .26, .16, .09, .38];
const CELL_SIZE = 8, SELECTION_DISTANCE = .65, LOAD_MARGIN = 1.0;
// Regression ceilings, not per-frame selection quotas. Exhausting a quota must
// never silently delete visible plants or change their silhouettes.
export const FOREST_COVER_BUDGET = Object.freeze({ base: 600_000, detail: 350_000, props: 400_000 });
export const FOREST_COVER_XR_BUDGET = Object.freeze({ base: 600_000, detail: 250_000, props: 400_000 });

/** Permanent scanned cover fills the ground at every viewing distance. Larger
 * accents fade over it; they never replace or remove the underlying plants.
 * Static spatial cells let the renderer cull off-screen grass independently. */
export class ForestUnderstory {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';
  readonly stats = { planted: 0, detailClumps: 0, props: 0, baseTriangles: 0,
    detail: 0, detailTriangles: 0, propTriangles: 0, triangles: 0, drawMeshes: 0, updates: 0 };
  private readonly cells = new Map<string, Cell>();
  private readonly base: Batch[] = [];
  private detail: Batch[] = [];
  private props: Batch[] = [];
  private readonly patches: Patch[] = [];
  private preparation: readonly ForestPreparationMesh[] = Object.freeze([]);
  private readonly grassWind = new ForestGrassWind();
  private readonly viewer = { value: new THREE.Vector3() };
  private readonly last = new THREE.Vector3(Infinity, Infinity, Infinity);
  private wasActive = false;
  private xrMode = false;
  private readonly detailRange = { value: new THREE.Vector2(.8, 3.8) };
  private readonly pebbleRange = { value: new THREE.Vector2(3, 6) };
  private readonly objectRange = { value: new THREE.Vector2(10, 15) };

  constructor(private readonly parent: THREE.Group, sample: ForestSample,
    ground: (x: number, z: number) => number, private readonly layer: () => number,
    _wind: THREE.IUniform, _presence: EnvironmentalPresence, collisions: WorldCollisions, fauna: ForestFauna) {
    this.root.name = 'Forest-wide dense grass and natural litter';
    this.ready = Promise.all([sample.ready, fauna.ready,
      new GLTFLoader().loadAsync(assetUrl('/models/forest/natural-grass/grass.gltf'))]).then(async ([,, grassKit]) => {
      if (sample.status !== 'ready') throw new Error('Approved forest asset kit did not load');
      const source = (name: string) => {
        const mesh = sample.root.getObjectByName(`Forest sample ${name}`) as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
        if (!mesh?.isInstancedMesh) throw new Error(`Missing forest source: ${name}`);
        return mesh;
      };
      const fadedMaterial = (original: THREE.MeshStandardMaterial, range: THREE.IUniform<THREE.Vector2>, foliage = false) => {
        const material = foliage ? forestLeafMaterial(original) : original.clone();
        // Material.clone does not preserve the scan's wind/presence hooks.
        if (!foliage) {
          material.onBeforeCompile = original.onBeforeCompile;
          material.customProgramCacheKey = original.customProgramCacheKey;
        }
        if (foliage) this.grassWind.apply(material);
        applyDetailFade(material, this.viewer, range);
        return material;
      };
      this.detail = GRASS.map(name => this.batch(source(name).geometry,
        fadedMaterial(source(name).material, this.detailRange, true), `Forest cover detail ${name}`,
        0, false));
      this.props = PROPS.map((name, i) => this.batch(source(name).geometry,
        fadedMaterial(source(name).material, i === 0 ? this.pebbleRange : this.objectRange),
        `Forest cover ${name}`, 0, false));
      const matrix = new THREE.Matrix4();
      // The approved scans remain accents; basal grass also fills their gaps.
      GRASS.forEach((name, species) => {
        const mesh = source(name), dimensions = this.detail[species];
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix); const a = matrix.elements;
          this.add({ x: a[12], y: a[13], z: a[14], yaw: Math.atan2(a[8], a[0]),
            width: Math.hypot(a[0], a[2]) * dimensions.width,
            height: Math.hypot(a[4], a[5], a[6]) * dimensions.height,
            species, seed: ((i * 73 + species * 37) % 997) / 997 }, 'spots');
        }
      });
      const random = mulberry32(17102027);
      const transform = new THREE.Object3D(), point = new THREE.Vector3();
      const colliders: Parameters<WorldCollisions['addCircle']>[0][] = [];
      const animalIds = new Set(fauna.animals.map((_, i) => `forest-doe-${i}`));
      const nearAnimalRoute = (x: number, z: number) => fauna.animals.some(animal => animal.route.some((a, i) => {
        const b = animal.route[(i + 1) % animal.route.length], dx = b.x - a.x, dz = b.z - a.z;
        const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / Math.max(.001, dx * dx + dz * dz), 0, 1);
        return Math.hypot(x - a.x - t * dx, z - a.z - t * dz) < 2.4;
      }));
      // Preserve solid-object placement. Grass independently fills the spaces
      // around these objects, including the former path and arrival area.
      for (let i = 0; i < 2000; i++) {
        if (i > 0 && i % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        const x = (random() - .5) * 64, z = (random() - .5) * 64 - 4;
        if (inForestSample(x, z, -.8) || Math.hypot(x, z + 4) > 31 || random() > forestObjectClearanceAt(x, z, .35)) continue;
        const choice = random(), species = choice < .955 ? 0 : choice < .982 ? 1 + (i % 2) : 3 + (i % 2);
        const sourceBatch = this.props[species];
        const width = species === 0 ? .055 + random() ** 1.5 * .16 : species < 3 ? .38 + random() * .55 : .4 + random() * .5;
        const radius = width * .6;
        if (species >= 3 && nearAnimalRoute(x, z)) continue;
        let y = ground(x, z);
        if (collisions.queryLocal(x, z, radius, .8, y) ||
          colliders.some(p => Math.hypot(x - p.x, z - p.z) < radius + p.radius + .15)) continue;
        const height = width / sourceBatch.width * sourceBatch.height, yaw = random() * Math.PI * 2;
        transform.position.set(x, 0, z); transform.rotation.set(0, yaw, 0);
        transform.scale.setScalar(width / sourceBatch.width); transform.updateMatrix();
        const p = sourceBatch.mesh.geometry.attributes.position;
        for (let k = 0; k < p.count; k++) if (p.getY(k) < sourceBatch.height * .18) {
          point.fromBufferAttribute(p, k).applyMatrix4(transform.matrix);
          y = Math.min(y, ground(point.x, point.z) - point.y);
        }
        y -= Math.min(.025, height * .12);
        this.add({ x, y, z, width, height, yaw, species, seed: random() }, 'props');
        if (species >= 3 && height > .12) colliders.push({ id: `forest-cover-rock-${colliders.length}`,
          x, z, radius, minY: y, maxY: y + height });
      }
      // Keep permanent cover across the whole forest, with fewer overlapping
      // transparent layers. Two crossed photographic cards replace four per tuft.
      const step = .22;
      for (let row = 0, z0 = -55; z0 < 48; z0 += step, row++) {
        for (let x0 = -52; x0 < 52; x0 += step) {
          const x = x0 + random() * step, z = z0 + random() * step;
          const distance = Math.hypot(x, z + 4), habitat = forestCoverAt(x, z);
          // Fixed world composition, never camera-distance thinning. Wider
          // background tufts overlap through the distant woodland.
          const background = THREE.MathUtils.smoothstep(distance, 22, 34);
          if (random() > habitat * (1 - .82 * background)) continue;
          const growth = forestGrowthAt(x, z), seed = random();
          const width = .62 + random() * .23 + background * .31;
          const height = .12 + growth * .11 + random() ** 2 * .22 + (seed < .12 ? .14 : 0);
          const y = ground(x, z);
          if (collisions.queryLocal(x, z, .045, height, y, animalIds)
            || colliders.some(p => Math.abs(x - p.x) < p.radius && Math.hypot(x - p.x, z - p.z) < p.radius)) continue;
          this.add({ x, y: y - .009, z, width, height, yaw: random() * Math.PI * 2, species: 0, seed }, 'base');
          if (inForestSample(x, z) || random() > .08) continue;
          const r = random(), species = r < .022 ? 0 : r < .18 ? 1 : r < .66 ? 2 : r < .88 ? 3 : 4;
          this.add({ x, y: y - .009, z, yaw: random() * Math.PI * 2, species, seed,
            width: (WIDTHS[species] + random() * WIDTH_RANGES[species]) * 1.12,
            height: (HEIGHTS[species] + random() * HEIGHT_RANGES[species]) * 1.2 }, 'spots');
        }
        if (row % 6 === 5) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (this.stats.planted < 30_000) throw new Error('Incomplete persistent forest cover');
      const geometries = ['b', 'c', 'd'].map(suffix => {
        const mesh = grassKit.scene.getObjectByName(`ground_grass_${suffix}`) as THREE.Mesh;
        if (!mesh?.isMesh) throw new Error('Natural grass geometry missing');
        const geometry = mesh.geometry; geometry.computeBoundingBox();
        const p = geometry.attributes.position, colors = new Float32Array(p.count * 3);
        const height = geometry.boundingBox!.max.y;
        for (let i = 0; i < p.count; i++) {
          const tip = THREE.MathUtils.smoothstep(p.getY(i) / height, .02, .8);
          colors.set([.86 + tip * .48, .94 + tip * .48, .73 + tip * .39], i * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return forestGrassGeometries(geometry, 2);
      });
      const original = source('grass_tiny_a').material, material = forestLeafMaterial(original);
      material.name = 'Living grass clumps · shared photographic leaf atlas';
      material.color.setRGB(1.03, 1.07, 1.0);
      material.emissiveIntensity = .13; material.alphaToCoverage = true;
      material.userData.forestNaturalGrass = true;
      applyForestGrassMorph(material, this.viewer);
      this.grassWind.apply(material);
      for (const [key, cell] of this.cells) {
        if (!cell.base.length) continue;
        // Three photographic clumps vary across colonies. Curved, rooted cards
        // fill the lower layer while full source meshes provide near detail.
        const variation = mulberry32(Math.imul(Math.round(cell.x), 73856093) ^ Math.imul(Math.round(cell.z), 19349663))();
        const geometry = geometries[variation < .68 ? 0 : variation < .78 ? 1 : 2];
        const batch = this.batch(geometry.near, material, `Forest permanent grass ${key}`, cell.base.length, false);
        batch.nearGeometry = geometry.near; batch.farGeometry = geometry.far;
        cell.base.forEach(p => this.put(batch, p));
        this.finish(batch); this.base.push(batch);
        this.stats.baseTriangles += batch.mesh.count * batch.triangles;
      }
      this.buildStaticPatches();
      this.selectPatches(0, 0);
      applyStencilLayer(this.root, layer());
      const floor = parent.getObjectByName('Continuous forest floor') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const sampleFloor = sample.root.getObjectByName('Forest sample moss and pine litter relief') as THREE.Mesh;
      sampleFloor.renderOrder = 5;
      const litter = (sampleFloor.material as THREE.Material).userData.sampleLitter as THREE.Texture[];
      applyForestLitter(floor.material, litter);
      const previousRender = floor.onBeforeRender;
      floor.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        previousRender.call(floor, renderer, scene, camera, geometry, material, group);
        this.setXRMode(renderer.xr.isPresenting);
      };
      colliders.forEach(collider => collisions.addCircle(collider));
      GRASS.forEach(name => { source(name).visible = false; source(name).raycast = () => {}; });
      const legacyGrass = parent.getObjectByName('Low woodland sedges along the trail')!;
      legacyGrass.visible = false; legacyGrass.raycast = () => {};
      parent.add(this.root);
      // Dormant patches are deliberately detached from the scene. Expose their
      // immutable buffers and both grass LODs once, so startup preparation can
      // upload them before a first turn or walk brings them into view.
      this.preparation = Object.freeze([...this.base, ...this.patches.map(patch => patch.batch)].map(batch =>
        Object.freeze({ mesh: batch.mesh, geometries: Object.freeze([...new Set([
          batch.mesh.geometry, batch.nearGeometry, batch.farGeometry
        ].filter((geometry): geometry is THREE.BufferGeometry => geometry !== undefined))]) })));
      this.status = 'ready';
    }).catch(error => {
      this.status = 'fallback';
      console.warn('Forest-wide planting unavailable; approved sample and original forest retained.', error);
    });
  }

  /** Stable references only; reading this never attaches or allocates meshes. */
  get preparationMeshes(): readonly ForestPreparationMesh[] { return this.preparation; }

  private batch(geometry: THREE.BufferGeometry, material: THREE.Material, name: string, capacity: number, dynamic: boolean): Batch {
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.count = 0;
    // Grass is not a solid seam-placement target. Raycasting every blade on a
    // desktop click can stall interaction; terrain and solid props still hit.
    if (name.startsWith('Forest permanent grass') || name.startsWith('Forest cover detail')) mesh.raycast = () => {};
    mesh.instanceMatrix.setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    mesh.boundingSphere = new THREE.Sphere(); mesh.receiveShadow = true; mesh.castShadow = false;
    this.root.add(mesh);
    const bounds = new THREE.Box3();
    useForestBoxCulling(mesh, bounds);
    return { mesh, width: Math.max(size.x, size.z), height: size.y,
      triangles: (geometry.index?.count ?? geometry.attributes.position.count) / 3, capacity, bounds };
  }

  updateWind(time: number) { this.grassWind.update(time); }

  /** XR reduces the scanned accent radius, never the permanent ground cover. */
  setXRMode(enabled: boolean) {
    if (enabled === this.xrMode) return;
    this.xrMode = enabled;
    this.detailRange.value.set(enabled ? 0 : .8, enabled ? 3.0 : 3.8);
    this.last.set(Infinity, Infinity, Infinity);
  }

  private add(spot: Spot, kind: 'base' | 'spots' | 'props') {
    const ix = Math.floor(spot.x / CELL_SIZE), iz = Math.floor(spot.z / CELL_SIZE), key = `${ix},${iz}`;
    if (!this.cells.has(key)) this.cells.set(key, { x: (ix + .5) * CELL_SIZE, z: (iz + .5) * CELL_SIZE,
      base: [], spots: [], props: [] });
    this.cells.get(key)![kind].push(spot);
    this.stats[kind === 'base' ? 'planted' : kind === 'spots' ? 'detailClumps' : 'props']++;
  }

  updateView(position: THREE.Vector3, active: boolean, _dt: number) {
    if (this.status !== 'ready') return;
    if (active) {
      this.parent.updateWorldMatrix(true, false);
      this.viewer.value.copy(position); this.parent.worldToLocal(this.viewer.value);
    } else this.viewer.value.set(0, 0, 0);
    // Fade/morph position updates every frame. Cached patches extend beyond
    // zero opacity so selection never removes visible plants while walking.
    if (active === this.wasActive && this.last.distanceToSquared(this.viewer.value) < SELECTION_DISTANCE ** 2) return;
    this.selectPatches(this.viewer.value.x, this.viewer.value.z);
    this.last.copy(this.viewer.value); this.wasActive = active;
  }

  private selectPatches(x: number, z: number) {
    this.stats.baseTriangles = 0;
    for (const batch of this.base) {
      // The entire patch must have finished morphing before changing indices.
      // The extra metre covers movement until the next selection update.
      const dx = Math.max(batch.bounds.min.x - x, 0, x - batch.bounds.max.x);
      const dz = Math.max(batch.bounds.min.z - z, 0, z - batch.bounds.max.z);
      batch.mesh.geometry = dx * dx + dz * dz > (FOREST_GRASS_MORPH.end + LOAD_MARGIN) ** 2
        ? batch.farGeometry! : batch.nearGeometry!;
      batch.triangles = batch.mesh.geometry.index!.count / 3;
      this.stats.baseTriangles += batch.mesh.count * batch.triangles;
    }
    Object.assign(this.stats, { detail: 0, detailTriangles: 0, propTriangles: 0,
      triangles: this.stats.baseTriangles, drawMeshes: this.base.length });
    for (const { batch, origins, range, kind } of this.patches) {
      const dx = Math.max(origins.min.x - x, 0, x - origins.max.x);
      const dz = Math.max(origins.min.y - z, 0, z - origins.max.y);
      const visible = dx * dx + dz * dz < (range.value.y + LOAD_MARGIN) ** 2;
      // Dormant patches stay cached outside the scene traversal. Return trips
      // reuse their existing buffers instead of allocating or uploading again.
      if (!visible) { this.root.remove(batch.mesh); batch.mesh.visible = false; continue; }
      if (batch.mesh.parent !== this.root) {
        this.root.add(batch.mesh); applyStencilLayer(batch.mesh, this.layer());
        batch.mesh.matrixWorldNeedsUpdate = true;
      }
      batch.mesh.visible = true;
      const triangles = batch.mesh.count * batch.triangles;
      if (kind === 'detail') { this.stats.detail += batch.mesh.count; this.stats.detailTriangles += triangles; }
      else this.stats.propTriangles += triangles;
      this.stats.drawMeshes++; this.stats.triangles += triangles;
    }
    this.stats.updates++;
  }

  /** Upload every accent once. Walking only selects small, immutable patches;
   * no instance matrix/colour uploads, plant reshuffling or allocation bursts. */
  private buildStaticPatches() {
    for (const kind of ['detail', 'props'] as const) {
      const sources = kind === 'detail' ? this.detail : this.props;
      const groups = new Map<string, { species: number; spots: Spot[] }>();
      for (const cell of this.cells.values()) for (const p of kind === 'detail' ? cell.spots : cell.props) {
        const size = kind === 'detail' || p.species === 0 ? 4 : 8;
        const key = `${p.species}:${Math.floor(p.x / size)}:${Math.floor(p.z / size)}`;
        if (!groups.has(key)) groups.set(key, { species: p.species, spots: [] });
        groups.get(key)!.spots.push(p);
      }
      for (const [key, { species, spots }] of groups) {
        const source = sources[species];
        const batch = this.batch(source.mesh.geometry, source.mesh.material as THREE.Material,
          `${source.mesh.name} patch ${key}`, spots.length, false);
        const origins = new THREE.Box2(), point = new THREE.Vector2();
        for (const p of spots) { this.put(batch, p); origins.expandByPoint(point.set(p.x, p.z)); }
        this.finish(batch);
        this.root.remove(batch.mesh);
        this.patches.push({ batch, origins, species, kind, range: kind === 'detail' ? this.detailRange
          : species === 0 ? this.pebbleRange : this.objectRange });
      }
      // Keep source dimensions/materials for diagnostics, without empty draws.
      for (const source of sources) { this.root.remove(source.mesh); source.mesh.dispose(); }
    }
  }

  private finish(batch: Batch) {
    const mesh = batch.mesh;
    mesh.visible = mesh.count > 0;
    if (!mesh.count) return;
    if (mesh.name.startsWith('Forest permanent grass') || mesh.name.startsWith('Forest cover detail')) {
      const geometry = this.grassWind.bind(mesh, batch.farGeometry);
      if (batch.farGeometry) { batch.nearGeometry = geometry.near; batch.farGeometry = geometry.far; }
    }
    mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.clearUpdateRanges(); mesh.instanceColor!.addUpdateRange(0, mesh.count * 3);
    mesh.instanceColor!.needsUpdate = true;
    batch.bounds.getBoundingSphere(mesh.boundingSphere!);
  }

  private put(batch: Batch, p: Spot) {
    if (batch.mesh.count >= batch.capacity) throw new Error(`Forest cover capacity exceeded: ${batch.mesh.name}`);
    const index = batch.mesh.count++, a = batch.mesh.instanceMatrix.array as Float32Array, k = index * 16;
    const horizontal = p.width / batch.width, vertical = p.height / batch.height;
    const c = (p.cosine ??= Math.cos(p.yaw)) * horizontal, s = (p.sine ??= Math.sin(p.yaw)) * horizontal;
    a[k] = c; a[k + 1] = 0; a[k + 2] = -s; a[k + 3] = 0;
    a[k + 4] = 0; a[k + 5] = vertical; a[k + 6] = 0; a[k + 7] = 0;
    a[k + 8] = s; a[k + 9] = 0; a[k + 10] = c; a[k + 11] = 0;
    a[k + 12] = p.x; a[k + 13] = p.y; a[k + 14] = p.z; a[k + 15] = 1;
    const colors = batch.mesh.instanceColor!.array as Float32Array;
    colors[index * 3] = .84 + p.seed * .23;
    colors[index * 3 + 1] = .90 + p.seed * .16;
    colors[index * 3 + 2] = .72 + p.seed * .29;
    const r = p.width * .8 + .3, min = batch.bounds.min, max = batch.bounds.max;
    min.x = Math.min(min.x, p.x - r); min.y = Math.min(min.y, p.y - .12); min.z = Math.min(min.z, p.z - r);
    max.x = Math.max(max.x, p.x + r); max.y = Math.max(max.y, p.y + p.height + .3); max.z = Math.max(max.z, p.z + r);
  }
}


/** World-anchored continuous cutout fade for additive detail only. Depth writes
 * stay enabled; permanent plants never fade or disappear with distance. */
function applyDetailFade(material: THREE.Material, viewer: THREE.IUniform<THREE.Vector3>, range: THREE.IUniform<THREE.Vector2>) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uCoverViewer = viewer; shader.uniforms.uCoverRange = range;
    shader.vertexShader = 'uniform vec3 uCoverViewer; uniform vec2 uCoverRange; varying vec3 vCoverPoint; varying float vCoverFade;\n' + shader.vertexShader;
    // Preloaded accents outside the fade contribute no pixels. Clip them before
    // wind, presence and lighting work while preserving their loaded positions.
    shader.vertexShader = shader.vertexShader.replace('void main() {', `void main() {
      if (distance(instanceMatrix[3].xz,uCoverViewer.xz) >= uCoverRange.y) {
        vCoverFade = 0.0; vCoverPoint = vec3(0.0);
        gl_Position = vec4(2.0,2.0,2.0,1.0); return;
      }`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vCoverPoint = (instanceMatrix * vec4(position,1.0)).xyz;
      float coverDistance = distance(instanceMatrix[3].xz,uCoverViewer.xz);
      vCoverFade = 1.0-smoothstep(uCoverRange.x,uCoverRange.y,coverDistance);`);
    shader.fragmentShader = 'varying vec3 vCoverPoint; varying float vCoverFade;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      if(vCoverFade <= 0.0) discard;
      if(vCoverFade < fract(sin(dot(floor(vCoverPoint*350.0),vec3(12.9898,78.233,37.719)))*43758.5453)) discard;`);
  };
  material.customProgramCacheKey = () => `${key}|forest-additive-detail-fade-v3-early-clip`;
  material.userData.forestDetailFade = { viewer, range };
}
