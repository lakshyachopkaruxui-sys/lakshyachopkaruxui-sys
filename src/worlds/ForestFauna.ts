import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { measureProp } from './props';
import { DeerWalk } from './DeerWalk';
import type { WorldCollisions } from './WorldCollisions';

export interface ForestAnimal {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<'walk' | 'graze' | 'observe', THREE.AnimationAction>;
  phase: number;
  mode: 'walk' | 'graze' | 'observe';
  gait: DeerWalk;
  walkWeight: number;
  grazeWeight: number;
  waypoint: number;
  route: THREE.Vector3[];
  distanceTravelled: number;
  speed: number;
  ignoreIds: ReadonlySet<string>;
  clearance: number;
  bodyRadius: number;
  bodyHalfLength: number;
  bodyHeight: number;
}

const PATHS = [
  [[-4.6, -7.8], [-8.5, -10.8], [-6.5, -16], [-1.5, -17.5], [1.1, -13.8], [-1.6, -9.3]],
  [[-7.1, -12.1], [-3.8, -16.2], [1.4, -17], [1, -12.8], [-3.7, -8.1], [-8, -9]],
  [[9.6, -8.8], [13.7, -12], [11, -17], [7.9, -17.6], [9, -13.2], [11.3, -7.1]]
];

/** Three independent source-animated does forage and walk quietly through the woodland.
 * Their routes belong to this experience; source animation stays on its rig. */
export class ForestFauna {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly animals: ForestAnimal[] = [];
  status: 'loading' | 'ready' | 'unavailable' = 'loading';
  private active = false;
  private elapsed = 0;
  private readonly viewer = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly candidate = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly resolved = new THREE.Vector3();

  constructor(private readonly parent: THREE.Group,
    private readonly heightAt: (x: number, z: number) => number, layer: () => number,
    private readonly collisions?: WorldCollisions) {
    this.root.name = 'Three textured woodland does roaming and foraging';
    parent.add(this.root);
    this.ready = new GLTFLoader().loadAsync(assetUrl('/models/realistic-deer/doe.glb')).then(gltf => {
      const clips = {
        walk: gltf.animations.find(clip => clip.name === 'Idle'),
        graze: gltf.animations.find(clip => clip.name === 'Eat'),
        observe: gltf.animations.find(clip => clip.name === 'LookAround')
      };
      if (!clips.walk || !clips.graze || !clips.observe) throw new Error('Doe source clips missing');
      for (let i = 0; i < 3; i++) {
        const actor = new THREE.Group();
        actor.name = `Woodland doe ${i + 1}`;
        actor.rotation.order = 'YXZ';
        const model = cloneSkeleton(gltf.scene), fit = new THREE.Group();
        fit.add(model); actor.add(fit);
        const mixer = new THREE.AnimationMixer(model);
        const actions = Object.fromEntries(Object.entries(clips).map(([name, clip]) =>
          [name, mixer.clipAction(clip!).play().setEffectiveWeight(name === 'observe' ? 1 : 0)])) as ForestAnimal['actions'];
        // Measure a neutral source pose before asynchronous phases diverge.
        const idle = gltf.animations.find(clip => clip.name === 'Idle')!;
        const initial = mixer.clipAction(idle).play().setEffectiveWeight(1);
        actions.observe.setEffectiveWeight(0); mixer.update(0);
        const bounds = measureProp(fit), size = bounds.getSize(new THREE.Vector3());
        const targetHeight = [1.38, 1.22, 1.33][i];
        fit.scale.setScalar(targetHeight / size.y);
        const fitted = measureProp(fit), center = fitted.getCenter(new THREE.Vector3());
        const horizontal = fitted.getSize(new THREE.Vector3());
        // Enclose the normalized horizontal body box with a capsule; ensure
        // every orientation of that capsule also fits the circular sweep.
        const bodyRadius = horizontal.x * .5 * 1.18 + .04;
        const bodyHalfLength = Math.max(0, horizontal.z * .5 - bodyRadius * .5);
        fit.position.set(-center.x, -fitted.min.y + .018, -center.z);
        initial.setEffectiveWeight(0); actions.observe.setEffectiveWeight(1);
        model.traverse(object => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
          const style = (source: THREE.Material) => {
            const copy = source.clone() as THREE.MeshStandardMaterial;
            copy.envMapIntensity = .75;
            const eye = source.name.toLowerCase().includes('eye');
            copy.roughness = eye ? .38 : .93;
            copy.color.setScalar([1, .97, 1.02][i]);
            if (!eye) applyTawnyFur(copy);
            return copy;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(style) : style(mesh.material);
        });
        const route = PATHS[i].map(([x, z]) => new THREE.Vector3(x, this.heightAt(x, z), z));
        actor.position.copy(route[0]);
        actor.rotation.y = Math.atan2(route[1].x - route[0].x, route[1].z - route[0].z);
        this.root.add(actor);
        const gait = new DeerWalk(actor, model, this.parent, this.heightAt);
        this.animals.push({ gait, walkWeight: 0, grazeWeight: 0, root: actor, mixer, actions, phase: [0, 4.8, 21][i], mode: 'walk',
          waypoint: 1, route, distanceTravelled: 0, speed: 0, ignoreIds: new Set([`forest-doe-${i}`]),
          clearance: Math.max(Math.hypot(horizontal.x, horizontal.z) * .5 + .12, bodyHalfLength + bodyRadius + .04),
          bodyRadius, bodyHalfLength, bodyHeight: targetHeight + .35 });
        this.registerCollider(this.animals[i], i);
        applyStencilLayer(actor, layer());
      }
      this.status = 'ready';
    }).catch(error => { this.status = 'unavailable'; console.warn('Forest deer unavailable.', error); });
    applyStencilLayer(this.root, layer());
  }

  /** Pause behind a closed portal or system menu without teleporting wildlife. */
  updateView(position: THREE.Vector3, active: boolean, _dt: number) {
    this.active = active && [position.x, position.y, position.z].every(Number.isFinite);
    if (this.active) {
      this.parent.updateWorldMatrix(true, false);
      this.parent.worldToLocal(this.viewer.copy(position));
    }
  }

  update(dt: number) {
    const step = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .05) : 0;
    if (!this.active || step === 0) return;
    this.elapsed += step;
    for (let index = 0; index < this.animals.length; index++) {
      const animal = this.animals[index];
      const phase = (this.elapsed + animal.phase) % 36;
      animal.mode = phase < 20 ? 'walk' : phase < 32 ? 'graze' : 'observe';
      const intendedSpeed = animal.mode === 'walk' ? .64 + .08 * Math.sin(phase * .6 + index) : 0;
      animal.speed = THREE.MathUtils.lerp(animal.speed, intendedSpeed, 1 - Math.exp(-step * 5));
      const position = animal.root.position;
      let frameDistance = 0;
      if (animal.speed > .025) {
        let goal = animal.route[animal.waypoint];
        if (Math.hypot(goal.x - position.x, goal.z - position.z) < 1.4) {
          animal.waypoint = (animal.waypoint + 1) % animal.route.length;
          goal = animal.route[animal.waypoint];
        }
        this.direction.subVectors(goal, position).setY(0).normalize();
        const desiredHeading = Math.atan2(this.direction.x, this.direction.z);
        // Look ahead around the same trunks, rocks and shoreline as the visitor.
        let heading: number | undefined;
        for (const offset of [0, .35, -.35, .7, -.7, 1.1, -1.1, 1.6, -1.6]) {
          const angle = desiredHeading + offset;
          this.candidate.set(position.x + Math.sin(angle) * 1.25, position.y, position.z + Math.cos(angle) * 1.25);
          if (this.collisions?.queryLocal(this.candidate.x, this.candidate.z, animal.clearance + .05, 1.5, position.y, animal.ignoreIds)) continue;
          if (Math.hypot(this.candidate.x - this.viewer.x, this.candidate.z - this.viewer.z) < 2.1) continue;
          if (this.animals.some(other => other !== animal && Math.hypot(this.candidate.x - other.root.position.x,
            this.candidate.z - other.root.position.z) < 1.05)) continue;
          heading = angle; break;
        }
        if (heading !== undefined) {
          const difference = Math.atan2(Math.sin(heading - animal.root.rotation.y), Math.cos(heading - animal.root.rotation.y));
          animal.root.rotation.y += THREE.MathUtils.clamp(difference, -step * 2.2, step * 2.2);
          // Slow through sharp turns. Translation follows the actual facing.
          const distance = animal.speed * step * Math.max(0, Math.cos(difference));
          this.desired.set(position.x + Math.sin(animal.root.rotation.y) * distance, position.y,
            position.z + Math.cos(animal.root.rotation.y) * distance);
          if (this.collisions) this.collisions.moveLocal(position, this.desired, { radius: animal.clearance, height: 1.5, ignoreIds: animal.ignoreIds }, this.resolved);
          else this.resolved.copy(this.desired);
          const travelled = Math.hypot(this.resolved.x - position.x, this.resolved.z - position.z);
          animal.distanceTravelled += travelled;
          frameDistance = travelled;
          position.copy(this.resolved); position.y = this.heightAt(position.x, position.z);
          animal.speed = Math.min(animal.speed, travelled / step + .05);
        } else {
          animal.speed = 0; animal.waypoint = (animal.waypoint + 1) % animal.route.length;
        }
      }
      // Follow the ground beneath the whole body, not just its centre. This
      // keeps front and rear legs within reach on the woodland banks.
      const yaw = animal.root.rotation.y, span = .48;
      const fx = Math.sin(yaw) * span, fz = Math.cos(yaw) * span;
      const rx = Math.cos(yaw) * span, rz = -Math.sin(yaw) * span;
      const forwardSlope = (this.heightAt(position.x + fx, position.z + fz) - this.heightAt(position.x - fx, position.z - fz)) / (2 * span);
      const sideSlope = (this.heightAt(position.x + rx, position.z + rz) - this.heightAt(position.x - rx, position.z - rz)) / (2 * span);
      animal.root.rotation.x = THREE.MathUtils.damp(animal.root.rotation.x, THREE.MathUtils.clamp(-Math.atan(forwardSlope), -.24, .24), 6, step);
      animal.root.rotation.z = THREE.MathUtils.damp(animal.root.rotation.z, THREE.MathUtils.clamp(Math.atan(sideSlope), -.2, .2), 6, step);
      const walking = THREE.MathUtils.clamp(frameDistance / step / .18, 0, 1);
      const blend = 1 - Math.exp(-step * 7);
      animal.walkWeight = THREE.MathUtils.lerp(animal.walkWeight, walking, blend);
      animal.grazeWeight = THREE.MathUtils.lerp(animal.grazeWeight, animal.mode === 'graze' ? 1 : 0, blend);
      animal.actions.walk.setEffectiveWeight(animal.walkWeight).setEffectiveTimeScale(.7);
      animal.actions.graze.setEffectiveWeight((1 - animal.walkWeight) * animal.grazeWeight);
      animal.actions.observe.setEffectiveWeight((1 - animal.walkWeight) * (1 - animal.grazeWeight));
      animal.mixer.update(step);
      animal.gait.update(frameDistance, animal.walkWeight);
      this.registerCollider(animal, index);
    }
  }

  private registerCollider(animal: ForestAnimal, index: number) {
    const p = animal.root.position, dx = Math.sin(animal.root.rotation.y) * animal.bodyHalfLength, dz = Math.cos(animal.root.rotation.y) * animal.bodyHalfLength;
    this.collisions?.addCapsule({ id: `forest-doe-${index}`, ax: p.x - dx, az: p.z - dz,
      bx: p.x + dx, bz: p.z + dz, radius: animal.bodyRadius, minY: p.y, maxY: p.y + animal.bodyHeight });
  }
}

/** Reduce the scan's magenta cast while retaining fur texture, pale belly,
 * dark nose and individual markings. Eye materials are deliberately excluded. */
function applyTawnyFur(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float furLight = dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      float furChroma = max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b))
        -min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b));
      float furWeight = smoothstep(.025,.20,furChroma)*.62;
      diffuseColor.rgb = mix(diffuseColor.rgb,furLight*vec3(1.23,.98,.76),furWeight);`);
  };
  material.customProgramCacheKey = () => 'forest-tawny-fur-v1';
  material.userData.forestTawnyFur = true;
}
