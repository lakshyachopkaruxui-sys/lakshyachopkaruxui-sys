import * as THREE from 'three';

// One-Euro filter (Casiez, Roussel, Vogel 2012): heavy smoothing when a hand
// is still, low latency when it moves fast. Applied per axis.
class LowPass {
  private y = 0;
  private initialized = false;
  filter(x: number, alpha: number) {
    if (!this.initialized) {
      this.y = x;
      this.initialized = true;
    } else {
      this.y = alpha * x + (1 - alpha) * this.y;
    }
    return this.y;
  }
  get value() {
    return this.y;
  }
  reset() {
    this.initialized = false;
  }
}

const alphaFor = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

class OneEuro1D {
  private x = new LowPass();
  private dx = new LowPass();
  private hasPrev = false;
  private prev = 0;
  constructor(private minCutoff: number, private beta: number, private dCutoff = 1.0) {}
  filter(value: number, dt: number) {
    const d = this.hasPrev ? (value - this.prev) / dt : 0;
    this.prev = value;
    this.hasPrev = true;
    const edx = this.dx.filter(d, alphaFor(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alphaFor(cutoff, dt));
  }
  reset() {
    this.x.reset();
    this.dx.reset();
    this.hasPrev = false;
  }
}

export class OneEuroVector3 {
  private fx: OneEuro1D;
  private fy: OneEuro1D;
  private fz: OneEuro1D;
  constructor(minCutoff: number, beta: number) {
    this.fx = new OneEuro1D(minCutoff, beta);
    this.fy = new OneEuro1D(minCutoff, beta);
    this.fz = new OneEuro1D(minCutoff, beta);
  }
  filter(v: THREE.Vector3, dt: number, out: THREE.Vector3) {
    const safeDt = Math.max(dt, 1 / 240);
    return out.set(this.fx.filter(v.x, safeDt), this.fy.filter(v.y, safeDt), this.fz.filter(v.z, safeDt));
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}
