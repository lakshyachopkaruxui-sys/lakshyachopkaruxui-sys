import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { fitProp, measureProp } from './props';

export const SKY_BIRD_MODEL = '/models/Owl.glb';

interface Flyer {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  path: THREE.CatmullRomCurve3;
  period: number;
  phase: number;
}

/**
 * Three enchanted owls above the forest clearing. All coordinates are local to
 * the forest root, including their closed flight paths. The pack's Owl has
 * idle/attack/dead/walk clips, but no flight clip: ForestWingbeat is an authored
 * animation of its real skinned wing joints, not a renamed walking animation.
 */
export class SkyFlock {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private flyers: Flyer[] = [];
  private lastTime = 0;
  private tangent = new THREE.Vector3();
  private nextTangent = new THREE.Vector3();
  private rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  private source: 'loading' | 'owl' | 'procedural' = 'loading';

  constructor(private parent: THREE.Group, private stencilLayer: () => number) {
    this.group.name = 'forest-sky-flock';
    this.ready = this.load();
  }

  /** Read-only numerical inspection without exposing mutable flight controls. */
  get flightState() {
    return {
      source: this.source,
      birds: this.flyers.map(({ group, mixer }) => ({
        position: group.position.clone(),
        rotation: group.quaternion.clone(),
        animationTime: mixer.time
      }))
    };
  }

  private async load() {
    try {
      // loadProp intentionally returns only the scene. Keep the rig and source
      // clips here, and clone skeletons so each owl has its own wing motion.
      const gltf = await new GLTFLoader().loadAsync(SKY_BIRD_MODEL);
      for (let i = 0; i < 3; i++) {
        const model = cloneSkeleton(gltf.scene) as THREE.Group;
        const left = model.getObjectByName('LeftHand');
        const right = model.getObjectByName('RightHand');
        if (!left || !right) throw new Error('Owl model is missing its two wing joints');
        const clip = wingbeatClip(left, right, Math.PI / 2, gltf.animations.find(c => /^idle$/i.test(c.name)));
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        // Measure with both wings extended, not folded down beside the body.
        // The pack's source units and its rest-pose bounds are not flight size.
        mixer.update(0);
        fitProp(model, [1.48, 1.32, 1.40][i]);
        // SkinnedMesh.updateMatrixWorld refreshes its bind inverse after the
        // scale change. updateWorldMatrix alone does not run that override.
        model.updateMatrixWorld(true);
        model.position.sub(measureProp(model).getCenter(new THREE.Vector3()));
        this.styleOwl(model, i);
        mixer.setTime(i * 0.37);
        mixer.timeScale = [1.0, 0.91, 1.08][i];
        this.addFlyer(model, mixer, i);
      }
      this.source = 'owl';
    } catch (error) {
      // A failed asset must still leave visible, articulated birds. This is an
      // original feathered fallback, with a clear diagnostic for asset repair.
      console.warn('SkyFlock: Owl could not load; using feathered windbirds.', error);
      this.group.clear();
      this.flyers = [];
      for (let i = 0; i < 3; i++) {
        const model = fallbackBird(i);
        const mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(wingbeatClip(model.getObjectByName('LeftHand')!, model.getObjectByName('RightHand')!, 0)).play();
        mixer.setTime(i * 0.37);
        mixer.timeScale = [1.0, 0.91, 1.08][i];
        this.addFlyer(model, mixer, i);
      }
      this.source = 'procedural';
    }
    this.update(this.lastTime, 0);
    // Query the CURRENT layer after async loading. A portal may have become
    // the outer world while the asset was loading; never attach one unmasked.
    applyStencilLayer(this.group, this.stencilLayer());
    this.parent.add(this.group);
  }

  private styleOwl(model: THREE.Group, index: number) {
    const tint = new THREE.Color([0xbbe5d8, 0xcac1e9, 0xbfdde6][index]);
    model.traverse(object => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      const material = (source: THREE.Material) => {
        const copy = source.clone() as THREE.MeshStandardMaterial;
        if (copy.color) copy.color.multiply(tint);
        if (copy.emissive) {
          copy.emissive.copy(tint);
          copy.emissiveMap = copy.map;
          copy.emissiveIntensity = 0.055;
          copy.roughness = 0.78;
        }
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material) : material(mesh.material);
      // Three's cached skinned bounds describe one pose, not a whole wingbeat.
      // Three tiny birds are cheaper to keep visible than to remeasure per frame.
      mesh.frustumCulled = false;
      mesh.castShadow = false;
    });
  }

  private addFlyer(model: THREE.Group, mixer: THREE.AnimationMixer, index: number) {
    const group = new THREE.Group();
    group.name = `forest-owl-${index + 1}`;
    group.add(model);
    // Small luminous tail feathers read as enchanted birds, not light balls.
    const plumeMaterial = new THREE.MeshStandardMaterial({
      color: [0x79c8bf, 0xc4a4dd, 0x9ccebd][index],
      emissive: [0x2b8d89, 0x7861a8, 0x558c70][index],
      emissiveIntensity: 0.24, roughness: 0.7, side: THREE.DoubleSide
    });
    for (const side of [-1, 1]) {
      const plume = new THREE.Mesh(featherGeometry(0.36, 0.035), plumeMaterial);
      plume.rotation.y = Math.PI / 2 + side * 0.11;
      plume.position.set(side * 0.045, -0.13, -0.23);
      group.add(plume);
    }
    const scale = [1, 0.87, 0.94][index];
    // The nearest canopy reaches roughly ten metres; keep the full bird above
    // it, including the bottom of its downstroke.
    const y = [3, 3.65, 2.72][index];
    const z = [0, 0.55, -0.5][index];
    const points = [
      [-7.8, 8.6, -7.4], [-7.2, 9.7, -14.8], [-0.5, 10.4, -18.1],
      [6.6, 9.8, -15.4], [7.8, 8.3, -8.2], [2.4, 8.1, -3.5], [-3.1, 8.8, -3.8]
    ].map(([px, py, pz]) => new THREE.Vector3(px * scale, py + y, pz + z));
    const path = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    path.arcLengthDivisions = 240;
    this.flyers.push({ group, mixer, path, period: [39, 46, 43][index], phase: [0.08, 0.43, 0.76][index] });
    this.group.add(group);
  }

  update(time: number, dt: number) {
    this.lastTime = time;
    for (const bird of this.flyers) {
      const phase = THREE.MathUtils.euclideanModulo(time / bird.period + bird.phase, 1);
      bird.path.getPointAt(phase, bird.group.position);
      bird.path.getTangentAt(phase, this.tangent).normalize();
      bird.path.getTangentAt((phase + 0.015) % 1, this.nextTangent).normalize();
      const heading = Math.atan2(this.tangent.x, this.tangent.z);
      const turn = Math.atan2(
        this.tangent.z * this.nextTangent.x - this.tangent.x * this.nextTangent.z,
        this.tangent.x * this.nextTangent.x + this.tangent.z * this.nextTangent.z
      );
      // Models face +Z. Banking uses the local forward axis; a small climb
      // pitch follows the route without tumbling or diving at the participant.
      this.rotation.set(-Math.asin(this.tangent.y), heading, THREE.MathUtils.clamp(-turn * 1.9, -0.27, 0.27));
      bird.group.quaternion.setFromEuler(this.rotation);
      bird.mixer.update(Math.max(0, Math.min(dt, 0.1)));
    }
  }
}

/** Symmetric spread wings with a quicker downstroke and slower recovery. */
function wingbeatClip(left: THREE.Object3D, right: THREE.Object3D, spread: number, idle?: THREE.AnimationClip) {
  const duration = 1.18;
  const times = [0, 0.24, 0.43, 0.65, 0.91, duration];
  const flap = [0, 0.54, -0.38, -0.17, 0.34, 0];
  const axis = new THREE.Vector3(0, 0, 1);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, sign] of [[left, 1], [right, -1]] as const) {
    const values = flap.flatMap(angle => bone.quaternion.clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(axis, sign * (spread + angle))).toArray());
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
  }
  // Retain the pack's modest head/body breathing; wing tracks are authored
  // separately and no locomotion/root translation is allowed into the flight.
  for (const track of idle?.tracks ?? []) {
    if (/^(Head|Spine|Tail)\.quaternion$/.test(track.name)) {
      const copy = track.clone();
      copy.scale(duration / idle!.duration);
      tracks.push(copy);
    }
  }
  return new THREE.AnimationClip('ForestWingbeat', duration, tracks);
}

/** A gently cambered, pointed feather along +X, visible from both sides. */
function featherGeometry(length: number, width: number) {
  const positions: number[] = [], indices: number[] = [];
  const rows = 8;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const breadth = Math.sin(Math.PI * t) * width;
    for (let side = -1; side <= 1; side++) {
      positions.push(t * length, Math.sin(Math.PI * t) * length * 0.065 - side * side * breadth * 0.16,
        side * breadth - t * t * length * 0.16);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 2; col++) {
      const a = row * 3 + col, b = a + 3;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function fallbackBird(index: number) {
  const model = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: [0x386f74, 0x675d81, 0x4b7474][index], roughness: 0.82 });
  const wingMaterial = bodyMaterial.clone();
  wingMaterial.side = THREE.DoubleSide;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), bodyMaterial);
  body.scale.set(0.16, 0.16, 0.3);
  model.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), bodyMaterial);
  head.position.set(0, 0.09, 0.23);
  model.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0xc7ad76, roughness: 0.6 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.04, 0.38);
  model.add(beak);
  for (const sign of [-1, 1]) {
    const wing = new THREE.Group();
    wing.name = sign > 0 ? 'LeftHand' : 'RightHand';
    wing.position.set(sign * 0.12, 0.025, 0);
    for (let i = 0; i < 7; i++) {
      const feather = new THREE.Mesh(featherGeometry(0.47 - i * 0.033, 0.065), wingMaterial);
      feather.position.set(sign * i * 0.018, 0, 0.13 - i * 0.047);
      feather.rotation.y = sign > 0 ? 0.05 + i * 0.1 : Math.PI - 0.05 - i * 0.1;
      wing.add(feather);
    }
    model.add(wing);
  }
  fitProp(model, [1.48, 1.32, 1.40][index]);
  return model;
}
