import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import { PinchDetector } from './PinchDetector.js';
import { damp, dampVec3 } from '../utils/math.js';

const THUMB_TIP = 'thumb-tip';
const INDEX_TIP = 'index-finger-tip';

// Per-hand tracked state. Position values are world-space.
class HandState {
  constructor() {
    this.valid = false;              // do we have usable joint data THIS frame
    this.everValid = false;
    this.lastValidTime = -Infinity;
    this.position = new THREE.Vector3();       // smoothed midpoint of thumb/index tips
    this._rawPosition = new THREE.Vector3();
    this._prevPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this._smoothedVelocity = new THREE.Vector3();
    this.pinchDetector = new PinchDetector();
    this.pinching = false;
    this._thumbWorld = new THREE.Vector3();
    this._indexWorld = new THREE.Vector3();
  }
}

// Reads real WebXR hand-tracking joint data via three.js's WebXRManager
// (renderer.xr.getHand(index)). Three.js populates hand.joints[jointName]
// as an Object3D each XR frame before the user's animation callback runs,
// so this system only needs to read positions — it does not call
// XRFrame.getJointPose() itself.
//
// IMPORTANT (spec-verified): the WebXR "index" passed to getHand() is a
// controller *slot*, not a guarantee of left/right handedness. Handedness
// must be read from the 'connected' event's XRInputSource, and can differ
// in order between devices/sessions, so we map slot->handedness dynamically
// rather than assuming getHand(0) === left.
export class HandTrackingSystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.hands = { left: new HandState(), right: new HandState() };
    this.handAvailable = { left: false, right: false }; // has a hand-tracking input source ever connected

    this._slotHandedness = [null, null];
    this._xrHands = [renderer.xr.getHand(0), renderer.xr.getHand(1)];

    this._xrHands.forEach((handGroup, slot) => {
      handGroup.addEventListener('connected', (event) => {
        const inputSource = event.data;
        if (!inputSource || !inputSource.hand) {
          // Connected input has no hand joints (e.g. a physical controller) — ignore for tearing.
          this._slotHandedness[slot] = null;
          return;
        }
        this._slotHandedness[slot] = inputSource.handedness; // 'left' | 'right'
        this.handAvailable[inputSource.handedness] = true;
      });
      handGroup.addEventListener('disconnected', () => {
        const handedness = this._slotHandedness[slot];
        this._slotHandedness[slot] = null;
        if (handedness) this.handAvailable[handedness] = false;
      });
      scene.add(handGroup);
    });
  }

  /** Call once per XR frame, after the renderer has updated hand joints. */
  update(dt) {
    const now = performance.now();

    for (let slot = 0; slot < 2; slot++) {
      const handedness = this._slotHandedness[slot];
      if (!handedness) continue;
      const state = this.hands[handedness];
      const xrHand = this._xrHands[slot];
      const joints = xrHand.joints;

      const thumb = joints && joints[THUMB_TIP];
      const index = joints && joints[INDEX_TIP];

      if (thumb && index && thumb.visible !== false && index.visible !== false) {
        thumb.getWorldPosition(state._thumbWorld);
        index.getWorldPosition(state._indexWorld);

        const jump = state.everValid
          ? state._rawPosition.distanceTo(
              state._thumbWorld.clone().add(state._indexWorld).multiplyScalar(0.5)
            )
          : 0;

        state._rawPosition.copy(state._thumbWorld).add(state._indexWorld).multiplyScalar(0.5);

        if (jump > CONFIG.pinch.maxValidJointJump) {
          // Implausible frame-to-frame jump (tracking glitch) — skip this
          // sample rather than snapping the tear open/shut.
          continue;
        }

        const rawDistance = state._thumbWorld.distanceTo(state._indexWorld);
        state.pinching = state.pinchDetector.update(rawDistance, dt);

        state._prevPosition.copy(state.position);
        dampVec3(state.position, state._rawPosition, CONFIG.smoothing.handPositionDamping, dt);

        const instVelocity = state.position.clone().sub(state._prevPosition).divideScalar(Math.max(dt, 1e-4));
        dampVec3(state._smoothedVelocity, instVelocity, CONFIG.smoothing.velocityDamping, dt);
        state.velocity.copy(state._smoothedVelocity);

        state.valid = true;
        state.everValid = true;
        state.lastValidTime = now;
      } else {
        state.valid = (now - state.lastValidTime) < CONFIG.pinch.missingHandGraceMs;
        if (!state.valid) state.pinching = false;
      }
    }
  }

  /** Unified read-only snapshot consumed by TwoHandTearController. */
  getHands() {
    return this.hands;
  }
}
