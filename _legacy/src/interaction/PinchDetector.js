import { CONFIG } from '../config/config.js';
import { damp } from '../utils/math.js';

// Per-hand pinch detection with hysteresis, so the pinch boolean doesn't
// flicker when thumb-to-index distance sits near a single threshold.
// engageThreshold < releaseThreshold: must pinch tighter to engage than
// to release.
export class PinchDetector {
  constructor() {
    this.pinching = false;
    this.smoothedDistance = null;
  }

  update(rawDistance, dt) {
    if (rawDistance == null) {
      // Joint data missing this frame — hold last known state, don't flicker.
      return this.pinching;
    }

    this.smoothedDistance = this.smoothedDistance == null
      ? rawDistance
      : damp(this.smoothedDistance, rawDistance, 40, dt);

    if (!this.pinching && this.smoothedDistance <= CONFIG.pinch.engageThreshold) {
      this.pinching = true;
    } else if (this.pinching && this.smoothedDistance >= CONFIG.pinch.releaseThreshold) {
      this.pinching = false;
    }
    return this.pinching;
  }
}
