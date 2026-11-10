import * as THREE from 'three';

/** Reuse this forest's daylight map between 30 Hz refreshes. Grass and camera
 * rendering still run every frame. Other worlds' shadow policies are untouched. */
export class ForestShadowRefresh {
  private nextTime = -Infinity;
  constructor(private readonly shadow: THREE.LightShadow, private readonly refreshHz = 30) {
    shadow.autoUpdate = false;
    shadow.needsUpdate = true;
  }
  invalidate() { this.nextTime = -Infinity; this.shadow.needsUpdate = true; }
  update(time: number) {
    // Static canopy lighting refreshes only after load or world alignment.
    if (this.refreshHz <= 0) return;
    if (!Number.isFinite(time)) return;
    if (time + 1e-6 >= this.nextTime) {
      this.shadow.needsUpdate = true;
      this.nextTime = time + 1 / this.refreshHz;
    }
  }
}
