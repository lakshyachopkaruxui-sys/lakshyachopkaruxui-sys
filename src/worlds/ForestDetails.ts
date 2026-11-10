import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { mulberry32 } from '../utils/math';
import { applyWind } from './props';
import { applyPlantPresence, EnvironmentalPresence } from './EnvironmentalPresence';
import type { WorldCollisions } from './WorldCollisions';
import { ForestGrassWind } from './ForestGrassWind';
import { useForestBoxCulling } from './ForestCulling';

export interface ForestSpot { x: number; z: number; yaw: number; scale: number }

/** Keep full plant silhouettes outside the landing, path, pond and perch. */
export function forestPlantingSpots(count = 144): ForestSpot[] {
  const rng = mulberry32(63029);
  // Near-field clusters establish the height and density of the understory.
  // These flank the approach, leaving the tear and walking corridor open.
  const spots: ForestSpot[] = [
    [-3.7, -3.6], [3.0, -3.2], [-4.3, -5.9], [2.0, -5.3],
    [-5.1, -1.6], [4.8, -1.8], [-6.0, -7.9], [8.6, -7.6],
    [-6.9, -5.0], [7.8, -4.1], [-8.2, -9.6], [9.5, -10.3]
  ].slice(0, count).map(([x, z], i) => ({ x, z, yaw: i * 2.399, scale: .94 + (i % 3) * .08 }));
  for (let attempt = 0; spots.length < count && attempt < 4000; attempt++) {
    const angle = rng() * Math.PI * 2;
    const distance = 2.8 + rng() ** 1.8 * 19;
    const x = Math.cos(angle) * distance, z = -4 + Math.sin(angle) * distance;
    const scale = 0.46 + rng() * 0.66;
    if (Math.hypot(x, z) < 2.3 || Math.abs(x - Math.sin(z * .15) * 1.25) < 1.75 ||
      Math.hypot((x - 5) / 2.4, (z + 9) / 4.2) < 1.5 ||
      Math.hypot(x + 1.7, z + 4.8) < 1.6 ||
      spots.some(p => Math.hypot(p.x - x, p.z - z) < .8)) continue;
    spots.push({ x, z, scale, yaw: rng() * Math.PI * 2 });
  }
  return spots;
}

/** Bake author transforms, then centre each individual fern or complete stump.
 * Fern 02 is a four-variant kit arranged on a grid, not one giant plant. */
export function groundedForestGeometry(mesh: THREE.Mesh) {
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const center = bounds.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -bounds.min.y, -center.z);
  geometry.computeBoundingBox();
  return geometry;
}

/** Scanned near-field detail, with four instanced fern variants and three stumps. */
export class ForestDetails {
  readonly root = new THREE.Group();
  readonly optimizedWind = new ForestGrassWind();
  readonly ready: Promise<void>;
  readonly assetStatus = { ferns: 'loading', stumps: 'loading' } as {
    ferns: 'loading' | 'ready' | 'fallback'; stumps: 'loading' | 'ready' | 'fallback'
  };
  constructor(parent: THREE.Group, heightAt: (x: number, z: number) => number,
    layer: () => number, wind: THREE.IUniform, presence: EnvironmentalPresence,
    onFernsReady: () => void, private readonly collisions?: WorldCollisions) {
    this.root.name = 'Scanned living forest understory';
    parent.add(this.root);
    this.ready = Promise.all([
      this.buildFerns(heightAt, layer, wind, presence).then(() => {
        this.assetStatus.ferns = 'ready'; onFernsReady();
      }).catch(error => { this.assetStatus.ferns = 'fallback'; console.warn('Scanned forest ferns unavailable; retaining planted fallback.', error); }),
      this.buildStumps(heightAt, layer).then(() => { this.assetStatus.stumps = 'ready'; })
        .catch(error => { this.assetStatus.stumps = 'fallback'; console.warn('Scanned forest stumps unavailable.', error); })
    ]).then(() => undefined);
    applyStencilLayer(this.root, layer());
  }

  private async buildFerns(heightAt: (x: number, z: number) => number, layer: () => number,
    wind: THREE.IUniform, presence: EnvironmentalPresence) {
    const [gltf, alpha] = await Promise.all([
      new GLTFLoader().loadAsync(assetUrl('/models/forest/balanced/ferns.gltf')),
      new THREE.TextureLoader().loadAsync(assetUrl('/models/forest/fern_02/textures/fern_02_alpha_1k.jpg'))
    ]);
    alpha.flipY = false;
    alpha.colorSpace = THREE.NoColorSpace;
    alpha.anisotropy = 4;
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    const sources: THREE.Mesh[] = [];
    source.traverse(object => { if ((object as THREE.Mesh).isMesh) sources.push(object as THREE.Mesh); });
    if (!sources.length) throw new Error('No fern geometry');
    const spots = forestPlantingSpots();
    sources.forEach((mesh, species) => {
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial;
      material.alphaMap = alpha;
      material.alphaTest = 0.43;
      material.transparent = false;
      material.side = THREE.DoubleSide;
      material.roughness = 0.91;
      material.normalScale.set(.6, .6);
      material.color.set(0xe2e7cf);
      material.envMapIntensity = .62;
      material.map!.anisotropy = 4;
      applyWind(material, wind, .055, 1.3);
      this.optimizedWind.apply(material, true);
      applyPlantPresence(material, presence, 2.2, .18);
      const geometry = groundedForestGeometry(mesh);
      // The four scanned plants are only 21–43cm tall in the kit. Fit each
      // variant by its measured height, instead of leaving the smallest ones
      // nearly invisible against nearby mushrooms and ground detail.
      const height = geometry.boundingBox!.getSize(new THREE.Vector3()).y;
      geometry.scale(.70 / height, .70 / height, .70 / height);
      geometry.computeBoundingBox();
      this.optimizedWind.prepareBend(geometry, 1.3);
      const placements = spots.filter((_, i) => i % sources.length === species);
      const instances = new THREE.InstancedMesh(geometry, material, placements.length);
      instances.name = `Scanned fern variant ${species + 1}`;
      const transform = new THREE.Object3D();
      placements.forEach((spot, index) => {
        transform.position.set(spot.x, heightAt(spot.x, spot.z) - .015, spot.z);
        transform.rotation.set(0, spot.yaw, 0);
        transform.scale.setScalar(spot.scale);
        transform.updateMatrix();
        instances.setMatrixAt(index, transform.matrix);
        instances.setColorAt(index, new THREE.Color().setHSL(.19, .06, .9 + (index % 4) * .025));
      });
      instances.instanceMatrix.needsUpdate = true;
      if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
      instances.castShadow = true; instances.receiveShadow = true;
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking,
        alphaMap: alpha, alphaTest: .43, side: THREE.DoubleSide });
      applyWind(depth, wind, .055, 1.3);
      this.optimizedWind.apply(depth, true);
      applyPlantPresence(depth, presence, 2.2, .18);
      instances.customDepthMaterial = depth;
      this.optimizedWind.bind(instances);
      instances.computeBoundingSphere();
      if (instances.boundingSphere) instances.boundingSphere.radius += .3;
      useForestBoxCulling(instances, undefined, .4);
      // Asset completion cannot wait for another asset before portal masking.
      applyStencilLayer(instances, layer());
      this.root.add(instances);
    });
  }

  private async buildStumps(heightAt: (x: number, z: number) => number, layer: () => number) {
    const gltf = await new GLTFLoader().loadAsync(assetUrl('/models/forest/balanced/stumps.gltf'));
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    source.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    if (!meshes.length) throw new Error('No stump geometry');
    // Scan is 1.6m across; placements stay life-size and off the walking corridor.
    const spots: ForestSpot[] = [
      { x: -3.4, z: -3.4, yaw: .7, scale: 1.1 },
      { x: 7.8, z: -6.7, yaw: -1.3, scale: .95 },
      { x: -7.2, z: -11.3, yaw: 2.1, scale: 1.28 }
    ];
    spots.forEach((p, i) => this.collisions?.addCircle({ id: `forest-stump-${i}`, x: p.x, z: p.z,
      radius: .67 * p.scale, minY: heightAt(p.x, p.z) - .08, maxY: heightAt(p.x, p.z) + .72 * p.scale }));
    for (const mesh of meshes) {
      const geometry = groundedForestGeometry(mesh);
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial;
      material.roughness = 1; material.normalScale.set(.8, .8);
      material.envMapIntensity = .65;
      for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
        if (texture) texture.anisotropy = 4;
      }
      const instances = new THREE.InstancedMesh(geometry, material, spots.length);
      instances.name = 'Scanned decayed stumps with exposed roots';
      const transform = new THREE.Object3D();
      spots.forEach((spot, i) => {
        transform.position.set(spot.x, heightAt(spot.x, spot.z) - .07, spot.z);
        transform.rotation.set(0, spot.yaw, 0); transform.scale.setScalar(spot.scale);
        transform.updateMatrix(); instances.setMatrixAt(i, transform.matrix);
      });
      instances.instanceMatrix.needsUpdate = true;
      instances.castShadow = true; instances.receiveShadow = true;
      instances.computeBoundingSphere();
      applyStencilLayer(instances, layer()); this.root.add(instances);
      useForestBoxCulling(instances, undefined, .08);
    }
  }
}

/** Replace the old terrain maps atomically, retaining them if a scan is missing. */
export async function loadForestFloor(material: THREE.MeshStandardMaterial, repeat: number) {
  const loader = new THREE.TextureLoader();
  const maps = await Promise.allSettled(['floor-diffuse.jpg', 'floor-normal.jpg', 'floor-roughness.jpg']
    .map(file => loader.loadAsync(assetUrl('/textures/forest/') + file)));
  if (maps.some(result => result.status === 'rejected')) {
    maps.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
    return false;
  }
  const textures = maps.map(result => (result as PromiseFulfilledResult<THREE.Texture>).value);
  textures.forEach((texture, index) => {
    texture.colorSpace = index === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.setScalar(repeat); texture.anisotropy = 4;
  });
  [material.map, material.normalMap, material.roughnessMap] = textures;
  material.normalScale.set(.85, .85);
  // This scan contains autumn leaves. Reduce their chroma before the moss/soil
  // vertex tint, so the living summer glade does not read as a yellow carpet.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float floorLuma = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
      diffuseColor.rgb = mix(vec3(floorLuma), diffuseColor.rgb, .46) * .84;`);
  };
  material.customProgramCacheKey = () => 'forest-floor-natural-chroma-v1';
  material.needsUpdate = true;
  return true;
}
