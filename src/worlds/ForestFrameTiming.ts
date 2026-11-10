/** Real frame intervals for the existing developer readout. Simulation dt is
 * clamped for physics and must not be used to report slow rendering frames. */
export class ForestFrameTiming {
  fps = 0;
  p95Ms = 0;
  samples = 0;
  private readonly intervals = new Float64Array(180);
  private index = 0;
  private previous: number | undefined;
  private nextReport = 0;

  sample(now: number, active: boolean) {
    if (!active || !Number.isFinite(now)) { this.reset(); return; }
    if (this.previous === undefined) { this.previous = now; return; }
    const elapsed = now - this.previous;
    this.previous = now;
    if (elapsed <= 0) return;
    // A resumed tab/session starts a new sample window.
    if (elapsed > 1000) { this.reset(); this.previous = now; return; }
    this.intervals[this.index] = elapsed;
    this.index = (this.index + 1) % this.intervals.length;
    this.samples = Math.min(this.samples + 1, this.intervals.length);
    if (now < this.nextReport) return;
    this.nextReport = now + 500;
    const sorted = Array.from(this.intervals.subarray(0, this.samples)).sort((a, b) => a - b);
    this.fps = 1000 * sorted.length / sorted.reduce((sum, value) => sum + value, 0);
    this.p95Ms = sorted[Math.ceil(sorted.length * .95) - 1];
  }

  private reset() {
    this.previous = undefined; this.index = 0; this.samples = 0;
    this.nextReport = 0; this.fps = 0; this.p95Ms = 0;
  }
}
