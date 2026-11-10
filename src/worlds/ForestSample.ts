import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../utils/assetUrl';
import { mulberry32 } from '../utils/math';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { applyWind } from './props';
import { applyPlantPresence, type EnvironmentalPresence } from './EnvironmentalPresence';
import { forestPlantingSpots } from './ForestDetails';
import { forestGrowthAt } from './ForestGround';
import type { CollisionCircle, WorldCollisions } from './WorldCollisions';
import { FOREST_SAMPLE, inForestSample, SAMPLE_COLONIES, SAMPLE_ROCKS, SAMPLE_BRANCHES, type SamplePlacement } from './ForestSampleLayout';
import { createForestSampleMarker, SHOW_FOREST_SAMPLE_MARKER } from './ForestSampleMarker';
import { ForestSampleSurface, loadSampleLitter } from './ForestSampleSurface';

type Ground = (x: number, z: number) => number;
type Stamp = { x: number; z: number; radius: number; strength: number };
type Prepared = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; size: THREE.Vector3 };

/** A single bounded review patch. Assets and geometry are staged before the
 * existing primitives are removed; any failure leaves the previous forest. */
export class ForestSample {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';
  readonly stats = { triangles: 0, drawMeshes: 0, grass: 0, rocks: 0, branches: 0 };
  private surface?: ForestSampleSurface;

  heightAt(x: number, z: number) { return this.surface!.heightAt(x, z); }

  constructor(parent: THREE.Group, ground: Ground,
    layer: () => number, wind: THREE.IUniform, presence: EnvironmentalPresence,
    collisions: WorldCollisions, contextReady: Promise<unknown>, activate: () => void) {
    this.root.name = 'Forest ground sample · 5 x 5 metres';
    parent.add(this.root);
    const loader = new GLTFLoader();
    const assets = ['grass', 'rocks', 'branches'];
    this.ready = Promise.all([contextReady, loadSampleLitter(), ...assets.map(id =>
      loader.loadAsync(assetUrl(`/models/forest/balanced/${id}.gltf`)))]).then(results => {
      const floor = parent.getObjectByName('Continuous forest floor') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      if (!floor.material.customProgramCacheKey().startsWith('forest-moss-root-soil-v2'))
        throw new Error('The layered forest floor must load before the sample');
      this.surface = new ForestSampleSurface(ground, floor.material, results[1] as THREE.Texture[]);
      ground = (x, z) => this.surface!.heightAt(x, z);
      const models = results.slice(2) as Awaited<ReturnType<GLTFLoader['loadAsync']>>[];
      const sources = new Map<string, Prepared>();
      const foliageMaterial = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      for (const model of models) {
        model.scene.updateMatrixWorld(true);
        model.scene.traverse(object => {
          if (!(object as THREE.Mesh).isMesh) return;
          const mesh = object as THREE.Mesh;
          const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          geometry.computeBoundingBox();
          const box = geometry.boundingBox!, center = box.getCenter(new THREE.Vector3());
          geometry.translate(-center.x, -box.min.y, -center.z); geometry.computeBoundingBox();
          const sourceMaterial = mesh.material as THREE.MeshStandardMaterial;
          const grass = mesh.name.startsWith('grass_');
          if (grass) {
            const p = geometry.attributes.position, colors = new Float32Array(p.count * 3);
            const height = geometry.boundingBox!.max.y;
            for (let i = 0; i < p.count; i++) {
              const tip = THREE.MathUtils.smoothstep(p.getY(i) / height, .02, .75);
              colors.set([.65 + tip * .90, .72 + tip * .98, .48 + tip * .62], i * 3);
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          }
          let material = foliageMaterial.get(sourceMaterial);
          if (!material) {
            material = sourceMaterial.clone();
            material.roughness = 1; material.envMapIntensity = .55;
            material.normalScale.set(.55, .55); material.transparent = false;
            if (grass) {
              material.alphaTest = .45; material.side = THREE.DoubleSide;
              material.color.set(0xffffff);
              material.vertexColors = true;
              // Fine leaves use their authored shape rather than extra normal/AO
              // lookups. A restrained leaf-coloured fill prevents black backsides.
              material.normalMap = null; material.aoMap = null; material.roughnessMap = null;
              material.emissiveMap = material.map; material.emissive.set(0xffffff); material.emissiveIntensity = .18;
              applyWind(material, wind, .045, 1.25);
              applyPlantPresence(material, presence, 1.8, .10);
            }
            for (const texture of [material.map, material.normalMap, material.roughnessMap, material.aoMap])
              if (texture) texture.anisotropy = 4;
            foliageMaterial.set(sourceMaterial, material);
          }
          sources.set(mesh.name, { geometry, material, size: geometry.boundingBox!.getSize(new THREE.Vector3()) });
        });
      }
      const required = ['grass_tall_a', 'grass_tiny_a', 'grass_small_b', 'grass_mid_b', 'grass_large_b',
        'rock_03', 'rock_06', 'pebble_03', 'branch_b', 'branch_c'];
      if (required.some(name => !sources.has(name))) throw new Error('Incomplete forest sample model kit');

      const ignored = new Set<string>(), oldRocks = parent.getObjectByName('Weathered woodland stones') as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < (oldRocks?.count ?? 0); i++) {
        oldRocks.getMatrixAt(i, matrix);
        if (inForestSample(matrix.elements[12], matrix.elements[14])) ignored.add(`forest-stone-${i}`);
      }
      const staging = new THREE.Group(), stamps: Stamp[] = [], solidFootprints: Stamp[] = [];
      staging.add(this.surface.mesh);
      const registered: CollisionCircle[] = [];
      const grouped = new Map<string, THREE.Matrix4[]>();
      const random = mulberry32(17102026);
      const transform = new THREE.Object3D(), point = new THREE.Vector3();

      const place = (placement: SamplePlacement, kind: 'grass' | 'rocks' | 'branches') => {
        const source = sources.get(placement.mesh)!;
        const horizontal = placement.width / Math.max(source.size.x, source.size.z);
        const vertical = placement.height ? placement.height / source.size.y : horizontal;
        transform.position.set(placement.x, 0, placement.z);
        transform.rotation.set(0, placement.yaw, 0);
        transform.scale.set(horizontal, vertical, horizontal); transform.updateMatrix();
        const p = source.geometry.attributes.position;
        let radius = 0, y = ground(placement.x, placement.z);
        for (let i = 0; i < p.count; i++) {
          point.fromBufferAttribute(p, i).applyMatrix4(transform.matrix);
          if (!inForestSample(point.x, point.z, kind === 'grass' ? .025 : .005)) return false;
          radius = Math.max(radius, Math.hypot(point.x - placement.x, point.z - placement.z));
          // Fit the lower support points to the real triangulated terrain.
          if (kind !== 'grass' && p.getY(i) < source.size.y * .18)
            y = Math.min(y, ground(point.x, point.z) - point.y);
        }
        if (Math.hypot(placement.x, placement.z) < 2.3 + radius) return false;
        if (collisions.queryLocal(placement.x, placement.z, radius + .025, .65,
          ground(placement.x, placement.z), ignored)) return false;
        const embed = kind === 'rocks' ? Math.min(.035, source.size.y * vertical * .12) : .009;
        transform.position.y = y - embed; transform.updateMatrix();
        if (!grouped.has(placement.mesh)) grouped.set(placement.mesh, []);
        grouped.get(placement.mesh)!.push(transform.matrix.clone());
        stamps.push({ x: placement.x, z: placement.z, radius: radius * 1.3 + .04,
          strength: kind === 'grass' ? .17 : .64 });
        if (kind !== 'grass') solidFootprints.push({ x: placement.x, z: placement.z, radius: radius + .04, strength: 1 });
        if (kind === 'rocks' && source.size.y * vertical > .12) registered.push({
          id: `forest-sample-rock-${registered.length}`, x: placement.x, z: placement.z, radius,
          minY: transform.position.y, maxY: transform.position.y + source.size.y * vertical
        });
        this.stats[kind]++;
        return true;
      };
      SAMPLE_ROCKS.forEach(p => place(p, 'rocks'));
      SAMPLE_BRANCHES.forEach(p => place(p, 'branches'));
      // Small stones occur in loose groups beside the larger rocks, with a few
      // on exposed soil. Their silhouettes remain inside the approved square.
      for (let attempt = 0; this.stats.rocks < 42 && attempt < 800; attempt++) {
        const x = 1.8 + random() * 4.4, z = -4.2 + random() * 4.4;
        const width = .06 + random() ** 1.8 * .16;
        if (solidFootprints.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + width * .4)) continue;
        place({ mesh: 'pebble_03', x, z, width, yaw: random() * Math.PI * 2 }, 'rocks');
      }
      const existingPlants = forestPlantingSpots().filter(p => inForestSample(p.x, p.z));
      const grassCentres: { x: number; z: number }[] = [];
      const variants = ['grass_large_b', 'grass_mid_b', 'grass_small_b', 'grass_tiny_a', 'grass_tall_a'];
      const counts = [20, 120, 340, 160, 70];
      const spacing = [.21, .16, .105, .075, .14];
      // Broad colonies overlap a dense low layer, with taller stems rising
      // through it. Existing rock, fern, arrival and sample-edge clearances stay.
      for (let variant = 0; variant < variants.length; variant++) {
        let added = 0;
        for (let attempt = 0; added < counts[variant] && attempt < 16000; attempt++) {
          const x = FOREST_SAMPLE.minX + .2 + random() * 4.6;
          const z = FOREST_SAMPLE.minZ + .2 + random() * 4.6;
          const edge = Math.min(x - FOREST_SAMPLE.minX, FOREST_SAMPLE.maxX - x,
            z - FOREST_SAMPLE.minZ, FOREST_SAMPLE.maxZ - z);
          const colony = Math.max(...SAMPLE_COLONIES.map(p => 1 - THREE.MathUtils.smoothstep(
            Math.hypot(x - p.x, z - p.z), p.radius * .35, p.radius)));
          const density = (.62 + colony * .38) * (.80 + forestGrowthAt(x, z) * .20)
            * THREE.MathUtils.smoothstep(edge, .10, .45);
          if (random() > density || solidFootprints.some(p => Math.hypot(x - p.x, z - p.z) < p.radius * .78 + .025)
            || existingPlants.some(p => Math.hypot(x - p.x, z - p.z) < .13)
            || grassCentres.some(p => Math.hypot(x - p.x, z - p.z) < spacing[variant])) continue;
          const width = [ .75, .50, .35, .22, .25 ][variant] + random() * [ .20, .22, .20, .13, .17 ][variant];
          const height = [ .30, .24, .14, .09, .42 ][variant] + random() * [ .16, .26, .16, .09, .38 ][variant];
          if (place({ mesh: variants[variant], x, z, yaw: random() * Math.PI * 2, width, height }, 'grass')) {
            grassCentres.push({ x, z }); added++;
          }
        }
      }
      if (this.stats.grass < 680 || this.stats.rocks < 30) throw new Error('Forest sample placement could not preserve clearances');
      for (const [name, transforms] of grouped) {
        const source = sources.get(name)!;
        const instances = new THREE.InstancedMesh(source.geometry, source.material, transforms.length);
        instances.name = `Forest sample ${name}`;
        transforms.forEach((m, i) => {
          instances.setMatrixAt(i, m);
          if (name.startsWith('grass_')) instances.setColorAt(i,
            new THREE.Color().setRGB(.88 + (i % 7) * .035, .94 + (i % 5) * .03, .78 + (i % 9) * .035));
        });
        if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
        instances.instanceMatrix.needsUpdate = true; instances.computeBoundingSphere();
        if (instances.boundingSphere) instances.boundingSphere.radius += .06;
        instances.castShadow = !name.startsWith('grass_'); instances.receiveShadow = true;
        staging.add(instances);
        this.stats.triangles += (source.geometry.index?.count ?? source.geometry.attributes.position.count) / 3 * transforms.length;
      }
      const contact = sampleContactShade(this.surface.mesh.geometry, stamps);
      staging.add(contact);
      this.stats.triangles += contact.geometry.attributes.position.count / 3 + this.surface.mesh.geometry.index!.count / 3;
      this.stats.drawMeshes = staging.children.length;
      if (this.stats.triangles > 600_000 || this.stats.drawMeshes > 12) throw new Error('Forest sample exceeds its geometry budget');
      const marker = SHOW_FOREST_SAMPLE_MARKER ? createForestSampleMarker(ground, layer()) : null;
      applyStencilLayer(staging, layer());
      activate();
      registered.forEach(collider => collisions.addCircle(collider));
      this.root.add(staging);
      this.status = 'ready';
      if (marker) this.root.add(marker);
    }).catch(error => {
      this.status = 'fallback';
      Object.assign(this.stats, { triangles: 0, drawMeshes: 0, grass: 0, rocks: 0, branches: 0 });
      console.warn('Forest sample unavailable; original forest planting retained.', error);
    });
  }
}

/** Exact source terrain triangles avoid floating decals on differently divided
 * slopes. Transparent boundary texels keep shading strictly inside the square. */
function sampleContactShade(terrain: THREE.BufferGeometry, stamps: readonly Stamp[]) {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = FOREST_SAMPLE.minX + (i + .5) / size * 5;
    const z = FOREST_SAMPLE.minZ + (j + .5) / size * 5;
    let shade = 0;
    for (const stamp of stamps) {
      const d = Math.hypot(x - stamp.x, z - stamp.z) / stamp.radius;
      if (d < 1) shade += (1 - d * d) ** 2 * stamp.strength;
    }
    const edge = Math.min(i, j, size - i - 1, size - j - 1);
    data.set([255, 255, 255, Math.round(Math.min(.82, shade) * 255 * Math.min(1, edge / 5))], (j * size + i) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  const positions: number[] = [], uvs: number[] = [], p = terrain.attributes.position, indices = terrain.index!;
  for (let i = 0; i < indices.count; i += 3) {
    const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    const xs = ids.map(k => p.getX(k)), zs = ids.map(k => p.getZ(k));
    if (Math.max(...xs) < FOREST_SAMPLE.minX || Math.min(...xs) > FOREST_SAMPLE.maxX
      || Math.max(...zs) < FOREST_SAMPLE.minZ || Math.min(...zs) > FOREST_SAMPLE.maxZ) continue;
    ids.forEach(k => { positions.push(p.getX(k), p.getY(k) + .003, p.getZ(k));
      uvs.push((p.getX(k) - FOREST_SAMPLE.minX) / 5, (p.getZ(k) - FOREST_SAMPLE.minZ) / 5); });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, color: 0x1d2416,
    transparent: true, opacity: .42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  mesh.name = 'Forest sample ground contact shading';
  return mesh;
}
