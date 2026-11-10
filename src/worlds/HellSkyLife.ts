import * as THREE from 'three';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { assetUrl } from '../utils/assetUrl';

export const HELL_SKY_LIFE_ASSET = '/models/hell/sky-life/vampire-flight.json';
export const HELL_SKY_LIFE_COUNT = 7;

interface AttributeDescription {
  offset: number; bytes: number; components: number; count: number; type: 'uint16' | 'float32';
}
interface FlightAsset {
  triangles: number; vertices: number; morphPoses: number; binaryBytes: number;
  accessors: Record<string, AttributeDescription>;
}
interface Flyer {
  path: THREE.CatmullRomCurve3; period: number; phase: number; size: number; wingRate: number;
  position: THREE.Vector3;
}

/** Seven textured CC0 vampire bats share one instanced, texture-backed morph draw.
 * The actual eight-frame Bat_Flying action was baked offline; no skinning,
 * geometry rebuilding, individual animation mixers or shadow passes run here.
 */
export class HellSkyLife {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'failed' = 'loading';
  private batch?: THREE.InstancedMesh;
  private morphSource?: THREE.Mesh;
  private flyers: Flyer[] = [];
  private time = 0;
  private dummy = new THREE.Object3D();
  private tangent = new THREE.Vector3();
  private nextTangent = new THREE.Vector3();
  private before = new THREE.Vector3();
  private after = new THREE.Vector3();
  private colorMap?: THREE.Texture;
  private normalMap?: THREE.Texture;

  constructor(parent: THREE.Group, private heightAt: (x: number, z: number) => number,
    private layer: () => number) {
    this.root.name = 'Crimson dusk vampire bat flights';
    parent.add(this.root);
    this.ready = this.load();
  }

  private async load() {
    try {
      const loader = new THREE.TextureLoader();
      const [metadataResult, binaryResult, colorResult, normalResult] = await Promise.allSettled([
        fetch(assetUrl(HELL_SKY_LIFE_ASSET)),
        fetch(assetUrl('/models/hell/sky-life/vampire-flight.bin')),
        loader.loadAsync(assetUrl('/models/hell/sky-life/vampire-color-1k.jpg')),
        loader.loadAsync(assetUrl('/models/hell/sky-life/vampire-normal-512.jpg'))
      ]);
      // Wait for every optional request so a sibling texture cannot finish
      // after the failure handler and escape owned-resource cleanup.
      if (colorResult.status === 'fulfilled') this.colorMap = colorResult.value;
      if (normalResult.status === 'fulfilled') this.normalMap = normalResult.value;
      if (metadataResult.status === 'rejected') throw metadataResult.reason;
      if (binaryResult.status === 'rejected') throw binaryResult.reason;
      if (colorResult.status === 'rejected') throw colorResult.reason;
      if (normalResult.status === 'rejected') throw normalResult.reason;
      const metadataResponse = metadataResult.value, binaryResponse = binaryResult.value;
      const color = colorResult.value, normal = normalResult.value;
      if (!metadataResponse.ok || !binaryResponse.ok) throw new Error('Vampire bat data unavailable');
      const metadata = await metadataResponse.json() as FlightAsset;
      const binary = await binaryResponse.arrayBuffer();
      if (metadata.morphPoses !== 8 || metadata.triangles > 2100 || metadata.vertices > 2200 || binary.byteLength !== metadata.binaryBytes) {
        throw new Error('Vampire bat geometry exceeds its verified runtime budget');
      }
      const attribute = (name: string) => {
        const entry = metadata.accessors[name];
        if (!entry || entry.offset < 0 || entry.offset + entry.bytes > binary.byteLength) throw new Error(`Invalid bat attribute: ${name}`);
        const array = entry.type === 'uint16'
          ? new Uint16Array(binary, entry.offset, entry.count * entry.components)
          : new Float32Array(binary, entry.offset, entry.count * entry.components);
        return new THREE.BufferAttribute(array, entry.components);
      };
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', attribute('position'));
      geometry.setAttribute('normal', attribute('normal'));
      geometry.setAttribute('uv', attribute('uv'));
      geometry.setIndex(attribute('index'));
      geometry.morphTargetsRelative = false;
      geometry.morphAttributes.position = [];
      geometry.morphAttributes.normal = [];
      for (let i = 0; i < 8; i++) {
        geometry.morphAttributes.position.push(attribute(`pose${i}`));
        geometry.morphAttributes.normal.push(attribute(`normal${i}`));
      }
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      color.colorSpace = THREE.SRGBColorSpace;
      color.anisotropy = normal.anisotropy = 2;
      const material = new THREE.MeshStandardMaterial({
        color: 0x99958f, map: color, normalMap: normal, normalScale: new THREE.Vector2(.55, .55),
        roughness: .93, metalness: 0, emissive: 0x28130d, emissiveIntensity: .025,
        side: THREE.DoubleSide
      });
      this.batch = new THREE.InstancedMesh(geometry, material, HELL_SKY_LIFE_COUNT);
      this.batch.name = 'Seven real vampire bat silhouettes in one flight batch';
      this.batch.castShadow = this.batch.receiveShadow = false;
      this.batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // These fixed local bounds include every route, all wing poses and the
      // largest 3.5 m individual. Turning never invalidates a cached pose bound.
      this.batch.boundingBox = new THREE.Box3(new THREE.Vector3(-42, 3.6, -64), new THREE.Vector3(42, 36, 34));
      this.batch.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 18, -14), 65);
      this.morphSource = new THREE.Mesh(geometry, material);
      this.makeRoutes();
      this.flyers.forEach((_, i) => this.batch!.setColorAt(i, new THREE.Color([0xbdb8b1, 0x9b948f, 0xa8a09b, 0xc5b3a5, 0xa59e98, 0x9e9691, 0xb2a69e][i])));
      this.update(this.time);
      applyStencilLayer(this.batch, this.layer());
      this.root.add(this.batch);
      this.status = 'ready';
    } catch (error) {
      this.status = 'failed';
      this.colorMap?.dispose(); this.normalMap?.dispose();
      console.warn('Optional Strange World sky life unavailable', error);
    }
  }

  private makeRoutes() {
    const routes = [
      [[-13, 9.2, -8], [-7, 7.7, -14], [4, 8.5, -18], [14, 10.7, -16], [16, 12.1, -7], [3, 10.2, 1], [-12, 9.4, -3]],
      [[12, 12.1, -20], [6, 10.4, -12], [-4, 9.9, -8], [-15, 12.7, -16], [-16, 16.7, -29], [-2, 19.1, -30]],
      [[-20, 18.2, -24], [-10, 20.1, -34], [6, 23.2, -36], [16, 22.3, -28], [19, 17.1, -16], [4, 14.6, -20]],
      [[-20, 22.1, -38], [-15, 26.6, -48], [0, 27.4, -54], [16, 24.5, -47], [19, 22.7, -33], [1, 21.9, -31]],
      [[19, 15.6, -18], [25, 19.5, -30], [19, 24.3, -44], [7, 25.6, -48], [6, 23.8, -33]],
      // Two high, wide basin circuits keep the side/rear sky inhabited when
      // the visitor turns away from the five hero/caldera flight paths.
      [[-24, 18.2, -14], [-27, 21.1, 4], [-17, 23.1, 21], [4, 24.2, 25], [23, 22.3, 15], [28, 20.2, -5], [18, 22.1, -24], [-6, 23.2, -26]],
      [[24, 25.1, -17], [29, 27.1, 4], [19, 29.1, 23], [-2, 28.2, 27], [-24, 26.1, 15], [-27, 24.3, -7], [-11, 26.2, -27], [12, 29.1, -29]]
    ];
    for (let i = 0; i < routes.length; i++) {
      const points = routes[i].map(([x, y, z]) => new THREE.Vector3(x, Math.max(y, this.heightAt(x, z) + 8), z));
      const path = new THREE.CatmullRomCurve3(points, true, 'centripetal');
      path.arcLengthDivisions = 320;
      this.flyers.push({ path, period: [42, 49, 62, 76, 67, 64, 83][i],
        phase: [.11, .47, .24, .65, .83, .53, .94][i], size: [1.25, 1.04, .94, 1.08, .86, .9, 1.15][i],
        wingRate: [1.65, 1.82, 1.51, 1.44, 1.72, 1.56, 1.38][i], position: new THREE.Vector3() });
    }
  }

  refreshStencil() { applyStencilLayer(this.root, this.layer()); }

  update(t: number) {
    if (!Number.isFinite(t)) return;
    this.time = Math.max(0, t);
    if (!this.batch || !this.morphSource) return;
    const weights = this.morphSource.morphTargetInfluences!;
    for (let i = 0; i < this.flyers.length; i++) {
      const flyer = this.flyers[i];
      const u = (this.time / flyer.period + flyer.phase) % 1;
      flyer.path.getPointAt(u, flyer.position);
      // Curve.getTangentAt allocates temporary vectors internally. Sample
      // adjacent arc-distance points into reusable storage instead.
      flyer.path.getPointAt((u + .999) % 1, this.before);
      flyer.path.getPointAt((u + .001) % 1, this.after);
      this.tangent.subVectors(this.after, this.before).normalize();
      flyer.path.getPointAt((u + .007) % 1, this.before);
      flyer.path.getPointAt((u + .009) % 1, this.after);
      this.nextTangent.subVectors(this.after, this.before).normalize();
      this.dummy.position.copy(flyer.position);
      const yaw = Math.atan2(this.tangent.x, this.tangent.z);
      const pitch = -Math.atan2(this.tangent.y, Math.hypot(this.tangent.x, this.tangent.z));
      const turn = this.tangent.z * this.nextTangent.x - this.tangent.x * this.nextTangent.z;
      this.dummy.rotation.set(pitch, yaw, THREE.MathUtils.clamp(-turn * 4.5, -.58, .58), 'YXZ');
      this.dummy.scale.setScalar(flyer.size);
      this.dummy.updateMatrix();
      this.batch.setMatrixAt(i, this.dummy.matrix);
      // Smooth glides alternate with independently phased authored wingbeats.
      // Absolute poses and normal poses share the same convex weights.
      const flap = THREE.MathUtils.smoothstep(Math.sin(this.time * .42 + i * 1.67), -.1, .45);
      const beat = (this.time * flyer.wingRate + i * .317) % 1 * 8;
      const first = Math.floor(beat), second = (first + 1) % 8, fraction = beat - first;
      weights.fill(0); weights[0] = 1 - flap;
      weights[first] += flap * (1 - fraction); weights[second] += flap * fraction;
      this.batch.setMorphAt(i, this.morphSource);
    }
    this.batch.instanceMatrix.needsUpdate = true;
    if (this.batch.morphTexture) this.batch.morphTexture.needsUpdate = true;
  }

  /** Positions are root-local, matching the owning world's ground and actors. */
  getAudioPositions(out: THREE.Vector3[]) {
    for (let i = 0; i < this.flyers.length; i++) (out[i] ??= new THREE.Vector3()).copy(this.flyers[i].position);
    return this.flyers.length;
  }

  get budget() {
    return { birds: this.flyers.length, triangles: this.batch ? this.batch.geometry.index!.count / 3 * this.batch.count : 0,
      drawBatches: this.batch ? 1 : 0, perFrameMatrixBytes: HELL_SKY_LIFE_COUNT * 16 * 4,
      perFrameMorphWeightBytes: HELL_SKY_LIFE_COUNT * 9 * 4, lights: 0, shadowCasters: 0 };
  }

  dispose() {
    this.batch?.dispose();
    this.batch?.geometry.dispose();
    if (this.batch) (this.batch.material as THREE.Material).dispose();
    this.colorMap?.dispose(); this.normalMap?.dispose();
    this.root.removeFromParent(); this.flyers.length = 0;
  }
}
