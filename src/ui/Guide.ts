import * as THREE from 'three';
import { InteractionState } from '../state/InteractionStateMachine';
import { DiegeticLabel, type LabelContent } from './DiegeticLabel';

export interface GuideInput {
  xr: boolean;
  /** Desktop: the mouse is captured (or its fallback is active). */
  ready: boolean;
  canGrab: boolean;
  gripping: boolean;
  gripsHolding: number;
  state: InteractionState;
  openness: number;
  strain: number;
  canStep: boolean;
  seamWorld: THREE.Vector3;
  viewer: THREE.Vector3;
  viewerForward: THREE.Vector3;
  /** Half the horizontal field of view, radians (for placing text in view). */
  halfFovH: number;
  worldName: string;
  time: number;
  dt: number;
}

const DESKTOP_NOTES = [
  '[Mouse] look · [W][A][S][D] walk',
  '[F] grip the crack / release',
  'While gripping: [D] pull · [A] ease back',
  '[Shift] move or pull faster',
  '[Space] jump / cross an open tear',
  '[T] place a new tear · [R] release',
  '[H] close · fades in 20s · [Esc] free mouse'
];

const XR_NOTES = [
  '{pinch} Pinch with both hands',
  'Pull apart with relaxed elbows',
  'Hold the open tear steady to cross',
  'Release your pinches to let it heal',
  'Pinch together to start a new tear',
  'Help: face both open palms toward you',
  'Hold 1.5s · repeat to close · fades in 20s'
];

/**
 * One quiet next action, written into the space below the tear. The first
 * world teaches the interaction for twenty seconds, then idle guidance recedes.
 * Full controls are recalled with H or the deliberate two-open-palms gesture.
 */
export class Guide {
  private prompt = new DiegeticLabel(0.72, 340, { depthTest: false, renderOrder: 60 });
  private title = new DiegeticLabel(3.7, 300, { depthTest: false, renderOrder: 55 });
  private notes = new DiegeticLabel(0.92, 760, { depthTest: false, renderOrder: 58 });
  private flashText = '';
  private flashUntil = -1;
  private lastWorld = '';
  private worldCount = 0;
  private titleShownAt = -99;
  private notesOn = false;
  private notesUntil = -1;
  private discoverNotesUntil = -1;
  private lastTime = 0;
  private promptPos = new THREE.Vector3();
  private promptInitialised = false;
  private forward = new THREE.Vector3(0, 0, -1);
  private right = new THREE.Vector3(1, 0, 0);
  private toSeam = new THREE.Vector3();
  private target = new THREE.Vector3();
  private hidden = true;
  private lastHalfFov = 0.85;

  constructor(scene: THREE.Scene) {
    scene.add(this.prompt.mesh, this.title.mesh, this.notes.mesh);
  }

  /** Start a fresh onboarding journey once the new session has a tracked pose. */
  resetJourney() {
    this.lastWorld = '';
    this.worldCount = 0;
    this.titleShownAt = -99;
    this.notesOn = false;
    this.notesUntil = -1;
    this.discoverNotesUntil = -1;
    this.flashText = '';
    this.flashUntil = -1;
    this.promptInitialised = false;
    // Clear a previous world's words immediately; the next update places the
    // new title and prompt using the new session's real viewing position.
    for (const label of [this.prompt, this.title, this.notes]) {
      label.set({ text: '' });
      label.targetOpacity = 0;
      label.mesh.visible = false;
    }
  }

  flash(text: string, now: number, seconds = 2.2) {
    this.flashText = text;
    this.flashUntil = now + seconds;
  }

  toggleNotes(viewer: THREE.Vector3, forward: THREE.Vector3, now = this.lastTime) {
    this.notesOn = !this.notesOn;
    this.notesUntil = this.notesOn ? now + 20 : -1;
    if (this.notesOn) this.placeNotes(viewer, forward);
  }

  /** Introduce the controls shortcut without opening a second instruction panel. */
  showNotesFor(seconds: number, now: number, _viewer: THREE.Vector3, _forward: THREE.Vector3) {
    this.notesOn = false;
    this.notesUntil = -1;
    this.discoverNotesUntil = now + Math.min(seconds, 20);
  }

  setVisible(visible: boolean) {
    if (visible && this.hidden) {
      this.titleShownAt = this.lastTime;
      this.promptInitialised = false;
    }
    this.hidden = !visible;
  }

  update(i: GuideInput) {
    const dt = Number.isFinite(i.dt) ? THREE.MathUtils.clamp(i.dt, 0, 0.1) : 0;
    this.lastTime = i.time;
    this.lastHalfFov = Number.isFinite(i.halfFovH)
      ? THREE.MathUtils.clamp(i.halfFovH, 0.1, 1.45)
      : 0.85;
    this.forward.copy(i.viewerForward).setY(0);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);

    if (i.worldName !== this.lastWorld) {
      this.lastWorld = i.worldName;
      this.worldCount++;
      this.titleShownAt = i.time;
      this.title.set({ text: i.worldName, tone: 'title' });
      this.title.mesh.position.copy(i.viewer).addScaledVector(this.forward, 4.8);
      this.title.mesh.position.y = i.viewer.y + 0.5;
      this.notesOn = false;
    }

    // Help never obstructs an active tear, and it does not linger indefinitely.
    // This clock is paused with the experience when XR loses focus/tracking.
    if (i.time >= this.notesUntil || i.gripping || i.gripsHolding > 0 || i.state === InteractionState.WorldTransition) {
      this.notesOn = false;
    }
    const content = this.promptContent(i);
    this.prompt.set(content);
    const active = i.gripsHolding > 0 || i.gripping || this.isReadyToCross(i) || this.isHealing(i) || i.time < this.flashUntil;
    const idleFaded = !active && i.time >= this.discoverNotesUntil;
    this.prompt.targetOpacity = this.hidden || !content.text || this.notesOn || idleFaded ? 0 : 0.96;

    // Keep text at a comfortable reading distance and below the hands. Limit
    // the lateral offset by the actual viewport, including narrow windows.
    const distance = i.xr ? 1.4 : 1.1;
    const halfWidthAvailable = distance * Math.tan(Math.max(0.04, this.lastHalfFov - 0.07));
    const width = Math.min(0.72, halfWidthAvailable * 1.75);
    this.prompt.mesh.scale.setScalar(width / 0.72);
    this.toSeam.subVectors(i.seamWorld, i.viewer).setY(0);
    const side = this.toSeam.dot(this.right);
    const facing = this.toSeam.dot(this.forward);
    const maximumOffset = Math.max(0, halfWidthAvailable - width / 2);
    const offset = facing > 0 ? THREE.MathUtils.clamp(side * 0.12, -maximumOffset, maximumOffset) : 0;
    this.target.copy(i.viewer).addScaledVector(this.forward, distance).addScaledVector(this.right, offset);
    this.target.y = i.viewer.y - distance * Math.tan(0.24);
    if (!this.promptInitialised) {
      this.promptPos.copy(this.target);
      this.promptInitialised = true;
    }
    this.promptPos.lerp(this.target, 1 - Math.exp(-dt * 5));
    this.prompt.mesh.position.copy(this.promptPos);
    this.prompt.update(dt, i.viewer);

    const titleAge = i.time - this.titleShownAt;
    this.title.targetOpacity = !this.hidden && titleAge < 4.5 && !active && !this.notesOn && i.state !== InteractionState.WorldTransition ? 0.82 : 0;
    this.title.mesh.scale.setScalar(Math.min(1, (2 * 4.8 * Math.tan(this.lastHalfFov - 0.05)) / 3.7));
    this.title.update(dt, i.viewer);

    this.notes.setNotes('field notes', i.xr ? XR_NOTES : DESKTOP_NOTES);
    this.notes.targetOpacity = this.notesOn && !this.hidden ? 0.97 : 0;
    this.notes.update(dt, i.viewer);
  }

  private placeNotes(viewer: THREE.Vector3, forward: THREE.Vector3) {
    const direction = forward.clone().setY(0);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
    direction.normalize();
    const distance = 1.5;
    // A summoned reference stays where it was placed; it does not chase the gaze.
    this.notes.mesh.scale.setScalar(Math.min(1, (2 * distance * Math.tan(this.lastHalfFov - 0.05)) / 0.92));
    this.notes.mesh.position.copy(viewer).addScaledVector(direction, distance);
    this.notes.mesh.position.y = viewer.y - 0.1;
  }

  private isReadyToCross(i: GuideInput) {
    // canStep is the lower desktop Space threshold, not the XR auto-crossing threshold.
    return i.xr ? i.state === InteractionState.FullyOpen : i.canStep;
  }

  private isHealing(i: GuideInput) {
    return i.state === InteractionState.Healing || i.state === InteractionState.Releasing;
  }

  private step(i: GuideInput) {
    if (this.isReadyToCross(i)) return 3;
    if (i.gripping || i.gripsHolding === 2) return 2;
    if (i.canGrab || i.gripsHolding === 1) return 1;
    return 0;
  }

  private promptContent(i: GuideInput): LabelContent {
    if (i.state === InteractionState.WorldTransition) return { text: '' };
    const steps = this.worldCount <= 1 ? { total: 4, current: this.step(i) } : null;
    const showMeter = i.gripping || i.gripsHolding > 0 || i.openness > 0.02;
    const progress = showMeter && Number.isFinite(i.openness) ? THREE.MathUtils.clamp(i.openness, 0, 1) : null;
    const progressTone = this.isReadyToCross(i) ? 'ready' : i.strain > 0.05 ? 'strain' : 'normal';
    if (i.time < this.flashUntil) {
      return { text: this.flashText, tone: 'alert', steps, progress, progressTone };
    }
    return { text: i.xr ? this.xrText(i) : this.desktopText(i), steps, progress, progressTone };
  }

  private desktopText(i: GuideInput) {
    if (!i.ready && !i.gripping) return '[Click] to look around|[H] opens the field notes';
    if (this.isReadyToCross(i)) return '[Space] cross the tear';
    if (i.gripping) return '[D] gently pull apart|[A] ease back · [F] release';
    if (this.isHealing(i)) return 'The tear is healing|[F] hold it again';
    if (i.canGrab) return i.time < this.discoverNotesUntil
      ? '[F] hold the crack|[H] opens the field notes'
      : '[F] hold the crack|then [D] to pull it apart';
    const hint = '[W][A][S][D] move · [H] help';
    return `Find the glowing crack|${hint}`;
  }

  private xrText(i: GuideInput) {
    if (this.isReadyToCross(i)) return 'Hold steady to cross|keep both pinches closed';
    if (i.gripsHolding === 2) return 'Gently pull your hands apart|keep your elbows relaxed';
    if (i.gripsHolding === 1) return '{pinch} Pinch with your other hand|one hand on each side';
    if (this.isHealing(i)) return 'The tear is healing|{pinch} pinch again to hold it';
    return '{pinch} Pinch both sides of the crack|Help: both palms toward you · hold 1.5s';
  }
}
