import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { fitProp, standOnOrigin } from './props';
import { clamp, damp, mulberry32, smoothstep } from '../utils/math';
import type { AudioEngine } from '../audio/AudioEngine';
import { cryBuffer } from '../audio/synth';

export type CreatureState = 'wander' | 'notice' | 'approach' | 'sniff' | 'greet' | 'guide' | 'startle' | 'retreat';

// Yellow blob: reads clearly against a green forest (the green one hid in it).
export const CREATURE_MODEL = '/models/minion-c01.glb';
const MODEL = CREATURE_MODEL;
const CLIPS = { idle: [0, 29], attack: [30, 59] } as const;
const FPS = 24;

/**
 * A small creature living in World Two that discovers the user.
 * It wanders and hops; when light spills through the tear it notices,
 * approaches, sniffs at the opening, and bolts if the tear rips violently.
 * Model: gobkit.com free pack (CC0). Blobs have no walk clip, so hopping is
 * procedural — squash on landing, idle clip playing throughout.
 */
export class Creature {
  readonly group = new THREE.Group();
  state: CreatureState = 'wander';
  ready = false;
  /** Called once the model is in the scene, so its world can re-apply layers. */
  onLoaded?: () => void;
  /** Height at a parent-local x/z, matching the creature's terrain root. */
  groundAt?: (x: number, z: number) => number;
  private mixer?: THREE.AnimationMixer;
  private actions: Record<string, THREE.AnimationAction> = {};
  private shadow: THREE.Mesh;
  private body = new THREE.Group();
  private target = new THREE.Vector3();
  private station = new THREE.Vector3();
  private stateTime = 0;
  private wave = 0;
  private hopPhase = 0;
  private speed = 0;
  private rng = mulberry32(41);
  private cry?: THREE.PositionalAudio;
  private cryBuffers: AudioBuffer[] = [];
  private lastCry = -10;
  private tmp = new THREE.Vector3();
  private parentInverse = new THREE.Matrix4();
  private localTear = new THREE.Vector3();
  private localForward = new THREE.Vector3();
  private localPlayer = new THREE.Vector3();

  /** Home and perch are in the parent world's local coordinates. */
  constructor(parent: THREE.Object3D, private home: THREE.Vector3, private stencilLayer: number, private perch?: THREE.Vector3) {
    this.group.add(this.body);
    // Stands on the ground of World Two, not at the tear's height.
    this.group.position.copy(home).add(new THREE.Vector3(2.2, 0, -4.5)).setY(0);
    parent.add(this.group);

    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x1d2a12, transparent: true, opacity: 0.45, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.group.add(this.shadow);
    applyStencilLayer(this.shadow, stencilLayer);

    this.pickWanderTarget();
    this.load();
  }

  private load() {
    new GLTFLoader().load(
      MODEL,
      (gltf) => {
        const root = gltf.scene;
        // Big enough to read as a character from across the clearing.
        fitProp(root, 0.95); // measured, not assumed: kits disagree about units
        standOnOrigin(root); // feet on the ground, not half-buried
        // A little light of its own, so it reads against undergrowth or a dim
        // room instead of disappearing into the background.
        //
        // The model's colour lives in its texture (material.color is white), so
        // the glow must come from the texture too — copying material.color into
        // emissive is what washed it out to white.
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
          // Deep golden-orange: saturated enough to never read as white, and
          // the complementary colour to the green forest it lives in.
          mat.color.multiply(new THREE.Color(0xffa040));
          if (mat.map) {
            mat.emissiveMap = mat.map;
            mat.emissive.set(0xff9a3c);
            mat.emissiveIntensity = 0.1;
          } else {
            mat.emissive.copy(mat.color).multiplyScalar(0.12);
          }
          mat.roughness = 0.55;
          mesh.material = mat;
        });
        this.body.add(root);
        const halo = new THREE.PointLight(0xffd08a, 0.7, 2.4, 2);
        halo.position.y = 0.45;
        this.body.add(halo);
        applyStencilLayer(this.group, this.stencilLayer);
        if (gltf.animations.length) {
          this.mixer = new THREE.AnimationMixer(root);
          for (const [name, [from, to]] of Object.entries(CLIPS)) {
            // This pack already exports separate idle/attack/dead clips. Only
            // slice frame ranges for older files containing one long master.
            let clip = gltf.animations.find(candidate => candidate.name.toLowerCase() === name);
            const master = gltf.animations[0];
            if (!clip && master.duration >= (to + 1) / FPS) {
              clip = THREE.AnimationUtils.subclip(master, name, from, to + 1, FPS);
            }
            if (clip?.tracks.length && clip.duration > 0) this.actions[name] = this.mixer.clipAction(clip);
          }
          this.actions.idle?.play();
        }
        this.ready = true;
        this.onLoaded?.();
      },
      undefined,
      (err) => {
        // A missing model must not break the experience.
        console.warn('Creature model failed to load; world two continues without it', err);
      }
    );
  }

  attachVoice(engine: AudioEngine) {
    if (this.cry || engine.state !== 'running') return;
    this.cryBuffers = [cryBuffer(engine.ctx, 1), cryBuffer(engine.ctx, 2), cryBuffer(engine.ctx, 3)];
    this.cry = new THREE.PositionalAudio(engine.listener);
    this.cry.setRefDistance(1.2);
    this.cry.setVolume(0.9);
    this.group.add(this.cry);
  }

  private speak(index: number, time: number, rate = 1) {
    if (!this.cry || !this.cryBuffers.length || time - this.lastCry < 1.2) return;
    this.lastCry = time;
    if (this.cry.isPlaying) this.cry.stop();
    this.cry.setBuffer(this.cryBuffers[index % this.cryBuffers.length]);
    this.cry.setPlaybackRate(rate * (0.92 + this.rng() * 0.16));
    this.cry.play();
  }

  private setState(next: CreatureState, time: number) {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
    if (next === 'notice') this.speak(0, time, 1.1);
    if (next === 'sniff') {
      this.speak(1, time, 1.0);
      this.playOnce('attack');
    }
    if (next === 'greet') this.speak(1, time, 1.25);
    if (next === 'guide') this.speak(0, time, 1.15);
    if (next === 'startle') this.speak(2, time, 1.35);
  }

  private playOnce(name: string) {
    const action = this.actions[name];
    if (!action) return;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.fadeIn(0.15).play();
    setTimeout(() => action.fadeOut(0.4), 900);
  }

  private pickWanderTarget() {
    const a = this.rng() * Math.PI * 2;
    const r = 2.5 + this.rng() * 5;
    this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z - 2 - Math.abs(Math.sin(a)) * r);
  }

  /**
   * @param tearPos world position of the tear
   * @param tearForward tear normal pointing toward the user, so the creature
   *        can stand square in the opening rather than off to one side
   */
  update(
    dt: number,
    time: number,
    tearPos: THREE.Vector3,
    tearForward: THREE.Vector3,
    openness: number,
    energy: number,
    playerInWorld = false,
    playerPos?: THREE.Vector3
  ) {
    // App supplies XR/camera/tear coordinates in world space. Behavior and
    // terrain queries operate in the forest root's local frame, which can move
    // when a new portal is composed at the participant's actual position.
    const parent = this.group.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      this.parentInverse.copy(parent.matrixWorld).invert();
      tearPos = this.localTear.copy(tearPos).applyMatrix4(this.parentInverse);
      tearForward = this.localForward.copy(tearForward).transformDirection(this.parentInverse);
      if (playerPos) playerPos = this.localPlayer.copy(playerPos).applyMatrix4(this.parentInverse);
    }
    this.stateTime += dt;
    this.mixer?.update(dt);

    // Where it stops: the mossy rock facing the opening, if there is one,
    // otherwise a spot squarely behind the tear.
    if (this.perch) this.station.copy(this.perch).setY(0);
    else this.station.copy(tearPos).addScaledVector(tearForward, -1.9).setY(0);
    const toTear = this.tmp.copy(tearPos).setY(0).sub(this.tmp.clone().copy(this.group.position).setY(0));
    const distToTear = toTear.length();
    // Horizontal distances: the creature's height follows the hills, targets don't.
    const flat = (v: THREE.Vector3) => Math.hypot(this.group.position.x - v.x, this.group.position.z - v.z);
    const distToStation = flat(this.station);

    switch (this.state) {
      case 'wander':
        if (flat(this.target) < 0.5) {
          if (this.stateTime > 1.5) this.pickWanderTarget();
        }
        this.speed = damp(this.speed, 0.55, 3, dt);
        if (openness > 0.15) this.setState('notice', time);
        break;
      case 'notice':
        this.speed = damp(this.speed, 0, 6, dt);
        this.target.copy(tearPos).setY(0);
        if (this.stateTime > 1.6) this.setState('approach', time);
        if (openness < 0.05) this.setState('wander', time);
        break;
      case 'approach': {
        this.target.copy(this.station);
        this.speed = damp(this.speed, 0.9, 2.5, dt);
        // Either it arrives, or it has clearly stopped making progress.
        if (distToStation < 0.45 || (this.stateTime > 6 && distToStation < 1)) this.setState('sniff', time);
        if (openness < 0.05) this.setState('retreat', time);
        break;
      }
      case 'sniff':
        this.speed = damp(this.speed, 0, 8, dt);
        this.target.copy(this.station);
        if (this.stateTime > 1.2) this.setState('greet', time);
        if (openness < 0.05) this.setState('retreat', time);
        if (energy > 0.75) this.setState('startle', time);
        break;
      case 'greet':
        // Waves hello: a rocking tilt with a bounce, then settles.
        this.speed = damp(this.speed, 0, 10, dt);
        this.target.copy(this.station);
        this.wave = Math.max(0, 1 - this.stateTime / 2.6);
        if (this.stateTime > 2.6) {
          this.setState(playerInWorld ? 'guide' : 'sniff', time);
        }
        if (openness < 0.05 && !playerInWorld) this.setState('retreat', time);
        if (energy > 0.85) this.setState('startle', time);
        break;
      case 'guide': {
        // You are standing in its world now: it hops to the new seam and looks
        // at it, so the next tear is never something you have to hunt for.
        const post = this.tmp.copy(tearPos).setY(0).addScaledVector(tearForward, 0.9);
        this.target.copy(post).setY(0);
        this.speed = damp(this.speed, 1.1, 3, dt);
        if (playerPos && this.stateTime > 2 && this.rng() < dt * 0.25) this.speak(0, time, 1.2);
        if (!playerInWorld) this.setState('wander', time);
        if (energy > 0.9) this.setState('startle', time);
        break;
      }
      case 'startle':
        this.speed = damp(this.speed, 2.2, 14, dt);
        this.target.copy(this.group.position).addScaledVector(toTear.normalize(), -3.5).setY(0);
        if (this.stateTime > 1.1) this.setState(openness > 0.1 ? 'notice' : 'wander', time);
        break;
      case 'retreat':
        this.speed = damp(this.speed, 1.0, 4, dt);
        if (this.stateTime > 2.5) this.setState('wander', time);
        break;
    }

    // Hop toward the target.
    const flatTarget = this.tmp.copy(this.target).setY(0);
    const toTarget = flatTarget.sub(this.tmp.clone().copy(this.group.position).setY(0));
    const dist = toTarget.length();
    const moving = this.speed > 0.05 && dist > 0.15;
    if (moving) {
      toTarget.normalize();
      this.group.position.addScaledVector(toTarget, Math.min(this.speed * dt, dist));
      const yaw = Math.atan2(toTarget.x, toTarget.z);
      this.group.rotation.y = dampAngle(this.group.rotation.y, yaw, 8, dt);
    } else if (this.state === 'notice' || this.state === 'sniff' || this.state === 'greet' || this.state === 'guide') {
      // Look at whoever it is talking to: the person if they are here, the tear otherwise.
      const lookAt = (this.state === 'greet' || this.state === 'guide') && playerPos ? playerPos : tearPos;
      const yaw = Math.atan2(lookAt.x - this.group.position.x, lookAt.z - this.group.position.z);
      this.group.rotation.y = dampAngle(this.group.rotation.y, yaw, 5, dt);
    }

    // The wave itself: a rocking tilt with a little hop under it.
    this.wave = Math.max(0, this.wave - (this.state === 'greet' ? 0 : dt * 2));
    this.body.rotation.z = Math.sin(time * 9) * 0.38 * this.wave;
    this.body.rotation.x = Math.sin(time * 4.5) * 0.08 * this.wave;

    // Climbs onto the rock once it settles at the opening, drops off when it leaves.
    const onPerch = this.state === 'sniff' || this.state === 'greet';
    // Stand on the terrain under it (the forest floor is hilly), or on the rock.
    const floor = this.groundAt ? this.groundAt(this.group.position.x, this.group.position.z) : 0;
    const wantY = onPerch && this.perch ? this.perch.y : floor;
    // Climbing the rock is slow and deliberate; following the ground is instant.
    this.group.position.y = damp(this.group.position.y, wantY, onPerch ? 4 : 20, dt);

    this.hopPhase += dt * (moving ? 4.5 + this.speed * 1.8 : this.wave > 0 ? 6.5 : 1.6);
    const hop = Math.abs(Math.sin(this.hopPhase));
    const height = moving ? hop * (0.12 + this.speed * 0.07) : hop * (0.015 + this.wave * 0.07);
    this.body.position.y = height;
    const squash = 1 - clamp(height, 0, 0.3) * 0.35 + (1 - hop) * 0.06;
    this.body.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);

    this.shadow.scale.setScalar(1 - clamp(height * 1.4, 0, 0.5));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - clamp(height, 0, 0.4));
    if (playerInWorld) {
      // You are standing in its forest: it is simply there, full size.
      this.shadow.visible = true;
      this.body.visible = this.ready;
    } else {
      // Seen through the tear, its shadow arrives before it does: the shadow is
      // visible from far away, the creature once it emerges from the haze.
      this.shadow.visible = distToTear < 12;
      this.body.visible = this.ready && distToTear < 6;
      const fadeIn = smoothstep(6, 4.4, distToTear);
      this.body.scale.multiplyScalar(0.35 + 0.65 * fadeIn);
    }
  }
}

function dampAngle(current: number, target: number, rate: number, dt: number) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return damp(current, current + diff, rate, dt);
}
