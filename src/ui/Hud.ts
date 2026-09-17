import * as THREE from 'three';

export interface HudInput {
  locked: boolean;
  canGrab: boolean;
  gripping: boolean;
  openness: number;
  seamWorld: THREE.Vector3;
  camera: THREE.Camera;
}

/**
 * The only screen-space pieces left on desktop — everything else is written
 * into the world (see Guide). A crosshair to aim with, and an arrow at the
 * edge of the screen when the crack is behind you.
 */
export class Hud {
  private root = document.getElementById('hud') as HTMLDivElement;
  private crosshair = document.getElementById('crosshair') as HTMLDivElement;
  private arrow = document.getElementById('seam-arrow') as HTMLDivElement;
  private ndc = new THREE.Vector3();

  setVisible(visible: boolean) {
    this.root.hidden = !visible;
  }

  update(i: HudInput) {
    if (this.root.hidden) return;

    this.crosshair.classList.toggle('ready', i.canGrab && !i.gripping);
    this.crosshair.classList.toggle('holding', i.gripping);
    // Always shown: the keyboard aims with the centre of the view too.
    this.crosshair.hidden = false;

    this.ndc.copy(i.seamWorld).project(i.camera);
    const behind = this.ndc.z > 1;
    const offScreen = behind || Math.abs(this.ndc.x) > 0.92 || Math.abs(this.ndc.y) > 0.92;
    if (offScreen && i.locked && i.openness < 0.2) {
      const x = behind ? -this.ndc.x : this.ndc.x;
      const y = behind ? -this.ndc.y : this.ndc.y;
      const angle = Math.atan2(-y, x);
      this.arrow.hidden = false;
      this.arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
      this.arrow.style.left = `${50 + Math.cos(angle) * 34}%`;
      this.arrow.style.top = `${50 + Math.sin(angle) * 34}%`;
    } else {
      this.arrow.hidden = true;
    }
  }
}
