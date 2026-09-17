import * as THREE from 'three';
import { damp } from '../utils/math.js';

// "The hidden world should illuminate the current world... the portal
// therefore becomes a light source" (brief). A single PointLight at the
// opening whose intensity and range grow with openAmount, colored to
// match whatever world is behind — separate from SeamHint's tiny
// pre-interaction flicker, which fades out right as this takes over.
export class LightLeakSystem {
  constructor(veilAnchor, color) {
    this.light = new THREE.PointLight(color, 0, 6, 2);
    this.light.position.set(0, 0, 0.15); // just in front of the veil, toward the viewer's side
    veilAnchor.add(this.light);
    this._targetIntensity = 0;
  }

  update(dt, signal, color) {
    this.light.color.copy(color);
    this._targetIntensity = THREE.MathUtils.smoothstep(signal.openAmount, 0.03, 0.7) * 2.6;
    this.light.intensity = damp(this.light.intensity, this._targetIntensity, 6, dt);
    this.light.distance = 3 + signal.openAmount * 6;
  }
}
