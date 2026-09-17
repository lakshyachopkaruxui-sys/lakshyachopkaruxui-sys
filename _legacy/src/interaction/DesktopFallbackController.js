import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import { KeyState } from '../utils/KeyState.js';
import { dampVec3, clamp } from '../utils/math.js';

// Desktop mouse+keyboard simulation of two-handed pinching, exposing the
// SAME getHands() shape as HandTrackingSystem so TwoHandTearController
// never needs to know which input source is live. This is explicitly a
// fallback for reviewers without a headset — not a redesign of the
// interaction (brief: "controls are only a fallback").
//
// Scheme (mouse is claimed by the right hand, so look-around and walking
// move to arrow keys instead of the usual mouse-look/WASD-walk combo):
//   Right hand -> mouse position (projected to a plane in front of the
//                 camera) + mouse wheel for depth. Hold LMB to pinch.
//   Left hand  -> WASD moves it in the camera-local plane, Q/E for depth.
//                 Hold Space to pinch.
//   Look       -> Left/Right arrows yaw the view (no pitch — kept level,
//                 a deliberate simplification for the fallback).
//   Walk       -> Up/Down arrows move the player rig forward/back, so a
//                 desktop reviewer can approach the seam the same way a
//                 real VR user just walks up to it in their room — no
//                 artificial VR locomotion is used anywhere in XR mode.
export class DesktopFallbackController {
  constructor(domElement, camera, playerRig) {
    this.domElement = domElement;
    this.camera = camera;
    this.playerRig = playerRig;
    this.keys = new KeyState();

    this.hands = {
      left: this._makeHandState(),
      right: this._makeHandState()
    };
    this.handAvailable = { left: true, right: true };

    this._ndc = new THREE.Vector2(0, 0);
    this._rightDepth = 0.6;
    this._leftOffset = new THREE.Vector2(-0.18, -0.05);
    this._leftDepth = 0.6;

    this._yaw = 0;
    this._camWorldPos = new THREE.Vector3();

    this._onMouseMove = (e) => {
      const rect = domElement.getBoundingClientRect();
      this._ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._ndc.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) this.hands.right._pinchHeld = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.hands.right._pinchHeld = false;
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this._rightDepth = clamp(this._rightDepth + e.deltaY * 0.0012, 0.2, 1.6);
    };

    domElement.addEventListener('mousemove', this._onMouseMove);
    domElement.addEventListener('mousedown', this._onMouseDown);
    domElement.addEventListener('mouseup', this._onMouseUp);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _makeHandState() {
    return {
      valid: true,
      everValid: true,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      pinching: false,
      _pinchHeld: false,
      _prevPosition: new THREE.Vector3(),
      _smoothedVelocity: new THREE.Vector3()
    };
  }

  _cameraBasis() {
    const e = this.camera.matrixWorld.elements;
    return {
      right: new THREE.Vector3(e[0], e[1], e[2]),
      up: new THREE.Vector3(e[4], e[5], e[6]),
      forward: new THREE.Vector3(-e[8], -e[9], -e[10])
    };
  }

  update(dt) {
    const { keys } = this;

    if (keys.isDown('ArrowLeft')) this._yaw += 1.4 * dt;
    if (keys.isDown('ArrowRight')) this._yaw -= 1.4 * dt;
    this.camera.quaternion.setFromEuler(new THREE.Euler(0, this._yaw, 0, 'YXZ'));

    const { right: rAxis, up: uAxis, forward: fAxis } = this._cameraBasis();

    const walkSpeed = 1.6; // m/s
    if (this.playerRig) {
      if (keys.isDown('ArrowUp')) this.playerRig.position.addScaledVector(fAxis, walkSpeed * dt);
      if (keys.isDown('ArrowDown')) this.playerRig.position.addScaledVector(fAxis, -walkSpeed * dt);
    }

    this.camera.getWorldPosition(this._camWorldPos);

    // --- Right hand: mouse-driven ---
    const tanHalfFovY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanHalfFovX = tanHalfFovY * this.camera.aspect;
    const rx = this._ndc.x * this._rightDepth * tanHalfFovX * 0.5;
    const ry = this._ndc.y * this._rightDepth * tanHalfFovY * 0.5;
    const rightTarget = this._camWorldPos.clone()
      .addScaledVector(fAxis, this._rightDepth)
      .addScaledVector(rAxis, rx)
      .addScaledVector(uAxis, ry);
    this._advanceHand(this.hands.right, rightTarget, dt, this.hands.right._pinchHeld);

    // --- Left hand: keyboard-driven ---
    const speed = CONFIG.desktopFallback.keyboardMoveSpeed;
    if (keys.isDown('KeyA')) this._leftOffset.x -= speed * dt;
    if (keys.isDown('KeyD')) this._leftOffset.x += speed * dt;
    if (keys.isDown('KeyW')) this._leftOffset.y += speed * dt;
    if (keys.isDown('KeyS')) this._leftOffset.y -= speed * dt;
    if (keys.isDown('KeyQ')) this._leftDepth = clamp(this._leftDepth - speed * dt, 0.2, 1.6);
    if (keys.isDown('KeyE')) this._leftDepth = clamp(this._leftDepth + speed * dt, 0.2, 1.6);
    this._leftOffset.x = clamp(this._leftOffset.x, -0.55, 0.55);
    this._leftOffset.y = clamp(this._leftOffset.y, -0.4, 0.4);

    const leftTarget = this._camWorldPos.clone()
      .addScaledVector(fAxis, this._leftDepth)
      .addScaledVector(rAxis, this._leftOffset.x)
      .addScaledVector(uAxis, this._leftOffset.y);
    this._advanceHand(this.hands.left, leftTarget, dt, keys.isDown('Space'));
  }

  _advanceHand(hand, targetPos, dt, pinchHeld) {
    hand._prevPosition.copy(hand.position);
    dampVec3(hand.position, targetPos, CONFIG.smoothing.handPositionDamping, dt);
    const instVelocity = hand.position.clone().sub(hand._prevPosition).divideScalar(Math.max(dt, 1e-4));
    dampVec3(hand._smoothedVelocity, instVelocity, CONFIG.smoothing.velocityDamping, dt);
    hand.velocity.copy(hand._smoothedVelocity);
    hand.pinching = !!pinchHeld;
    hand.valid = true;
  }

  getHands() {
    return this.hands;
  }

  dispose() {
    this.keys.dispose();
    this.domElement.removeEventListener('mousemove', this._onMouseMove);
    this.domElement.removeEventListener('mousedown', this._onMouseDown);
    this.domElement.removeEventListener('mouseup', this._onMouseUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
  }
}
