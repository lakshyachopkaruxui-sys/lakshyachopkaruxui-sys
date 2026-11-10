import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { assetUrl } from '../utils/assetUrl';
import { mulberry32 } from '../utils/math';
import { WorldCollisions, type CollisionPoint } from './WorldCollisions';

export const HELL_CRAG_ASSET = '/models/hell/rock-face-01/rock_face_01_1k.gltf';
export const HELL_CRAGS = [
  { x: -10.8, z: -17.5, yaw: .4, scale: [.85, .9, .75] },
  { x: 8.8, z: -9.6, yaw: -.65, scale: [.9, 1.05, .85] },
  { x: 12.4, z: -24, yaw: -.35, scale: [1.25, 1.45, 1.1] }
] as const;

export interface HellSceneryRiver { points: readonly (readonly number[])[]; width: number }
interface Placement { x: number; z: number; y: number; sx: number; sy: number; sz: number; yaw: number }

/** A few photographed crags and shared rock batches establish scale without new lights or passes. */
export class HellScenery {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';

  constructor(parent: THREE.Group, private heightAt: (x: number, z: number) => number,
    private layer: () => number, private collisions: WorldCollisions,
    groundMaterial?: THREE.MeshStandardMaterial, rivers: readonly HellSceneryRiver[] = []) {
    this.root.name = 'Scanned crags and cooled volcanic banks';
    this.root.userData.source = 'Rock Face 01 — Dario Barresi / Poly Haven, CC0';
    parent.add(this.root);
    if (rivers.length) this.buildBanks(groundMaterial, rivers);
    applyStencilLayer(this.root, layer());
    this.recordBudget();
    this.ready = new GLTFLoader().loadAsync(assetUrl(HELL_CRAG_ASSET)).then(gltf => {
      gltf.scene.updateMatrixWorld(true);
      let source: THREE.Mesh | undefined;
      gltf.scene.traverse(node => { if ((node as THREE.Mesh).isMesh && !source) source = node as THREE.Mesh; });
      if (!source || !(source.material instanceof THREE.MeshStandardMaterial)) throw new Error('Rock scan has no supported mesh');
      this.buildCrags(source);
      // The portal may have changed layers while the model was loading.
      applyStencilLayer(this.root, this.layer());
      this.status = 'ready';
      this.recordBudget();
    }).catch(() => {
      // Existing terrain, lava and creatures remain usable if this optional scan fails.
      this.status = 'fallback';
      applyStencilLayer(this.root, this.layer());
      this.recordBudget();
    });
  }

  private buildCrags(source: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>) {
    const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const center = bounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -bounds.min.y, -center.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const height = geometry.boundingBox!.max.y;
    const footprint = this.horizontalHull(geometry.getAttribute('position'));
    const material = (source.material as THREE.MeshStandardMaterial).clone();
    material.name = 'Charcoal photographed crag';
    material.color.set(0xb8aca2);
    material.roughness = .94;
    material.metalness = 0;
    material.metalnessMap = null;
    material.side = THREE.FrontSide;
    const mesh = new THREE.InstancedMesh(geometry, material, HELL_CRAGS.length);
    mesh.name = 'Three photographed volcanic crags';
    mesh.castShadow = mesh.receiveShadow = false;
    const transform = new THREE.Object3D();
    const point = new THREE.Vector3();
    HELL_CRAGS.forEach((placement, index) => {
      transform.rotation.set(0, placement.yaw, 0);
      transform.scale.set(placement.scale[0], placement.scale[1], placement.scale[2]);
      transform.position.set(placement.x, 0, placement.z);
      transform.updateMatrix();
      const points = footprint.map(p => {
        point.set(p.x, 0, p.z).applyMatrix4(transform.matrix);
        return { x: point.x, z: point.z };
      });
      // Place the whole lower rim below the lowest ground under its footprint.
      // This avoids floating corners on the existing uneven, triangulated ground.
      const lowestGround = Math.min(this.heightAt(placement.x, placement.z), ...points.map(p => this.heightAt(p.x, p.z)));
      const baseY = lowestGround - .20;
      transform.position.y = baseY;
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, new THREE.Color().setScalar(.9 + index * .05));
      this.collisions.addPolygon({ id: 'hell-scanned-crag-' + index, points,
        minY: baseY, maxY: baseY + height * placement.scale[1] });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    this.root.add(mesh);
  }

  private horizontalHull(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): CollisionPoint[] {
    const points = Array.from({ length: position.count }, (_, i) => ({ x: position.getX(i), z: position.getZ(i) }))
      .sort((a, b) => a.x - b.x || a.z - b.z);
    const cross = (a: CollisionPoint, b: CollisionPoint, c: CollisionPoint) =>
      (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const lower: CollisionPoint[] = [], upper: CollisionPoint[] = [];
    for (const p of points) {
      while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  private buildBanks(groundMaterial: THREE.MeshStandardMaterial | undefined, rivers: readonly HellSceneryRiver[]) {
    const random = mulberry32(771308);
    const banks: Placement[] = [], rafts: Placement[] = [];
    for (const river of rivers) for (let segment = 1; segment < river.points.length; segment++) {
      const [ax, az] = river.points[segment - 1], [bx, bz] = river.points[segment];
      const length = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / length, nz = (bx - ax) / length;
      const steps = Math.max(2, Math.ceil(length / 2.3));
      for (let i = 0; i < steps; i++) {
        const t = (i + .25 + random() * .5) / steps;
        const cx = THREE.MathUtils.lerp(ax, bx, t), cz = THREE.MathUtils.lerp(az, bz, t);
        for (const side of [-1, 1]) {
          const offset = river.width * (.85 + random() * .12) * side;
          const x = cx + nx * offset, z = cz + nz * offset;
          const size = river.width * (.24 + random() * .18);
          const sy = .24 + random() * .46;
          banks.push({ x, z, y: this.heightAt(x, z) + sy * .35, sx: size * (1 + random() * .45),
            sy, sz: size, yaw: random() * Math.PI * 2 });
        }
        if (i % 2 === 0) {
          const offset = river.width * (random() - .5) * .32;
          const x = cx + nx * offset, z = cz + nz * offset;
          rafts.push({ x, z, y: this.heightAt(cx, cz) + .18, sx: river.width * (.20 + random() * .16),
            sy: .055 + random() * .07, sz: .65 + random() * .8, yaw: Math.atan2(nx, nz) + random() * .4 });
        }
      }
    }
    // Distribute the bounded counts along all rivers, rather than truncating the far branches.
    const take = (placements: Placement[], maximum: number) => placements.length <= maximum ? placements :
      Array.from({ length: maximum }, (_, i) => placements[Math.floor(i * placements.length / maximum)]);
    this.addRockBatch('Raised broken lava levees', take(banks, 144), groundMaterial, 0x74665f, true);
    this.addRockBatch('Black cooled crust rafts', take(rafts, 42), groundMaterial, 0x3d3835, false);
  }

  private addRockBatch(name: string, placements: Placement[], source: THREE.MeshStandardMaterial | undefined,
    color: number, collidable: boolean) {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const fracture = 1 + .14 * Math.sin(x * 7 + z * 5) + .09 * Math.cos(y * 11 - x * 4);
      position.setXYZ(i, x * fracture, y * fracture, z * fracture);
    }
    geometry.computeVertexNormals();
    const material = source?.clone() ?? new THREE.MeshStandardMaterial();
    material.name = name + ' material';
    material.color.set(color);
    material.roughness = 1;
    material.metalness = 0;
    material.onBeforeCompile = () => {};
    material.customProgramCacheKey = () => 'hell-static-cooled-banks-v1';
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = false;
    const transform = new THREE.Object3D();
    placements.forEach((p, i) => {
      transform.position.set(p.x, p.y, p.z);
      transform.scale.set(p.sx, p.sy, p.sz);
      transform.rotation.set(.07 * Math.sin(i), p.yaw, .05 * Math.cos(i * .7));
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, new THREE.Color().setScalar(.72 + .26 * ((i * .61803399) % 1)));
      // Only reachable bank stones need body obstacles. Lava already has river colliders.
      if (collidable && Math.hypot(p.x, p.z + 3) < 17.3) {
        this.collisions.addCircle({ id: 'hell-bank-rubble-' + i, x: p.x, z: p.z,
          radius: Math.max(p.sx, p.sz) * 1.12, minY: p.y - p.sy * 1.2, maxY: p.y + p.sy * 1.2 });
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    this.root.add(mesh);
  }

  private recordBudget() {
    let triangles = 0, draws = 0;
    this.root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      draws++;
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3 *
        ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
    });
    this.root.userData.budget = { triangles, draws, scannedCrags: this.status === 'ready' ? HELL_CRAGS.length : 0,
      textureMiBWithMipmaps: this.status === 'ready' ? 16 : 0, addedShadowPasses: 0,
      sourceLicense: 'CC0-1.0', status: this.status };
  }
}
