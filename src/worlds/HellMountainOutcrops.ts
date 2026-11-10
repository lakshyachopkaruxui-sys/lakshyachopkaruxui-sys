import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { assetUrl } from '../utils/assetUrl';

export const HELL_OUTCROP_ASSET = '/models/hell/rock-face-01/outcrop/outcrop.gltf';
export interface HellMountainOutcropSite {
  /** A point on the actual mountain surface in its owning world's coordinates. */
  position: THREE.Vector3;
  normal: THREE.Vector3;
  height: number;
  /** Small rotation within the slope, around its outward normal. */
  yaw: number;
}

/** Photograph-derived ledges break the smooth mountain surface. One immutable
 * batch shares the existing scan's texture objects; only geometry is downloaded. */
export class HellMountainOutcrops {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';
  private geometry?: THREE.BufferGeometry;
  private material?: THREE.MeshStandardMaterial;
  private mesh?: THREE.InstancedMesh;
  private disposed = false;

  constructor(parent: THREE.Group, sites: readonly HellMountainOutcropSite[],
    private sourceMaterial: THREE.MeshStandardMaterial, private layer: () => number) {
    if (sites.length > 10) throw new RangeError('Mountain outcrops are limited to ten instances');
    const placements = sites.map(site => ({ position: site.position.clone(), normal: site.normal.clone(),
      height: site.height, yaw: site.yaw }));
    this.root.name = 'Embedded photographed mountain ledges';
    parent.add(this.root); this.recordBudget();
    if (!placements.length) {
      this.status = 'ready'; this.recordBudget(); this.ready = Promise.resolve(); return;
    }
    this.ready = new GLTFLoader().loadAsync(assetUrl(HELL_OUTCROP_ASSET)).then(gltf => {
      if (this.disposed) return;
      for (const site of placements) if (!Number.isFinite(site.height) || site.height <= 0 ||
        !Number.isFinite(site.yaw) || ![...site.position, ...site.normal].every(Number.isFinite) || site.normal.lengthSq() < 1e-8)
        throw new Error('Invalid mountain ledge placement');
      gltf.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
      if (meshes.length !== 1) throw new Error('Mountain ledge must contain one static geometry');
      const source = meshes[0];
      this.geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      const p = this.geometry.getAttribute('position');
      if (!p || !this.geometry.getAttribute('normal') || !this.geometry.getAttribute('uv') ||
        (this.geometry.index?.count ?? p.count) / 3 > 2000) throw new Error('Invalid or oversized mountain ledge');
      this.geometry.computeBoundingBox();
      const bounds = this.geometry.boundingBox!, center = bounds.getCenter(new THREE.Vector3());
      const height = bounds.max.y - bounds.min.y;
      if (!Number.isFinite(height) || height < 1e-5) throw new Error('Mountain ledge has no height');
      const halfWidth = (bounds.max.x - bounds.min.x) / height * .5;
      const halfDepth = (bounds.max.z - bounds.min.z) / height * .5;
      this.geometry.translate(-center.x, -bounds.min.y, -center.z).scale(1 / height, 1 / height, 1 / height);
      // This open surface scan faces mostly +Y, rather than +Z. Its rectangular
      // photographed boundary must remain inside the mountain. Keep the original
      // registered UVs and interior relief, but sink only that cut perimeter.
      for (let vertex = 0; vertex < p.count; vertex++) {
        const x = p.getX(vertex), z = p.getZ(vertex);
        const boundary = Math.max(Math.abs(x) / halfWidth, Math.abs(z) / halfDepth) +
          .04 * Math.sin(x * 13 + z * 8) + .025 * Math.sin(z * 21 - x * 5);
        const feather = THREE.MathUtils.smoothstep(boundary, .60, .93);
        const y = p.getY(vertex);
        p.setY(vertex, THREE.MathUtils.lerp(y, Math.min(y, .05), feather));
      }
      p.needsUpdate = true;
      this.geometry.computeVertexNormals();
      this.geometry.computeBoundingBox(); this.geometry.computeBoundingSphere();
      this.material = this.sourceMaterial.clone();
      this.material.name = 'Exposed photographed rock ledge';
      this.material.color.set(0xbfc3c7);
      this.material.roughness = .97;
      const originalCompile = this.sourceMaterial.onBeforeCompile;
      const originalKey = this.sourceMaterial.customProgramCacheKey.call(this.sourceMaterial);
      this.material.onBeforeCompile = (shader, renderer) => {
        originalCompile.call(this.material!, shader, renderer);
        // The source photograph is warm sandstone. Neutral charcoal keeps the
        // retained mineral detail coherent with the surrounding volcanic rock.
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          #include <map_fragment>
          float ledgeLuminance = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, ledgeLuminance * vec3(.94, .97, 1.0), .86) * .68;
        `);
      };
      this.material.customProgramCacheKey = () => originalKey + '|neutral-embedded-ledge-v3';
      this.material.side = THREE.FrontSide;
      this.mesh = new THREE.InstancedMesh(this.geometry, this.material, placements.length);
      this.mesh.name = 'Photographed fractures embedded in the caldera';
      this.mesh.castShadow = this.mesh.receiveShadow = false;
      this.mesh.userData.source = HELL_OUTCROP_ASSET;
      const transform = new THREE.Object3D();
      const scanOutward = new THREE.Vector3(0, 1, 0), twist = new THREE.Quaternion();
      placements.forEach((site, index) => {
        // Aim the photographed relief at the viewer-facing slope, rather than
        // exposing its underside. Most of the scan stays inside the mountain;
        // only its broken central relief interrupts the weathered slope.
        site.normal.normalize();
        transform.position.copy(site.position).addScaledVector(site.normal, -site.height * .65);
        transform.quaternion.setFromUnitVectors(scanOutward, site.normal)
          .multiply(twist.setFromAxisAngle(scanOutward, site.yaw));
        transform.scale.setScalar(site.height);
        transform.updateMatrix(); this.mesh!.setMatrixAt(index, transform.matrix);
        this.mesh!.setColorAt(index, new THREE.Color().setScalar(.92 + (index % 3) * .04));
      });
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.mesh.computeBoundingBox(); this.mesh.computeBoundingSphere();
      this.root.add(this.mesh); applyStencilLayer(this.root, this.layer());
      this.status = 'ready'; this.recordBudget();
    }).catch(() => {
      this.releaseOwned(); this.status = 'fallback'; this.recordBudget();
    });
  }

  private recordBudget() {
    const triangles = this.mesh ? (this.mesh.geometry.index?.count ?? this.mesh.geometry.getAttribute('position').count) / 3 * this.mesh.count : 0;
    this.root.userData.budget = { triangles, draws: this.mesh ? 1 : 0, instances: this.mesh?.count ?? 0,
      extraTextures: 0, addedShadowPasses: 0, sourceLicense: 'CC0-1.0', status: this.status };
  }

  private releaseOwned() {
    this.mesh?.removeFromParent(); this.mesh?.dispose();
    this.geometry?.dispose(); this.material?.dispose();
    this.mesh = undefined; this.geometry = undefined; this.material = undefined;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.releaseOwned(); this.root.removeFromParent();
    this.status = 'fallback'; this.recordBudget();
  }
}
