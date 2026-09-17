import * as THREE from 'three';
import type { PinchTracker } from './PinchTracker';
import type { RawHandSample } from './types';

const MAX_JOINTS = 25;

/**
 * Soft luminous joints so users can see their hands in immersive mode
 * (no network-loaded hand models — works offline in a classroom).
 * The pinch point glows warm while gripping the tear.
 */
export class HandVisual {
  private joints: THREE.InstancedMesh;
  private pinchDots: THREE.Mesh[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private free = new THREE.Color(0xbfd0e6);
  private grip = new THREE.Color(0xffc27a);

  constructor(overlay: THREE.Scene) {
    this.joints = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xcfd8e6, transparent: true, opacity: 0.55, depthWrite: false }),
      MAX_JOINTS * 2
    );
    this.joints.frustumCulled = false;
    this.joints.count = 0;
    overlay.add(this.joints);
    for (let i = 0; i < 2; i++) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xbfd0e6, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      dot.frustumCulled = false;
      overlay.add(dot);
      this.pinchDots.push(dot);
    }
  }

  update(samples: RawHandSample[], trackers: PinchTracker[], gripping: boolean[]) {
    let n = 0;
    for (let h = 0; h < 2; h++) {
      const sample = samples[h];
      const tr = trackers[h];
      if (sample.tracked) {
        for (const p of sample.joints) {
          if (n >= MAX_JOINTS * 2) break;
          this.s.setScalar(0.0065);
          this.joints.setMatrixAt(n++, this.m.compose(p, this.q, this.s));
        }
      }
      const dot = this.pinchDots[h];
      dot.visible = tr.tracked;
      if (tr.tracked) {
        dot.position.copy(tr.position);
        const size = tr.pinching ? 0.012 : 0.006;
        dot.scale.setScalar(size);
        (dot.material as THREE.MeshBasicMaterial).color.copy(gripping[h] ? this.grip : this.free);
      }
    }
    this.joints.count = n;
    this.joints.instanceMatrix.needsUpdate = true;
  }
}
