import * as THREE from 'three';
import { CONFIG } from '../config/config';

/**
 * Desktop camera: click to capture the mouse, then look with the mouse and
 * walk with W A S D. While you are gripping the tear the look is frozen, so
 * mouse movement pulls the tear apart instead of turning your head.
 */
export class DesktopControls {
  enabled = true;
  /** Set false by the hand source while a grip is held. */
  lookEnabled = true;
  locked = false;
  /** True when pointer lock is unavailable and we use drag-to-look instead. */
  fallback = false;
  yaw = 0;
  pitch = -0.05;
  private dragLook = false;

  /** Mouse control is usable — either the pointer is captured, or we fell back. */
  get ready() {
    return this.locked || this.fallback;
  }

  private enableFallback() {
    if (this.locked || this.fallback) return;
    this.fallback = true;
    this.onLockChange?.(true);
  }

  /** Keeps desktop walking inside the current world (a room, an island…). */
  bounds: { centre: THREE.Vector3; radius: number } | null = null;

  /** Set false while gripping: the walk keys then pull the tear instead. */
  moveEnabled = true;
  /** Floor height of the current world at a point — the camera walks on it. */
  groundAt: (x: number, z: number) => number = () => 0;
  /** True while in the air after a jump. */
  airborne = false;

  private vy = 0;
  private crouch = 0; // Q/E adjust eye height relative to the floor
  private jumpQueued = false;

  /** Jump (ignored if already in the air). */
  jump() {
    if (!this.airborne) this.jumpQueued = true;
  }

  private keys = new Set<string>();
  private pressed = new Set<string>();
  private move = new THREE.Vector3();
  private onLockChange?: (locked: boolean) => void;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    camera.position.set(0, CONFIG.desktop.eyeHeight, 0);
    const handled = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (!e.repeat) this.pressed.add(e.code);
      if (handled.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('click', () => {
      if (!this.enabled || this.locked || this.fallback) return;
      try {
        const result = dom.requestPointerLock() as unknown as Promise<void> | undefined;
        if (result && typeof result.catch === 'function') result.catch(() => this.enableFallback());
      } catch {
        this.enableFallback();
      }
      // Some embedded browsers silently refuse the lock: fall back if it never arrives.
      window.setTimeout(() => {
        if (!this.locked) this.enableFallback();
      }, 350);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (this.locked) this.fallback = false;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.enableFallback());

    // Fallback look: hold the right mouse button (or left on empty space) and drag.
    dom.addEventListener('mousedown', (e) => {
      if (!this.fallback || this.locked) return;
      if (e.button === 2 || (e.button === 0 && this.lookEnabled)) this.dragLook = true;
    });
    window.addEventListener('mouseup', () => (this.dragLook = false));

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.lookEnabled) return;
      const usingLock = this.locked;
      if (!usingLock && !(this.fallback && this.dragLook)) return;
      const s = CONFIG.desktop.lookSensitivity;
      const dx = usingLock ? e.movementX : e.movementX || 0;
      const dy = usingLock ? e.movementY : e.movementY || 0;
      this.yaw -= dx * s;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -1.35, 1.35);
    });
  }

  onLock(fn: (locked: boolean) => void) {
    this.onLockChange = fn;
  }

  /** Was this key pressed since the last frame? (Each press is reported once.) */
  consumePress(code: string) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  consumeSpacePress() {
    return this.consumePress('Space');
  }

  isDown(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Forget presses nobody used this frame, so they cannot fire later by surprise. */
  endFrame() {
    this.pressed.clear();
  }

  release() {
    if (this.locked) document.exitPointerLock();
  }

  update(dt: number) {
    if (!this.enabled) return;
    const walk = this.moveEnabled;
    const f = walk ? (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0) : 0;
    const r = walk ? (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0) : 0;
    const up = walk ? (this.isDown('KeyE') ? 1 : 0) - (this.isDown('KeyQ') ? 1 : 0) : 0;
    const speed = CONFIG.desktop.moveSpeed * (this.isDown('ShiftLeft', 'ShiftRight') ? 2.2 : 1);
    this.move.set(r, 0, -f);
    if (this.move.lengthSq() > 0) {
      this.move.normalize().multiplyScalar(speed * dt).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw);
      this.camera.position.add(this.move);
    }
    if (up !== 0) {
      this.crouch = THREE.MathUtils.clamp(this.crouch + up * speed * dt, -1.1, 1.2);
    }
    if (this.bounds) {
      const dx = this.camera.position.x - this.bounds.centre.x;
      const dz = this.camera.position.z - this.bounds.centre.z;
      const d = Math.hypot(dx, dz);
      if (d > this.bounds.radius) {
        const k = this.bounds.radius / d;
        this.camera.position.x = this.bounds.centre.x + dx * k;
        this.camera.position.z = this.bounds.centre.z + dz * k;
      }
    }

    // Stand on the floor of whichever world this is (the forest is hilly), and
    // fall back onto it after a jump.
    const D = CONFIG.desktop;
    const standY = this.groundAt(this.camera.position.x, this.camera.position.z) + D.eyeHeight + this.crouch;
    if (this.jumpQueued) {
      this.jumpQueued = false;
      this.airborne = true;
      this.vy = D.jumpSpeed;
    }
    if (this.airborne) {
      this.vy -= D.gravity * dt;
      this.camera.position.y += this.vy * dt;
      if (this.camera.position.y <= standY && this.vy < 0) {
        this.camera.position.y = standY;
        this.airborne = false;
        this.vy = 0;
      }
    } else {
      // Smooth over bumps instead of snapping step by step.
      this.camera.position.y += (standY - this.camera.position.y) * Math.min(1, dt * 12);
    }

    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
