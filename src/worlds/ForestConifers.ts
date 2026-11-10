import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { mulberry32 } from '../utils/math';
import { applyWind } from './props';
import type { WorldCollisions } from './WorldCollisions';
import { ForestGrassWind } from './ForestGrassWind';
import { useForestBoxCulling } from './ForestCulling';
import { forestLeafMaterial } from './ForestLeafMaterial';

export interface ConiferSpot { x: number; z: number; scale: number; yaw: number; variant: number }
export interface ForestTreeBase { x: number; z: number; scale: number }

const ROOT_COLLAR_DEPTH = .145;

/** Uneven stands and young edge growth; no repeated rows or circular tree wall. */
export function coniferSpots(): ConiferSpot[] {
  const random = mulberry32(771832);
  const spots: ConiferSpot[] = [
    [-4.7, -4.8, .85, 0], [4.5, -5.4, .92, 1], [-8.2, -.7, 1.02, 1],
    [9.4, -2.1, .9, 0], [-9.2, -9.7, 1, 1], [2.2, -19.6, 1.12, 0],
    [-5.8, -2.4, .3, 2], [3.4, -2.7, .25, 2], [-9.4, -5.9, .42, 2],
    [10.1, -5.1, .36, 2], [-3.7, -17, .4, 2], [10.7, -18.4, .43, 2]
  ].map(([x, z, scale, variant]) => ({ x, z, scale, variant, yaw: random() * Math.PI * 2 }));
  for (let attempt = 0; spots.length < 76 && attempt < 3000; attempt++) {
    const angle = random() * Math.PI * 2, distance = 7.5 + random() ** .6 * 29;
    const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance - 9;
    if (Math.abs(x - Math.sin(z * .15) * 1.25) < 2.4 && z > -26 && z < 2) continue;
    if (Math.hypot((x - 5) / 3.5, (z + 9) / 5.4) < 1) continue;
    if (spots.some(other => Math.hypot(x - other.x, z - other.z) < 3.0)) continue;
    spots.push({ x, z, yaw: random() * Math.PI * 2, scale: .65 + random() * .58,
      variant: distance < 19 && spots.length % 3 === 0 ? 1 : 2 });
  }
  // Young growth gathers in uneven pockets under the tall canopy. The open
  // route remains legible, while these low branches hide the far meadow edge.
  for (const [cx, cz] of [[-13, -19], [-6, -23], [4, -27], [16, -20], [-17, -5], [16, -5], [6, 8], [-8, 10]]) {
    for (let i = 0; i < 5; i++) {
      const angle = random() * Math.PI * 2, distance = .8 + random() * 3.6;
      const x = cx + Math.cos(angle) * distance, z = cz + Math.sin(angle) * distance;
      if (spots.some(other => Math.hypot(x - other.x, z - other.z) < .9)) continue;
      spots.push({ x, z, scale: .19 + random() * .26, yaw: random() * Math.PI * 2, variant: 2 });
    }
  }
  return spots;
}

/** Creator-authored Poly Haven fir LODs, original photographed bark/needle maps. */
export class ForestConifers {
  readonly root = new THREE.Group();
  readonly optimizedWind = new ForestGrassWind();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'unavailable' = 'loading';
  readonly spots = coniferSpots();
  /** Measured trunk axes in forest-local metres, populated before ready resolves. */
  readonly bases: ForestTreeBase[] = [];
  constructor(parent: THREE.Group, ground: (x: number, z: number) => number,
    layer: () => number, wind: THREE.IUniform, collisions: WorldCollisions) {
    this.root.name = 'Poly Haven conifer forest: real tree models and scanned materials';
    parent.add(this.root);
    this.ready = new GLTFLoader().loadAsync(assetUrl('/models/forest/balanced/conifers.gltf')).then(gltf => {
      gltf.scene.updateMatrixWorld(true);
      for (let variant = 0; variant < 3; variant++) {
        const meshes: THREE.Mesh[] = [];
        gltf.scene.traverse(object => {
          if ((object as THREE.Mesh).isMesh && object.name.startsWith(`fir_tree_01_${'abc'[variant]}_LOD2`)) meshes.push(object as THREE.Mesh);
        });
        if (!meshes.length) throw new Error('Missing fir variant');
        const bounds = new THREE.Box3();
        meshes.forEach(mesh => bounds.union(new THREE.Box3().setFromObject(mesh)));
        const center = bounds.getCenter(new THREE.Vector3());
        const spots = this.spots.filter(spot => spot.variant === variant);
        const trunkPoints: THREE.Vector3[] = [];
        const sources = meshes.map(source => {
          const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
          geometry.translate(-center.x, -bounds.min.y, -center.z);
          geometry.computeBoundingBox();
          const foliage = (source.material as THREE.MeshStandardMaterial).name.includes('twig');
          if (!foliage) {
            const p = geometry.attributes.position;
            for (let i = 0; i < p.count; i++) if (p.getY(i) < 1.6)
              trunkPoints.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
          }
          return { source, geometry, foliage };
        });
        const visible = trunkPoints.filter(p => p.y >= ROOT_COLLAR_DEPTH).map(p => new THREE.Vector2(p.x, p.z));
        const collar = trunkPoints.filter(p => p.y < ROOT_COLLAR_DEPTH);
        if (!visible.length || !collar.length) throw new Error('Missing measured fir trunk or root collar');
        const axis = new THREE.Box2().setFromPoints(visible).getCenter(new THREE.Vector2());
        const radius = Math.max(...visible.map(p => p.distanceTo(axis)));
        const placements = new Map<ConiferSpot, { base: ForestTreeBase; y: number }>();
        for (const spot of spots) {
          const cos = Math.cos(spot.yaw), sin = Math.sin(spot.yaw);
          const base = { x: spot.x + (axis.x * cos + axis.y * sin) * spot.scale,
            z: spot.z + (-axis.x * sin + axis.y * cos) * spot.scale, scale: spot.scale };
          // Seat the real trunk, not its lopsided canopy centre. Sample the
          // scan's shallow soil collar too, so downhill edges cannot hover.
          let y = ground(base.x, base.z);
          for (const p of collar) {
            const x = spot.x + (p.x * cos + p.z * sin) * spot.scale;
            const z = spot.z + (-p.x * sin + p.z * cos) * spot.scale;
            y = Math.min(y, ground(x, z) - p.y * spot.scale);
          }
          placements.set(spot, { base, y });
          this.bases.push(base);
        }
        for (const { source, geometry, foliage } of sources) {
          const original = (source.material as THREE.MeshStandardMaterial).clone();
          original.roughness = .94; original.envMapIntensity = .75;
          original.transparent = false;
          if (foliage) {
            original.alphaTest = .43; original.side = THREE.DoubleSide;
            // Tiny needle cutouts need diffuse daylight, not glossy PBR or
            // normal-map evaluation through every overlapping canopy layer.
            original.normalMap = null; original.roughnessMap = null; original.aoMap = null;
            original.emissiveIntensity = .06;
          }
          const material = foliage ? forestLeafMaterial(original) : original;
          for (const texture of [original.map, original.normalMap, original.roughnessMap]) if (texture) texture.anisotropy = 4;
          applyWind(material, wind, foliage ? .002 : .0004, 1.7);
          this.optimizedWind.apply(material, true);
          this.optimizedWind.prepareBend(geometry, 1.7);
          // Spatial batches let the renderer reject stands behind the viewer;
          // a single world-sized instance bound would draw every distant tree.
          const batches = new Map<string, ConiferSpot[]>();
          spots.forEach(spot => {
            const key = `${Math.floor(spot.x / 24)}:${Math.floor(spot.z / 24)}`;
            if (!batches.has(key)) batches.set(key, []);
            batches.get(key)!.push(spot);
          });
          for (const batch of batches.values()) {
          const instances = new THREE.InstancedMesh(geometry, material, batch.length);
          instances.updateMatrix(); instances.matrixAutoUpdate = false;
          instances.name = `Scanned-material fir ${'abc'[variant]} ${foliage ? 'needles' : 'wood'} ${source.name}`;
          const matrix = new THREE.Object3D();
          batch.forEach((spot, i) => {
            matrix.position.set(spot.x, placements.get(spot)!.y, spot.z);
            matrix.rotation.set(0, spot.yaw, 0); matrix.scale.setScalar(spot.scale); matrix.updateMatrix();
            instances.setMatrixAt(i, matrix.matrix);
          });
          instances.instanceMatrix.needsUpdate = true;
          instances.castShadow = batch.some(spot => Math.hypot(spot.x, spot.z + 4) < 25);
          instances.receiveShadow = true;
          if (foliage) {
            const depth = new THREE.MeshDepthMaterial({ map: material.map, alphaTest: .43,
              depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
            applyWind(depth, wind, .002, 1.7); this.optimizedWind.apply(depth, true); instances.customDepthMaterial = depth;
          }
          this.optimizedWind.bind(instances);
          instances.computeBoundingSphere();
          if (instances.boundingSphere) instances.boundingSphere.radius += .4;
          const maxScale = Math.max(...batch.map(spot => spot.scale));
          const windPadding = (foliage ? .002 : .0004) * Math.pow(Math.max(0, geometry.boundingBox!.max.y), 1.7) * 1.8 * maxScale;
          useForestBoxCulling(instances, undefined, Math.max(.4, windPadding));
          applyStencilLayer(instances, layer()); this.root.add(instances);
          }
        }
        // Contact shade and collisions share the measured visible trunk axis.
        spots.forEach((spot, i) => {
          const { base, y } = placements.get(spot)!;
          collisions.addCircle({ id: `forest-fir-${variant}-${i}`,
          x: base.x, z: base.z,
          radius: radius * spot.scale,
          minY: y, maxY: y + bounds.getSize(new THREE.Vector3()).y * spot.scale });
        });
      }
      this.status = 'ready';
    }).catch(error => { this.status = 'unavailable'; console.warn('Conifer forest assets unavailable.', error); });
    applyStencilLayer(this.root, layer());
  }
}
