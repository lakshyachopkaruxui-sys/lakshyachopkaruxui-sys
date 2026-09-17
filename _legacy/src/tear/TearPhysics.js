import { CONFIG } from '../config/config.js';
import { clamp, damp, lerp } from '../utils/math.js';

// Owns the tear's scalar "physics": how open it is, how much energy/violence
// is behind the current motion, and the healing behavior on release.
//
// Design (documented per brief's request to explain interaction math):
// - `openAmount` is a RATCHET while both hands actively pinch-hold the
//   veil: it only grows toward the hand-gap-derived target, it never
//   shrinks just because the hands moved closer together. Physically, wet
//   paper that has torn doesn't un-tear when you relax your pull — the
//   flap stays open until it heals. This is what creates "effort" — the
//   only way to reduce openAmount is to genuinely release (let go of the
//   pinch, or move the hands out of engagement range), which starts
//   healing.
// - Resistance is expressed as a SLOWING of the approach rate as
//   openAmount grows (`resistanceCurve`), not a hard cap — larger
//   openings visibly take more sustained pulling to reach.
export class TearPhysics {
  constructor() {
    this.openAmount = 0;         // 0..1
    this.energy = 0;             // 0..1+ (short-lived "violence" of the current motion)
    this.stress = 0;             // 0..1, derived — drives material/audio intensity
    this._ratchetTarget = 0;
    this._releasedFor = null;    // seconds of simulated time since activePull last went false
  }

  get stage() {
    const s = CONFIG.tear.stages;
    for (let i = 0; i < s.length; i++) {
      if (this.openAmount < s[i]) return i; // 0..s.length
    }
    return s.length;
  }

  get isFullyHealed() {
    return this.openAmount <= 0.0005;
  }

  /**
   * @param {boolean} activePull - both hands validly pinching AND within engage proximity
   * @param {number} gapTargetNormalized - 0..1, current hand-gap mapped to [minGap,maxGap]
   * @param {number} handSpeedEnergy - 0..1+ instantaneous pull energy from hand velocity
   * @param {number} dt
   */
  update(activePull, gapTargetNormalized, handSpeedEnergy, dt) {
    if (activePull) {
      this._releasedFor = null;
      this._ratchetTarget = Math.max(this._ratchetTarget, clamp(gapTargetNormalized, 0, 1));

      const resistance = Math.pow(clamp(this.openAmount, 0, 1), CONFIG.tear.resistanceCurve);
      const approachRate = lerp(20, 3.5, resistance); // lambda: fast when small, resisted near full
      this.openAmount = damp(this.openAmount, this._ratchetTarget, approachRate, dt);

      this.energy = damp(this.energy, handSpeedEnergy, 6, dt);
    } else {
      if (this._releasedFor == null) this._releasedFor = 0;
      else this._releasedFor += dt;
      const sinceReleaseMs = this._releasedFor * 1000;

      this.energy = damp(this.energy, 0, 3, dt);

      if (sinceReleaseMs >= CONFIG.healing.startDelayMs) {
        const rampSeconds = (sinceReleaseMs - CONFIG.healing.startDelayMs) / 1000;
        const rate = CONFIG.healing.baseRate * (1 + CONFIG.healing.accelerate * rampSeconds);
        this.openAmount = Math.max(0, this.openAmount - rate * dt);
        this._ratchetTarget = Math.min(this._ratchetTarget, this.openAmount);
      }
      // else: within the suspended grace window — openAmount holds still.
    }

    this.openAmount = clamp(this.openAmount, 0, 1);
    const resistanceNow = Math.pow(this.openAmount, CONFIG.tear.resistanceCurve);
    this.stress = clamp(resistanceNow * 0.6 + this.energy * 0.4, 0, 1);
  }
}
