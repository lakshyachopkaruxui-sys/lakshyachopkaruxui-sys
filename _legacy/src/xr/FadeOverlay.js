import * as THREE from 'three';

// A small always-in-front, camera-attached quad used for comfortable
// world-transition fades (fade to a color, snap the player rig's
// position, fade back in). Parented to the camera itself — not a DOM/CSS
// overlay — so it's visible inside an actual XR headset too, not just the
// desktop browser window.
export class FadeOverlay {
  constructor(camera) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.renderOrder = 9999;
    this.mesh.position.set(0, 0, -0.12); // just in front of the near plane
    this.mesh.scale.set(0.3, 0.3, 1);
    this.mesh.visible = false;
    camera.add(this.mesh);

    this._t = 0;
    this._duration = 1;
    this._phase = 'idle'; // idle | out | in
    this._onMid = null;
  }

  /** Fade to opaque, call onMid, then fade back to clear. */
  play(colorHex, halfDurationSeconds, onMid) {
    this.mesh.material.color.setHex(colorHex);
    this._duration = halfDurationSeconds;
    this._t = 0;
    this._phase = 'out';
    this._onMid = onMid;
    this.mesh.visible = true;
  }

  update(dt) {
    if (this._phase === 'idle') return;
    this._t += dt;
    const t = Math.min(this._t / this._duration, 1);

    if (this._phase === 'out') {
      this.mesh.material.opacity = t;
      if (t >= 1) {
        this._onMid && this._onMid();
        this._phase = 'in';
        this._t = 0;
      }
    } else if (this._phase === 'in') {
      this.mesh.material.opacity = 1 - t;
      if (t >= 1) {
        this._phase = 'idle';
        this.mesh.visible = false;
      }
    }
  }
}
