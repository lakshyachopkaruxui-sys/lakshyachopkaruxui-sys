import * as THREE from 'three';
import { DiegeticLabel } from './DiegeticLabel';

/** A reachable, world-anchored action with a visible fingertip dwell target. */
export class XRActionTarget {
  readonly position = new THREE.Vector3();
  private readonly root = new THREE.Group();
  private readonly disk: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly label = new DiegeticLabel(0.24, 320, { renderOrder: 73 });
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private placed = false;
  private text: string;

  constructor(scene: THREE.Scene, text: string, private readonly side = 1, private readonly heightOffset = 0) {
    this.text = text;
    this.disk = new THREE.Mesh(new THREE.CircleGeometry(0.038, 32), new THREE.MeshBasicMaterial({
      color: 0x16232c, transparent: true, opacity: 0.94, depthTest: false, depthWrite: false, toneMapped: false
    }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.032, 0.037, 40), new THREE.MeshBasicMaterial({
      color: 0xe8d8bc, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false
    }));
    this.disk.renderOrder = 71;
    this.ring.renderOrder = 72;
    this.root.add(this.disk, this.ring);
    this.root.visible = false;
    scene.add(this.root, this.label.mesh);
  }

  place(viewer: THREE.Vector3, direction: THREE.Vector3) {
    this.forward.copy(direction).setY(0);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
    this.position.copy(viewer).addScaledVector(this.forward, 0.40).addScaledVector(this.right, 0.16 * this.side);
    this.position.y = Math.max(0.35, viewer.y - 0.24 + this.heightOffset);
    this.root.position.copy(this.position);
    this.root.rotation.y = Math.atan2(-this.forward.x, -this.forward.z);
    this.label.mesh.position.copy(this.position);
    this.label.mesh.position.y -= 0.075;
    this.placed = true;
  }

  setText(text: string) { this.text = text; }

  update(viewer: THREE.Vector3, dt: number, visible: boolean, progress = 0) {
    const show = visible && this.placed;
    this.root.visible = show;
    this.label.targetOpacity = show ? 0.96 : 0;
    this.label.set({ text: this.text + '|Hold fingertip in circle' });
    this.label.update(dt, viewer);
    // Reuse one geometry; reveal its triangles instead of allocating per frame.
    const fraction = THREE.MathUtils.clamp(progress, 0, 1);
    const count = this.ring.geometry.index!.count;
    this.ring.geometry.setDrawRange(0, fraction > 0 ? Math.max(6, Math.floor(count * fraction / 6) * 6) : count);
    this.ring.material.opacity = fraction > 0 ? 1 : 0.45;
    this.disk.material.color.setHex(fraction > 0 ? 0x3e5a5d : 0x16232c);
  }
}
