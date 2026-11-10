import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { WorldCollisions } from './WorldCollisions';

export const SHADOW_PATROL_ROUTES = [
  [[-7.6, -8.5], [-4.6, -6.0], [-7.8, -12.1]],
  [[6.3, -15.8], [8.3, -20.2], [1.5, -20.8]]
] as const;

interface HorrorActor {
  id: string; root: THREE.Group; model: THREE.Object3D; head?: THREE.Object3D;
  mixer: THREE.AnimationMixer; idle: THREE.AnimationAction; walk: THREE.AnimationAction;
  route: THREE.Vector3[]; waypoint: number; pause: number; moving: boolean;
  height: number; scale: number; yaw: number; pitch: number; distance: number;
  ignore: Set<string>; headRest?: THREE.Quaternion; baseY: number; soles: {mesh: THREE.SkinnedMesh; index: number}[];
}

/** CC0 HorrorGameMaker creature with its authored skeletal Idle and Walk clips. */
export class ShadowFauna {
  readonly root = new THREE.Group();
  readonly creatures: HorrorActor[] = [];
  readonly animals = this.creatures;
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'failed' = 'loading';
  private elapsed = 0;
  private hintUsed = false;
  private viewer = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private resolved = new THREE.Vector3();
  private target = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private parentQuaternion = new THREE.Quaternion();
  private inverseRoot = new THREE.Matrix4();

  constructor(parent: THREE.Group, private heightAt: (x: number, z: number) => number,
    private layer: () => number, readonly collisions = new WorldCollisions(parent)) {
    this.root.name = 'animated horror woodland inhabitants'; parent.add(this.root);
    this.ready = new GLTFLoader().loadAsync(assetUrl('/models/shadow/horror-humanoid/horror-humanoid.gltf')).then(gltf => {
      const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
      const walkClip = THREE.AnimationClip.findByName(gltf.animations, 'Walk');
      if (!idleClip || !walkClip) throw new Error('Horror creature lacks authored locomotion');
      const routes = SHADOW_PATROL_ROUTES;
      routes.forEach((points, index) => {
        const root = new THREE.Group(), model = clone(gltf.scene);
        root.name = 'patrolling horror ' + index; root.add(model); this.root.add(root);
        const mixer = new THREE.AnimationMixer(model);
        const idle = mixer.clipAction(idleClip), walk = mixer.clipAction(walkClip);
        idle.play(); walk.play(); walk.setEffectiveWeight(0); mixer.update(0);
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
        const height = index === 0 ? 2.45 : 2.25, scale = height / (bounds.max.y - bounds.min.y);
        model.scale.setScalar(scale); model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
        model.traverse(node => { if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh; mesh.castShadow = mesh.receiveShadow = true;
          // Authored skin maps are preserved; no palette tint or substitute eyes.
          mesh.frustumCulled = false;
        } });
        const route = points.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z));
        root.position.copy(route[0]); root.rotation.y = Math.atan2(-root.position.x, 2 - root.position.z);
        root.updateMatrixWorld(true);
        const soles: HorrorActor['soles']=[];
        model.traverse(node=>{if(!(node as THREE.SkinnedMesh).isSkinnedMesh)return;const mesh=node as THREE.SkinnedMesh;
          for(let i=0;i<mesh.geometry.attributes.position.count;i++){
            mesh.getVertexPosition(i,this.target).applyMatrix4(mesh.matrixWorld);root.worldToLocal(this.target);
            if(this.target.y<.17)soles.push({mesh,index:i});
          }
        });
        const head = model.getObjectByName('fbx__joint1__joint2__joint3__joint4');
        const actor: HorrorActor = { id: 'shadow-creature-' + index, root, model, head,
          mixer, idle, walk, route, waypoint: 1, pause: index ? 3.2 : .9, moving: false,
          height, scale, yaw: 0, pitch: 0, distance: 0, ignore: new Set(['shadow-creature-' + index]),
          headRest: head?.quaternion.clone(), baseY:model.position.y, soles };
        this.creatures.push(actor); this.register(actor);
      });
      applyStencilLayer(this.root, this.layer()); this.status = 'ready';
    }).catch(error => { this.status = 'failed'; console.error('Shadow creature unavailable', error); });
  }

  update(viewerWorld: THREE.Vector3, active: boolean, dt: number) {
    if (!active || this.status !== 'ready' || ![dt, viewerWorld.x, viewerWorld.y, viewerWorld.z].every(Number.isFinite) || dt <= 0) return;
    const delta = Math.min(dt, .1), ease = 1 - Math.exp(-delta * 2.2);
    this.elapsed += delta; this.root.updateWorldMatrix(true, true);
    this.inverseRoot.copy(this.root.matrixWorld).invert();
    this.viewer.copy(viewerWorld).applyMatrix4(this.inverseRoot);
    for (const actor of this.creatures) {
      actor.pause = Math.max(0, actor.pause - delta);
      const routeTarget = actor.route[actor.waypoint];
      this.target.subVectors(routeTarget, actor.root.position); this.target.y = 0;
      let moving = actor.pause === 0 && this.target.length() > .20;
      const separation = Math.hypot(actor.root.position.x - this.viewer.x, actor.root.position.z - this.viewer.z);
      if (separation < 3.75) moving = false;
      if (moving) {
        this.desired.copy(actor.root.position).addScaledVector(this.target.normalize(), delta * .46);
        // Stop before entering the visitor's space; never move the camera or hide the actor.
        if (Math.hypot(this.desired.x - this.viewer.x, this.desired.z - this.viewer.z) < 3.75) moving = false;
        else {
          this.collisions.moveLocal(actor.root.position, this.desired, { radius: .70, height: actor.height, ignoreIds: actor.ignore }, this.resolved);
          const distance = Math.hypot(this.resolved.x - actor.root.position.x, this.resolved.z - actor.root.position.z);
          if (distance < delta * .08) {
            moving = false; actor.pause = 2.4; actor.waypoint = (actor.waypoint + 1) % actor.route.length;
          } else {
            actor.distance += distance; actor.root.position.copy(this.resolved);
            actor.root.position.y = this.heightAt(actor.root.position.x, actor.root.position.z);
          }
        }
      } else if (actor.pause === 0 && this.target.length() <= .20) {
        actor.pause = 3.5; actor.waypoint = (actor.waypoint + 1) % actor.route.length;
      }
      if (moving !== actor.moving) {
        (moving ? actor.walk : actor.idle).reset().setEffectiveTimeScale(moving ? .68 : 1).setEffectiveWeight(1).play();
        (moving ? actor.idle : actor.walk).crossFadeTo(moving ? actor.walk : actor.idle, .55, false);
        actor.moving = moving;
      }
      const facing = moving ? Math.atan2(this.target.x, this.target.z) : Math.atan2(this.viewer.x - actor.root.position.x, this.viewer.z - actor.root.position.z);
      const difference = Math.atan2(Math.sin(facing - actor.root.rotation.y), Math.cos(facing - actor.root.rotation.y));
      actor.root.rotation.y += difference * (1 - Math.exp(-delta * (moving ? 1.3 : .7)));
      // Restore the previous animation pose before the mixer samples; untracked
      // head nodes must not accumulate the post-animation gaze offset.
      if (actor.head && actor.headRest) actor.head.quaternion.copy(actor.headRest);
      actor.mixer.update(delta);
      // Pin the currently supporting sole to the rendered terrain. The authored
      // gait still lifts the other foot; terrain never edits shared mesh vertices.
      actor.model.position.y=actor.baseY;actor.root.updateMatrixWorld(true);
      let soleGap=Infinity;
      for(const sole of actor.soles){sole.mesh.getVertexPosition(sole.index,this.target).applyMatrix4(sole.mesh.matrixWorld);
        this.target.applyMatrix4(this.inverseRoot);soleGap=Math.min(soleGap,this.target.y-this.heightAt(this.target.x,this.target.z));}
      if(Number.isFinite(soleGap))actor.model.position.y-=soleGap;
      actor.root.updateMatrixWorld(true);

      if (actor.head && actor.headRest) {
        actor.headRest.copy(actor.head.quaternion);
        actor.root.updateMatrixWorld(true);
        actor.root.worldToLocal(this.target.copy(viewerWorld));
        const yaw = THREE.MathUtils.clamp(Math.atan2(this.target.x, this.target.z), -.42, .42);
        actor.yaw += (yaw - actor.yaw) * ease;
        // Rotate around owning-world up, expressed in the animated head parent's frame.
        actor.head.parent!.getWorldQuaternion(this.parentQuaternion).invert();
        this.root.getWorldQuaternion(this.quaternion);
        this.axis.set(0, 1, 0).applyQuaternion(this.quaternion).applyQuaternion(this.parentQuaternion).normalize();
        this.quaternion.setFromAxisAngle(this.axis, actor.yaw);
        actor.head.quaternion.premultiply(this.quaternion).normalize();
      }
      this.register(actor);
    }
  }
  consumeReturnHint() { if (this.elapsed < 11 || this.hintUsed) return false; this.hintUsed = true; return true; }
  private register(actor: HorrorActor) {
    this.collisions.addCircle({ id: actor.id, x: actor.root.position.x, z: actor.root.position.z,
      radius: .70, minY: actor.root.position.y, maxY: actor.root.position.y + actor.height });
  }
}
