import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { assetUrl } from '../utils/assetUrl';
import { WorldCollisions } from './WorldCollisions';

export const HELL_RELIC_ASSETS = Object.freeze({
  roots: '/models/hell/dead-quiver-branch-01/branch.gltf',
  remains: '/models/hell/weathered-skull/skull.gltf',
  trees: '/models/hell/skeletal-dead-tree/dead-tree.glb'
});

export const HELL_ROOTS = Object.freeze([
  { x: -1.7, z: -5, height: 1.15, yaw: .9, tilt: 1.23, roll: .15 },
  { x: 3.5, z: -9, height: .9, yaw: -1.1, tilt: 1.4, roll: -.3 },
  { x: -9.6, z: -14.3, height: .75, yaw: 2.4, tilt: 1.1, roll: .2 }
]);
export const HELL_REMAINS = Object.freeze([
  { x: -2.6, z: -5.5, height: .60, yaw: .35 },
  { x: 3, z: -8.2, height: .46, yaw: -.6 },
  { x: -9.3, z: -14, height: .42, yaw: 1.15 }
]);
export const HELL_DEAD_TREES = Object.freeze([
  { x: -11.4, z: -12.5, height: 5.7, yaw: .45 },
  { x: 9.3, z: -13, height: 5.4, yaw: -1.15 }
]);
type Placement = { x: number; z: number; height: number; yaw: number; tilt?: number; roll?: number };

/** Authored silhouettes and grounded remains, kept sparse enough to read as a place. */
export class HellRelics {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';
  readonly assetStatus = { roots: 'loading', remains: 'loading', trees: 'loading' } as Record<keyof typeof HELL_RELIC_ASSETS, string>;

  constructor(parent: THREE.Group, private heightAt: (x: number, z: number) => number,
    private layer: () => number, private collisions: WorldCollisions) {
    this.root.name = 'Charred roots and weathered remains';
    parent.add(this.root);
    this.ready = Promise.all([
      this.load('roots', HELL_ROOTS, 'Fallen scorched wood around the remains'),
      this.load('remains', HELL_REMAINS, 'Weathered remains in cooled ash'),
      this.load('trees', HELL_DEAD_TREES, 'Two skeletal scorched trees')
    ]).then(results => {
      this.status = results.every(Boolean) ? 'ready' : 'fallback';
      applyStencilLayer(this.root, this.layer()); this.recordBudget();
    });
  }

  private async load(kind: keyof typeof HELL_RELIC_ASSETS, placements: readonly Placement[], name: string) {
    const colliderIds: string[] = [];
    let ownedMesh: THREE.InstancedMesh | undefined;
    try {
      const gltf = await new GLTFLoader().loadAsync(assetUrl(HELL_RELIC_ASSETS[kind]));
      gltf.scene.updateMatrixWorld(true);
      const sources: THREE.Mesh[] = [];
      gltf.scene.traverse(object => { if ((object as THREE.Mesh).isMesh) sources.push(object as THREE.Mesh); });
      if (sources.length !== 1 || !(sources[0].material instanceof THREE.MeshStandardMaterial)) {
        throw new Error('Relic asset must contain one textured static mesh');
      }
      const source = sources[0];
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!, center = bounds.getCenter(new THREE.Vector3());
      const height = bounds.max.y - bounds.min.y;
      if (height < 1e-5) throw new Error('Relic has no measurable height');
      geometry.translate(-center.x, -bounds.min.y, -center.z).scale(1 / height, 1 / height, 1 / height);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const material = (source.material as THREE.MeshStandardMaterial).clone();
      material.name = kind === 'remains' ? 'Ash-stained bone' : 'Charred weathered wood';
      material.color.set(kind === 'remains' ? 0xe8dcc4 : kind === 'trees' ? 0x89827b : 0x9b9288);
      material.roughness = .96; material.metalness = 0; material.metalnessMap = null;
      material.normalScale.setScalar(kind === 'remains' ? .45 : .85);
      material.side = THREE.FrontSide;
      const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
      ownedMesh = mesh;
      mesh.name = name; mesh.castShadow = mesh.receiveShadow = false;
      mesh.userData.source = HELL_RELIC_ASSETS[kind];
      mesh.userData.placements = [];
      const transform = new THREE.Object3D(), sample = new THREE.Vector3();
      const p = geometry.getAttribute('position'), footprint: { x: number; z: number }[] = [];
      placements.forEach((placement, index) => {
        transform.position.set(placement.x, 0, placement.z);
        transform.rotation.set(placement.tilt ?? 0, placement.yaw, placement.roll ?? 0);
        transform.scale.setScalar(placement.height); transform.updateMatrix();
        let low = Infinity, high = -Infinity;
        footprint.length = 0;
        for (let i = 0; i < p.count; i++) {
          sample.fromBufferAttribute(p, i).applyMatrix4(transform.matrix);
          footprint.push({ x: sample.x, z: sample.z });
          low = Math.min(low, sample.y); high = Math.max(high, sample.y);
        }
        let seatedY = Infinity;
        for (let i = 0; i < p.count; i++) {
          sample.fromBufferAttribute(p, i).applyMatrix4(transform.matrix);
          if (sample.y <= low + Math.min(.08, placement.height * .12))
            seatedY = Math.min(seatedY, this.heightAt(sample.x, sample.z) - sample.y);
        }
        if (!Number.isFinite(seatedY)) seatedY = this.heightAt(placement.x, placement.z) - low;
        transform.position.y = seatedY - (kind === 'roots' ? .035 : .012);
        transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
        mesh.setColorAt(index, new THREE.Color().setScalar(.85 + index * .065));
        const id = `hell-relic-${kind}-${index}`;
        this.collisions.addPolygon({ id, points: footprint,
          minY: transform.position.y + low, maxY: transform.position.y + high });
        colliderIds.push(id);
        mesh.userData.placements.push({ ...placement, y: transform.position.y });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      this.root.add(mesh); applyStencilLayer(mesh, this.layer());
      this.assetStatus[kind] = 'ready';
      return true;
    } catch {
      // Optional detail never adds invisible colliders or blocks the journey.
      for (const id of colliderIds) this.collisions.remove(id);
      if (ownedMesh) {
        ownedMesh.removeFromParent(); ownedMesh.geometry.dispose();
        for (const material of Array.isArray(ownedMesh.material) ? ownedMesh.material : [ownedMesh.material]) material.dispose();
        ownedMesh.dispose();
      }
      this.assetStatus[kind] = 'fallback';
      return false;
    }
  }

  private recordBudget() {
    let triangles = 0, draws = 0;
    this.root.traverse(object => {
      const mesh = object as THREE.InstancedMesh;
      if (!mesh.isMesh) return;
      draws++; triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 * mesh.count;
    });
    this.root.userData.budget = { triangles, draws, addedLights: 0, addedShadowPasses: 0, status: this.status };
  }
}
