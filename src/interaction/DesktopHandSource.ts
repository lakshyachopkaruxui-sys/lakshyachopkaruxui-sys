import * as THREE from 'three';
import { CONFIG } from '../config/config';
import type { DesktopControls } from './DesktopControls';
import type { Handedness, HandSource, RawHandSample } from './types';

/**
 * Desktop SIMULATION of two hands, for development and as a classroom backup.
 *
 * Aim the crosshair at the crack, then press F (or hold the left mouse
 * button): both hands grip either side of it. While gripping, the view holds
 * still and D / → (or moving the mouse right) pulls the hands apart, A / ←
 * eases them back, W / S move the grip, Q / E or the wheel pull the membrane
 * toward you, Shift pulls harder. F, R, or releasing the mouse lets go.
 * T tears a fresh crack wherever you are looking.
 */
export class DesktopHandSource implements HandSource {
  readonly kind = 'desktop' as const;
  enabled = true;
  /** True while the crosshair is close enough to the seam to grab it. */
  canGrab = false;
  gripping = false;
  /** Called when the user grabs empty space: the app tears a new seam there. */
  onSeamRequest?: (ray: THREE.Ray) => void;
  /** Nearest point on the crack, so the two hands straddle it rather than sit beside it. */
  snapToSeam?: (x: number, y: number) => { x: number; y: number };

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane();
  private aimLocal = new THREE.Vector3();
  private aimValid = false;
  private startLocal = new THREE.Vector3();
  private spread = 0;
  private vertical = 0;
  private depth = 0;
  private tmp = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private samples: Record<Handedness, RawHandSample>;

  constructor(
    private camera: THREE.Camera,
    dom: HTMLElement,
    private anchor: THREE.Object3D,
    private controls: DesktopControls
  ) {
    const mk = (): RawHandSample => ({
      tracked: false,
      thumbTip: new THREE.Vector3(),
      indexTip: new THREE.Vector3(),
      joints: [new THREE.Vector3(), new THREE.Vector3()]
    });
    this.samples = { left: mk(), right: mk() };

    dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.enabled || !this.controls.ready) return;
      this.beginGrip('mouse');
    });
    // A mouse grip ends when the button is released; a keyboard grip (F) stays
    // until F is pressed again, so nobody has to hold two things at once.
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.gripSource === 'mouse') this.endGrip();
    });
    window.addEventListener('blur', () => this.endGrip());
    document.addEventListener('pointerlockchange', () => {
      if (!this.controls.ready && this.gripSource === 'mouse') this.endGrip();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.gripping) return;
      // Right = apart, left = together. (Previously either direction widened,
      // which is what made pulling feel confusing.)
      this.spread = THREE.MathUtils.clamp(this.spread + e.movementX * CONFIG.desktop.dragToMetres, 0, CONFIG.desktop.maxSpread);
      this.vertical = THREE.MathUtils.clamp(this.vertical - e.movementY * CONFIG.desktop.dragToMetres, -0.5, 0.5);
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.gripping) return;
      e.preventDefault();
      this.depth = THREE.MathUtils.clamp(this.depth - e.deltaY * CONFIG.desktop.wheelToMetres, -0.1, 0.4);
    }, { passive: false });
  }

  /** Where the crosshair meets the membrane plane, and whether that is grabbable. */
  private updateAim() {
    this.anchor.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.anchor.getWorldPosition(this.tmp);
    this.tmpN.set(0, 0, 1).transformDirection(this.anchor.matrixWorld);
    this.plane.setFromNormalAndCoplanarPoint(this.tmpN, this.tmp);
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.tmp);
    this.aimValid = !!hit;
    if (hit) {
      // Measure reach in WORLD space before converting: worldToLocal() changes
      // the vector in place. (Measuring afterwards compared the camera with a
      // local point, which only worked near the world origin — so grabbing
      // failed once you had walked out among the trees.)
      const reach = this.raycaster.ray.origin.distanceTo(hit) < 3.2;
      this.aimLocal.copy(this.anchor.worldToLocal(hit));
      const withinPanel = Math.abs(this.aimLocal.x) < 0.5 && Math.abs(this.aimLocal.y) < 0.6;
      const facing = this.raycaster.ray.direction.dot(this.tmpN) < 0;
      this.canGrab = withinPanel && facing && reach;
    } else {
      this.canGrab = false;
    }
  }

  private gripSource: 'mouse' | 'key' | null = null;

  /** Grip the crack under the crosshair — or tear a new one there if there is none. */
  private beginGrip(source: 'mouse' | 'key') {
    if (this.gripping) return;
    this.updateAim();
    if (!this.canGrab || !this.nearSeam()) {
      // Reality tears where you reach for it: ask the app to move the seam
      // here, then aim again at the seam that now exists.
      this.onSeamRequest?.(this.raycaster.ray.clone());
      this.updateAim();
    }
    if (!this.canGrab) return;
    this.gripping = true;
    this.gripSource = source;
    // Snap the grab onto the crack itself: one hand must end up on each side
    // of it, or there is nothing to pull apart.
    const onSeam = this.snapToSeam?.(this.aimLocal.x, this.aimLocal.y);
    this.startLocal.set(onSeam ? onSeam.x : this.aimLocal.x, onSeam ? onSeam.y : this.aimLocal.y, this.aimLocal.z);
    this.spread = 0;
    this.vertical = 0;
    this.depth = 0;
    // While holding, the view stays still and the walk keys pull the tear.
    this.controls.lookEnabled = false;
    this.controls.moveEnabled = false;
  }

  private endGrip() {
    if (!this.gripping) return;
    this.gripping = false;
    this.gripSource = null;
    this.controls.lookEnabled = true;
    this.controls.moveEnabled = true;
  }

  /** Keyboard interaction, once per frame. */
  update(dt: number) {
    const c = this.controls;
    // Keyboard works whether or not the mouse has been captured yet — only
    // looking around needs the mouse.
    if (!this.enabled) return;

    if (c.consumePress('KeyF')) {
      if (this.gripping) this.endGrip();
      else this.beginGrip('key');
    }
    if (c.consumePress('KeyR')) this.endGrip();
    if (c.consumePress('KeyT') && !this.gripping) {
      this.updateAim();
      this.onSeamRequest?.(this.raycaster.ray.clone());
    }

    if (!this.gripping) return;
    const D = CONFIG.desktop;
    const hard = c.isDown('ShiftLeft', 'ShiftRight');
    const speed = hard ? D.keyPullSpeedHard : D.keyPullSpeed;
    const apart = (c.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (c.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const lift = (c.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (c.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const toward = (c.isDown('KeyE') ? 1 : 0) - (c.isDown('KeyQ') ? 1 : 0);
    this.spread = THREE.MathUtils.clamp(this.spread + apart * speed * dt, 0, D.maxSpread);
    this.vertical = THREE.MathUtils.clamp(this.vertical + lift * 0.35 * dt, -0.5, 0.5);
    this.depth = THREE.MathUtils.clamp(this.depth + toward * 0.3 * dt, -0.1, 0.4);
  }

  /** Drop any held grip (used when the world changes under the user). */
  forceRelease() {
    this.endGrip();
  }

  /** Is the crosshair actually on the crack, rather than just on the plane? */
  private nearSeam() {
    if (!this.aimValid) return false;
    const onSeam = this.snapToSeam?.(this.aimLocal.x, this.aimLocal.y);
    const distance = onSeam
      ? Math.hypot(this.aimLocal.x - onSeam.x, this.aimLocal.y - onSeam.y)
      : Math.hypot(this.aimLocal.x, this.aimLocal.y);
    return distance < 0.35;
  }

  sample(side: Handedness): RawHandSample {
    const s = this.samples[side];
    s.tracked = this.enabled;
    if (!s.tracked) return s;
    if (!this.gripping) this.updateAim();
    if (!this.aimValid) {
      s.tracked = false;
      return s;
    }

    const sign = side === 'left' ? -1 : 1;
    const local = this.tmp;
    if (this.gripping) {
      // Hands separate symmetrically about the point you grabbed.
      local.set(
        this.startLocal.x + sign * (0.045 + Math.abs(this.spread)),
        this.startLocal.y + this.vertical,
        0.02 + this.depth
      );
    } else {
      local.set(this.aimLocal.x + sign * 0.045, this.aimLocal.y, 0.05);
    }

    const pinchGap = this.gripping ? 0.004 : 0.06;
    s.thumbTip.set(local.x, local.y - pinchGap * 0.5, local.z);
    s.indexTip.set(local.x, local.y + pinchGap * 0.5, local.z);
    this.anchor.localToWorld(s.thumbTip);
    this.anchor.localToWorld(s.indexTip);
    s.joints[0].copy(s.thumbTip);
    s.joints[1].copy(s.indexTip);
    return s;
  }
}
