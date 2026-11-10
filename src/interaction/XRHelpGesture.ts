import type * as THREE from 'three';
import type { RawHandSample } from './types';

/** Product tuning values, not headset accuracy or usability measurements. */
export const XR_HELP_TARGET = Object.freeze({
  radius: 0.045,
  releaseRadius: 0.075,
  dwellSeconds: 0.65,
  releaseSeconds: 0.2,
  maxFrameSeconds: 0.15
});

/**
 * Either live index fingertip can hold the visible, world-space notes target.
 * No two-hand pose, palm orientation or system-menu gesture is required.
 * The host owns placement, visibility and the interaction/focus gate.
 *
 * Only current named joint data may activate. Occlusion/focus loss cancels a
 * partial hold, and never counts as a release after an activation.
 */
export class XRHelpGesture {
  private dwell = 0;
  private releaseTime = 0;
  private activeHand: number | null = null;
  private latchedHand: number | null = null;
  private hover: number | null = null;

  /** A visible progress indicator should use this value, in [0, 1]. */
  get progress(): number { return this.dwell / XR_HELP_TARGET.dwellSeconds; }
  get hoveredHand(): number | null { return this.hover; }
  get latched(): boolean { return this.latchedHand !== null; }

  reset() {
    this.cancelHold();
    this.latchedHand = null;
  }

  /** Also call on visibility/focus events that may arrive between XR frames. */
  cancelHold() {
    this.dwell = 0;
    this.releaseTime = 0;
    this.activeHand = null;
    this.hover = null;
  }

  /**
   * samples are left then right. A null target is hidden/unavailable. Keep its
   * world position stable while pointing; do not move the button under a finger.
   */
  updateTarget(samples: readonly RawHandSample[], target: THREE.Vector3 | null,
    dt: number, enabled: boolean): boolean {
    if (!enabled || !finite(target) || !Number.isFinite(dt) || dt < 0 ||
      dt > XR_HELP_TARGET.maxFrameSeconds || samples.length !== 2) {
      this.cancelHold();
      return false;
    }

    const left = liveIndex(samples[0]);
    const right = liveIndex(samples[1]);
    const leftDistance = left ? left.distanceTo(target) : Infinity;
    const rightDistance = right ? right.distanceTo(target) : Infinity;
    this.hover = leftDistance <= XR_HELP_TARGET.radius ? 0
      : rightDistance <= XR_HELP_TARGET.radius ? 1 : null;

    if (this.latchedHand !== null) {
      // The activating hand must be visibly away; losing it or swapping to the
      // other hand cannot close the notes that were just opened. A wider exit
      // radius and continuous release interval prevent boundary jitter toggles.
      const original = this.latchedHand === 0 ? left : right;
      if (original && original.distanceTo(target) > XR_HELP_TARGET.releaseRadius &&
        leftDistance > XR_HELP_TARGET.releaseRadius && rightDistance > XR_HELP_TARGET.releaseRadius) {
        this.releaseTime += dt;
        if (this.releaseTime >= XR_HELP_TARGET.releaseSeconds - 1e-9) {
          this.latchedHand = null;
          this.releaseTime = 0;
        }
      } else this.releaseTime = 0;
      return false;
    }

    // Keep the original candidate while it is within the target, even if the
    // other fingertip arrives. Otherwise switching hands restarts the dwell.
    const activeDistance = this.activeHand === 0 ? leftDistance : rightDistance;
    const candidate = this.activeHand !== null && activeDistance <= XR_HELP_TARGET.radius
      ? this.activeHand : this.hover;
    if (candidate !== this.activeHand) this.dwell = 0;
    this.activeHand = candidate;
    this.hover = candidate;
    if (candidate === null) {
      this.dwell = 0;
      return false;
    }
    this.dwell = Math.min(XR_HELP_TARGET.dwellSeconds, this.dwell + dt);
    if (this.dwell < XR_HELP_TARGET.dwellSeconds - 1e-9) return false;
    this.latchedHand = candidate;
    this.dwell = 0;
    this.activeHand = null;
    return true;
  }
}

function liveIndex(sample: RawHandSample | undefined): THREE.Vector3 | null {
  const index = sample?.jointPositions?.['index-finger-tip'];
  return sample?.tracked && finite(index) ? index : null;
}

const finite = (v: THREE.Vector3 | null | undefined): v is THREE.Vector3 =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
