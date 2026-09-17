import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import { TearPhysics } from '../tear/TearPhysics.js';
import { States } from '../state/InteractionState.js';
import { clamp, lerp, remap } from '../utils/math.js';

function shortestAngleLerp(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// The central orchestrator described in the brief's "Two-Hand Tear
// Mathematics" section. Consumes whichever hand source is active
// (HandTrackingSystem in XR, DesktopFallbackController on desktop — both
// expose the identical getHands() shape), projects hand positions into the
// veil's local plane space, and turns hand-gap / velocity / direction into
// the tear's physical state.
//
// Documented design decision: initial engagement is captured within a
// radius around the seam/current-opening center (not "anywhere pinching
// near the wall counts"), so the player must actually find and pinch the
// seam rather than tear open reality by pinching empty wall space. The
// capture radius grows with the opening so hands can reposition once it's
// open. This isn't spelled out explicitly in the brief; documenting it here
// as the concrete interpretation chosen.
export class TwoHandTearController {
  constructor(veilAnchor) {
    this.veilAnchor = veilAnchor;       // THREE.Object3D — local XY is the tear plane, +Z is normal
    this.physics = new TearPhysics();
    // This controller's own read of what interaction state IT would be in,
    // computed every frame but NOT written to the shared InteractionState
    // directly — see WorldManager, which is the only thing that knows
    // which loaded world's controller is actually the one the player can
    // reach right now, and syncs only that one into the shared state.
    // (Every loaded world ticks its controller every frame — see
    // WorldManager's class comment — so hand validity/pinching alone,
    // which are global, must not let a non-current world overwrite state.)
    this.localState = States.IDLE;

    this._localLeft = new THREE.Vector3();
    this._localRight = new THREE.Vector3();
    this._directionAngle = 0;
    this._captureRadius = 0.55;

    this.signal = {
      engaged: false,
      openAmount: 0,
      stage: 0,
      energy: 0,
      stress: 0,
      centerLocal: new THREE.Vector2(),
      directionAngle: 0,
      gapLocal: 0,
      leftLocal: new THREE.Vector2(),
      rightLocal: new THREE.Vector2()
    };
  }

  /** @param {{left: object, right: object}} handSource result of getHands() */
  update(handSource, handAvailable, dt) {
    const left = handSource.left;
    const right = handSource.right;

    const leftValid = !!left.valid;
    const rightValid = !!right.valid;

    let activePull = false;

    if (leftValid && rightValid) {
      this.veilAnchor.worldToLocal(this._localLeft.copy(left.position));
      this.veilAnchor.worldToLocal(this._localRight.copy(right.position));

      const leftNearPlane = Math.abs(this._localLeft.z) < CONFIG.tear.engageProximity;
      const rightNearPlane = Math.abs(this._localRight.z) < CONFIG.tear.engageProximity;

      const midX = (this._localLeft.x + this._localRight.x) * 0.5;
      const midY = (this._localLeft.y + this._localRight.y) * 0.5;
      const distFromCenter = Math.hypot(midX - this.signal.centerLocal.x, midY - this.signal.centerLocal.y);
      const withinCapture = distFromCenter < this._captureRadius || this.physics.openAmount < 0.001;

      const bothPinching = left.pinching && right.pinching;

      activePull = leftNearPlane && rightNearPlane && withinCapture && bothPinching;

      if (activePull) {
        this.signal.centerLocal.set(midX, midY);
        this.signal.leftLocal.set(this._localLeft.x, this._localLeft.y);
        this.signal.rightLocal.set(this._localRight.x, this._localRight.y);

        const gapLocal = Math.hypot(
          this._localRight.x - this._localLeft.x,
          this._localRight.y - this._localLeft.y
        );
        this.signal.gapLocal = gapLocal;

        if (gapLocal > 0.02) {
          const targetAngle = Math.atan2(
            this._localRight.y - this._localLeft.y,
            this._localRight.x - this._localLeft.x
          );
          this._directionAngle = shortestAngleLerp(this._directionAngle, targetAngle, CONFIG.tear.directionBlend);
        }

        const speedEnergy =
          (left.velocity.length() + right.velocity.length()) * 0.5 * CONFIG.tear.velocityEnergyScale;
        const gapTargetNormalized = remap(gapLocal, CONFIG.tear.minGap, CONFIG.tear.maxGap, 0, 1);
        this.physics.update(true, gapTargetNormalized, speedEnergy, dt);
      }
    }

    if (!activePull) {
      this.physics.update(false, 0, 0, dt);
    }

    this._captureRadius = lerp(0.55, CONFIG.tear.maxGap * 1.3, this.physics.openAmount);

    this.signal.engaged = activePull;
    this.signal.openAmount = this.physics.openAmount;
    this.signal.stage = this.physics.stage;
    this.signal.energy = this.physics.energy;
    this.signal.stress = this.physics.stress;
    this.signal.directionAngle = this._directionAngle;

    this.localState = this._resolveLocalState({ leftValid, rightValid, activePull, left, right });

    return this.signal;
  }

  _resolveLocalState({ leftValid, rightValid, activePull, left, right }) {
    if (this.physics.openAmount >= 0.999) return States.FULLY_OPEN;
    if (activePull) return this.physics.energy > 0.15 ? States.PULLING : States.HOLDING;
    if (this.physics.openAmount > 0.001) return States.HEALING;
    if (leftValid && rightValid) return left.pinching || right.pinching ? States.PINCHING : States.BOTH_HANDS;
    if (leftValid || rightValid) return States.ONE_HAND;
    return States.IDLE;
  }
}
