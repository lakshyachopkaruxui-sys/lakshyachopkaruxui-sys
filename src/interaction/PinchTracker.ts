import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { OneEuroVector3 } from '../utils/OneEuroFilter';
import type { RawHandSample } from './types';

const P = CONFIG.pinch;

/**
 * Turns noisy raw hand samples into a stable pinch signal:
 * One-Euro smoothing, hysteresis on pinch distance, jump rejection,
 * and a grace period so brief tracking loss doesn't drop a grip.
 */
export class PinchTracker {
  tracked = false;
  pinching = false;
  pinchStarted = false;
  pinchEnded = false;
  pinchDistance = 1;
  lostFor = Infinity;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly acceleration = new THREE.Vector3();
  speed = 0;

  private filter = new OneEuroVector3(P.filterMinCutoff, P.filterBeta);
  private rawMid = new THREE.Vector3();
  private lastAcceptedRaw = new THREE.Vector3();
  private hasRaw = false;
  private glitchFrames = 0;
  private prevPos = new THREE.Vector3();
  private instVel = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  private instAcc = new THREE.Vector3();

  update(sample: RawHandSample, dt: number) {
    this.pinchStarted = false;
    this.pinchEnded = false;
    const wasPinching = this.pinching;

    let accepted = false;
    if (sample.tracked) {
      this.rawMid.copy(sample.thumbTip).add(sample.indexTip).multiplyScalar(0.5);
      const jump = this.hasRaw ? this.rawMid.distanceTo(this.lastAcceptedRaw) : 0;
      if (jump > P.maxJumpPerFrame && this.glitchFrames < 3 && this.lostFor < P.lostGraceSeconds) {
        this.glitchFrames++;
      } else {
        if (jump > P.maxJumpPerFrame || !this.hasRaw || this.lostFor >= P.lostGraceSeconds) {
          // Re-acquired somewhere new: restart the filter instead of sweeping across.
          this.filter.reset();
          this.velocity.set(0, 0, 0);
          this.acceleration.set(0, 0, 0);
          this.filter.filter(this.rawMid, dt, this.prevPos);
        }
        this.glitchFrames = 0;
        this.hasRaw = true;
        this.lastAcceptedRaw.copy(this.rawMid);
        accepted = true;
      }
    }

    if (accepted) {
      this.lostFor = 0;
      this.tracked = true;
      this.filter.filter(this.rawMid, dt, this.position);

      const k = 1 - Math.exp(-P.velocitySmoothing * dt);
      this.instVel.subVectors(this.position, this.prevPos).divideScalar(Math.max(dt, 1e-4));
      this.velocity.lerp(this.instVel, k);
      this.instAcc.subVectors(this.velocity, this.prevVel).divideScalar(Math.max(dt, 1e-4));
      this.acceleration.lerp(this.instAcc, k);
      this.prevVel.copy(this.velocity);
      this.prevPos.copy(this.position);

      this.pinchDistance = sample.thumbTip.distanceTo(sample.indexTip);
      if (!this.pinching && this.pinchDistance < P.engageDistance) this.pinching = true;
      else if (this.pinching && this.pinchDistance > P.releaseDistance) this.pinching = false;
    } else {
      this.lostFor += dt;
      this.velocity.multiplyScalar(Math.exp(-6 * dt));
      this.acceleration.set(0, 0, 0);
      if (this.lostFor >= P.lostGraceSeconds) {
        this.tracked = false;
        this.pinching = false;
      }
    }

    this.speed = this.velocity.length();
    if (this.pinching && !wasPinching) this.pinchStarted = true;
    if (!this.pinching && wasPinching) this.pinchEnded = true;
  }
}
