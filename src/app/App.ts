import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { WORLD_NAMES } from '../config/worlds';
import { smoothstep } from '../utils/math';
import { PortalRenderer } from '../portal/PortalRenderer';
import { WorldOne } from '../worlds/WorldOne';
import { WorldTwo } from '../worlds/WorldTwo';
import { WorldThree } from '../worlds/WorldThree';
import { WorldUnderwater } from '../worlds/WorldUnderwater';
import { Creature } from '../worlds/Creature';
import { TearSimulation } from '../tear/TearSimulation';
import { Membrane } from '../tear/Membrane';
import { LightLeak } from '../lighting/LightLeak';
import { TearParticles } from '../particles/TearParticles';
import { WaterThreshold } from '../particles/WaterThreshold';
import { PinchTracker } from '../interaction/PinchTracker';
import { XRHandSource } from '../interaction/XRHandSource';
import { XRHelpGesture } from '../interaction/XRHelpGesture';
import { DesktopHandSource } from '../interaction/DesktopHandSource';
import { DesktopControls } from '../interaction/DesktopControls';
import { HandVisual } from '../interaction/HandVisual';
import { InteractionStateMachine, InteractionState } from '../state/InteractionStateMachine';
import { AudioEngine } from '../audio/AudioEngine';
import { Soundscape, WORLD_THREE_SOUNDS, WORLD_TWO_SOUNDS, UNDERWATER_SOUNDS } from '../audio/Soundscape';
import { TearVoice } from '../audio/TearVoice';
import { WhaleVoice } from '../audio/WhaleVoice';
import { DebugPanel } from '../debug/DebugPanel';
import { Hud } from '../ui/Hud';
import { Guide } from '../ui/Guide';
import type { HandSource } from '../interaction/types';
import { SpectatorView } from '../xr/SpectatorView';

export type AppMode = 'intro' | 'desktop' | 'xr';
/** A complete journey returns to the original room, then can begin again. */
export const NEXT_WORLD = [1, 2, 3, 0] as const;

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  mode: AppMode = 'intro';
  xrSessionState = 'none';
  xrMode: 'immersive-ar' | 'immersive-vr' = 'immersive-ar';
  private pendingXRPose = false;
  private xrFocusSuspended = false;
  private xrAwaitingRelease: [boolean, boolean] = [false, false];
  private spectator: SpectatorView;
  currentWorld: string = WORLD_NAMES[0];

  private portal: PortalRenderer;
  private worldOne = new WorldOne();
  private worldTwo: WorldTwo;
  private worldThree: WorldThree;
  private worldUnderwater: WorldUnderwater;
  private creature: Creature;
  /** outer world index; the next one is what you see through the tear. */
  private outerIndex = 0;
  private readonly nextWorld = NEXT_WORLD;
  private worlds: {
    scene: THREE.Scene;
    leakColor: THREE.Color;
    stencilLayer: number;
    update(t: number, lean: number): void;
    refreshStencil(): void;
    groundAt(x: number, z: number): number;
    readonly walkBounds?: { center: THREE.Vector3; radius: number };
    alignTo?(anchor: THREE.Object3D): void;
  }[];
  private guide: Guide;
  /** Space was pressed while the tear was wide enough: leap through. */
  private stepRequested = false;
  private soundscapes: (Soundscape | null)[] = [];
  private whaleVoice: WhaleVoice | null = null;
  private swallow = -1;
  private swapped = false;
  private arrivedAt = -99;
  private maskScene = new THREE.Scene();
  private overlay = new THREE.Scene();
  private anchor = new THREE.Group();
  private sim: TearSimulation;
  private membrane: Membrane;
  private light: LightLeak;
  private particles: TearParticles;
  private waterThreshold: WaterThreshold;
  private readonly forestGroundAt = (x: number, z: number) => this.worldTwo.groundAt(x, z);
  private trackers: [PinchTracker, PinchTracker] = [new PinchTracker(), new PinchTracker()];
  private xrHands: XRHandSource;
  private helpGesture = new XRHelpGesture();
  private desktopHands: DesktopHandSource;
  private controls: DesktopControls;
  private handVisual: HandVisual;
  readonly state = new InteractionStateMachine();
  readonly audio: AudioEngine;
  private voice: TearVoice;
  private debug: DebugPanel;
  private timer = new THREE.Timer();
  private time = 0;
  private xrStartPromise: Promise<void> | null = null;
  private lean = 0;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private gapCentre = new THREE.Vector3();
  private tearWorld = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpC = new THREE.Vector3();
  private viewerPosition = new THREE.Vector3();
  private viewerDirection = new THREE.Vector3();
  private rayCaster = new THREE.Raycaster();
  private hud = new Hud();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 1);
    // Without tone mapping the HDR sky and warm lights clip to flat white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = CONFIG.render.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.xr.setFramebufferScaleFactor(CONFIG.render.xrFramebufferScale);
    container.appendChild(this.renderer.domElement);
    this.portal = new PortalRenderer(this.renderer);
    this.spectator = new SpectatorView(this.renderer, this.portal);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 200);
    this.camera.position.set(0, CONFIG.desktop.eyeHeight, 0);

    this.anchor.position.set(0, CONFIG.tear.height, -CONFIG.tear.distance);
    this.worldOne.scene.add(this.anchor);
    this.worldTwo = new WorldTwo(this.anchor.position);
    this.worldThree = new WorldThree(this.anchor.position);
    this.worldUnderwater = new WorldUnderwater(this.anchor.position);
    this.worlds = [this.worldOne, this.worldTwo, this.worldUnderwater, this.worldThree];

    this.sim = new TearSimulation(this.anchor);
    this.membrane = new Membrane(this.anchor, this.maskScene, 0);
    this.light = new LightLeak(this.anchor, this.worldTwo.leakColor);
    this.particles = new TearParticles(this.overlay);
    this.waterThreshold = new WaterThreshold(this.overlay);
    this.handVisual = new HandVisual(this.overlay);
    this.debug = new DebugPanel(this.overlay, CONFIG.debug.enabledByDefault);

    // Each world remembers its own layer, because content that loads later
    // (models, plants, the creature) re-applies it to itself when it arrives.
    for (const world of this.worlds) {
      world.stencilLayer = world === this.worldOne ? 0 : 1;
      world.refreshStencil();
    }
    // Added after the layer sweep: it applies its own stencil layer once loaded.
    // Creature positions, home, perch and ground samples all belong to the
    // forest root, so aligning the destination carries the creature with it.
    this.creature = new Creature(this.worldTwo.root, new THREE.Vector3(), 1, this.worldTwo.perchLocal);
    // Its model arrives later; re-apply the forest's current portal layer then.
    this.creature.onLoaded = () => this.worldTwo.refreshStencil();
    this.creature.groundAt = (x, z) => this.worldTwo.groundHeight(x, z);

    // Hands belong to the overlay, which is drawn in every world — not to the
    // scene of whichever world happens to be outside right now.
    this.xrHands = new XRHandSource(this.renderer, this.overlay);
    this.controls = new DesktopControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.desktopHands = new DesktopHandSource(this.camera, this.renderer.domElement, this.anchor, this.controls);
    this.desktopHands.enabled = false;
    this.controls.groundAt = (x, z) => this.outerWorld.groundAt(x, z);
    this.guide = new Guide(this.overlay);
    // Clicking empty space tears there instead of doing nothing.
    this.desktopHands.onSeamRequest = (ray) => this.placeSeamAlongRay(ray);
    this.desktopHands.snapToSeam = (x, y) => this.sim.closestPoint(x, y);
    this.placeSeamInFront();

    this.audio = new AudioEngine(this.camera);
    this.soundscapes = [
      null, // World One: the room is silent on purpose
      new Soundscape(this.audio, this.worldTwo, WORLD_TWO_SOUNDS),
      new Soundscape(this.audio, this.worldUnderwater, UNDERWATER_SOUNDS),
      new Soundscape(this.audio, this.worldThree, WORLD_THREE_SOUNDS)
    ];
    this.voice = new TearVoice(this.audio, this.anchor);
    this.worldUnderwater.ready.then(() => {
      const whaleGroup = this.worldUnderwater.marineLife.whaleGroup;
      if (!whaleGroup) return;
      this.whaleVoice = new WhaleVoice(this.audio, whaleGroup);
      // The model can finish loading after the user already unlocked audio.
      this.whaleVoice.start();
    });

    this.sim.on((e) => {
      this.normal.set(0, 0, 1).transformDirection(this.anchor.matrixWorld);
      const leak = this.innerWorld.leakColor;
      if (e.type === 'rip') {
        this.particles.burst(e.tips, e.strength, this.normal, leak);
        this.voice.rip(e.strength);
      } else if (e.type === 'breakthrough') {
        this.particles.burst(e.tips, 2, this.normal, leak);
        this.voice.rip(2, true);
      }
    });

    this.renderer.xr.addEventListener('sessionstart', () => {
      this.mode = 'xr';
      this.xrSessionState = `${this.xrMode} running`;
      this.pendingXRPose = true;
      this.waterThreshold.reset();
      this.xrFocusSuspended = false;
      this.xrAwaitingRelease = [false, false];
      this.helpGesture.reset();
      this.desktopHands.forceRelease();
      this.trackers = [new PinchTracker(), new PinchTracker()];
      this.sim.reset();
      this.resetInteractionState();
      this.controls.release();
      this.desktopHands.enabled = false;
      this.controls.enabled = false;
      this.renderer.xr.setFoveation(CONFIG.render.xrFoveation);
      // Shadows are a desktop luxury; in the headset the frame budget is tighter.
      this.renderer.shadowMap.enabled = CONFIG.render.shadows && CONFIG.render.shadowsInXR;
      this.hud.setVisible(false);
      // In the headset the words in the air are the only guidance there is.
      this.guide.setVisible(true);
      // Place the first seam and guidance after the first actual tracked head pose.
      const session = this.renderer.xr.getSession();
      if (session) this.watchXRVisibility(session);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.xrSessionState = 'ended';
      this.waterThreshold.reset();
      this.pendingXRPose = false;
      this.xrFocusSuspended = false;
      this.xrAwaitingRelease = [false, false];
      this.helpGesture.reset();
      this.worldOne.root.visible = true;
      this.renderer.setClearAlpha(1);
      this.desktopHands.forceRelease();
      this.trackers = [new PinchTracker(), new PinchTracker()];
      this.sim.reset();
      this.resetInteractionState();
      this.swallow = -1;
      this.swapped = false;
      this.stepRequested = false;
      this.anchor.scale.setScalar(1);
      // DesktopControls owns yaw/pitch on the next frame. Resume the headset's
      // heading before placing the seam, otherwise that frame turns away from it.
      const heading = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.controls.yaw = heading.y;
      this.controls.pitch = THREE.MathUtils.clamp(heading.x, -1.35, 1.35);
      this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0, 'YXZ');
      this.mode = 'desktop';
      this.renderer.shadowMap.enabled = CONFIG.render.shadows;
      resize();
      this.enterDesktop();
      this.placeSeamInFront();
    });

    const resize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      // WebXR owns the framebuffer size while a session is running.
      if (!this.renderer.xr.isPresenting) this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
    };
    window.addEventListener('resize', resize);
    // The window event alone misses container-only resizes (panels, split views).
    new ResizeObserver(resize).observe(container);
    resize();

    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  async startAudio() {
    await this.audio.unlock();
    try {
      for (const s of this.soundscapes) s?.start();
      this.voice.start();
      this.whaleVoice?.start();
      this.creature.attachVoice(this.audio);
    } catch (err) {
      console.warn('Audio setup failed; continuing silently', err);
    }
  }

  private get outerWorld() {
    return this.worlds[this.outerIndex];
  }

  private get innerWorld() {
    return this.worlds[this.nextWorld[this.outerIndex]];
  }

  private resetInteractionState() {
    // updateTransition runs before the regular state update. A FullyOpen state
    // retained from the preceding mode must not auto-enter the next world.
    this.state.update({
      handsTracked: 0, anyPinching: false, gripsEngaged: 0, energy: 0,
      isOpen: false, fullyOpen: false, releaseSuspended: false,
      transitioning: false, discovered: false
    }, 0);
    this.state.timeInState = 0;
  }

  /** System menus may hide an XR session without delivering another XR frame. */
  private watchXRVisibility(session: XRSession) {
    const changed = () => {
      if (session.visibilityState !== 'visible') this.suspendXRInteraction();
    };
    session.addEventListener('visibilitychange', changed);
    session.addEventListener('end', () => session.removeEventListener('visibilitychange', changed), { once: true });
    changed();
  }

  private suspendXRInteraction() {
    if (this.xrFocusSuspended) return;
    this.xrFocusSuspended = true;
    this.helpGesture.cancelHold();
    this.xrAwaitingRelease = [true, true];
    this.trackers = [new PinchTracker(), new PinchTracker()];
    this.stepRequested = false;
    // A held-open tear must not cross while the wearer is in a system menu.
    // A crossing that already started keeps its phase and resumes without a jump.
    if (this.swallow < 0) this.sim.reset();
    this.resetInteractionState();
  }

  enterDesktop() {
    if (this.renderer.xr.isPresenting) return;
    this.mode = 'desktop';
    if (this.outerIndex === 0) this.currentWorld = WORLD_NAMES[0];
    this.worldOne.root.visible = true;
    this.renderer.setClearAlpha(1);
    this.desktopHands.enabled = true;
    this.controls.enabled = true;
    this.hud.setVisible(true);
    this.guide.setVisible(true);
    this.camera.getWorldDirection(this.tmpB).setY(0).normalize();
    this.guide.showNotesFor(20, this.time, this.camera.getWorldPosition(this.tmpA), this.tmpB);
    this.applyWalkBounds();
  }

  /**
   * Wide enough to step through with Space. Deliberately a little under the
   * "fully open" threshold, so a key press right at the edge is never ignored.
   */
  private canStepThrough() {
    if (this.swallow >= 0) return false;
    if (this.state.state === InteractionState.FullyOpen) return true;
    return this.sim.gripsHolding === 2 && this.sim.gap >= CONFIG.tear.fullyOpenGap * CONFIG.worlds.spaceStepFraction;
  }

  /**
   * A new seam may be started whenever nobody is holding the current one —
   * including while it is still healing (the old one simply seals shut).
   */
  private canPlaceSeam() {
    return this.swallow < 0 && this.sim.gripsHolding === 0;
  }

  /**
   * Put the seam wherever the user reached for: reality tears where you grab
   * it, not only at one appointed spot. Faces the viewer, at a sensible height.
   */
  private anchorSeamAt(point: THREE.Vector3) {
    if (!this.canPlaceSeam()) return false;
    const cam: THREE.Object3D = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    const eye = cam.getWorldPosition(this.tmpA);
    const dir = this.tmpB.subVectors(eye, point);
    dir.y = 0;
    if (dir.lengthSq() < 1e-5) dir.set(0, 0, 1);
    dir.normalize();
    // XR placement follows the tracked fingers, including seated users. Virtual
    // terrain must not push a physical pinch away from the seam it just placed.
    // Desktop placement still keeps the crack above its virtual floor.
    const floor = this.outerWorld.groundAt(point.x, point.z);
    const height = this.renderer.xr.isPresenting
      ? point.y
      : THREE.MathUtils.clamp(point.y, floor + 0.75, floor + 2.1);
    this.anchor.position.set(point.x, height, point.z);
    this.anchor.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    this.anchor.updateMatrixWorld();
    this.sim.reset();
    this.alignInnerWorld();
    return true;
  }

  /**
   * Desktop walking limits per world: the room has walls, the island has an
   * edge, the forest is effectively endless. Stops you strolling into the void.
   */
  private applyWalkBounds() {
    const limit = this.outerWorld.walkBounds;
    this.controls.bounds = limit
      ? { centre: limit.center.clone(), radius: limit.radius }
      : { centre: new THREE.Vector3(0, 0, -1.2), radius: 2.5 };
  }

  /** Give the world behind the tear a chance to compose itself for this view. */
  private alignInnerWorld() {
    this.innerWorld.alignTo?.(this.anchor);
  }

  /** Desktop: the crosshair ray, stopped short of whatever it would hit. */
  private placeSeamAlongRay(ray: THREE.Ray) {
    if (!this.canPlaceSeam()) return;
    this.rayCaster.set(ray.origin, ray.direction);
    this.rayCaster.near = 0.2;
    this.rayCaster.far = 6;
    // Only solid things count: not pollen / firefly points (three.js treats a
    // point as a 1 m ball by default), not the sky dome, not the old crack.
    const hit = this.rayCaster
      .intersectObject(this.outerWorld.scene, true)
      .find((h) => {
        const o = h.object as THREE.Mesh;
        if (!(o as THREE.Mesh).isMesh) return false;
        const mat = o.material as THREE.Material;
        if (mat.side === THREE.BackSide) return false;
        let p: THREE.Object3D | null = o;
        while (p) {
          if (p === this.anchor) return false;
          p = p.parent;
        }
        return true;
      });
    const reach = hit ? THREE.MathUtils.clamp(hit.distance - 0.45, 0.45, 1.35) : 1.15;
    this.anchorSeamAt(ray.at(reach, this.tmpC));
  }

  /** XR: both hands pinched together in open air, away from the current seam. */
  private maybePlaceSeamFromHands() {
    const [l, r] = this.trackers;
    if (!l.pinching || !r.pinching) return;
    if (!(l.pinchStarted || r.pinchStarted)) return;
    if (!this.canPlaceSeam()) return;
    const mid = this.tmpC.addVectors(l.position, r.position).multiplyScalar(0.5);
    if (l.position.distanceTo(r.position) > 0.8) return; // hands too far apart to be one gesture
    // Preserve a seam only when both hands can actually grab it. A larger
    // midpoint exclusion radius left fresh pinches between 22 and 30 cm with
    // neither a captured grip nor a new seam.
    const canGrabExisting = [l, r].every((hand) => {
      const local = this.anchor.worldToLocal(this.tmpA.copy(hand.position));
      const hit = this.sim.query(local.x, local.y);
      return Math.abs(local.z) <= CONFIG.tear.captureRadius &&
        hit.dist <= CONFIG.tear.captureRadius &&
        hit.arc >= -(this.sim.arcA + 0.12) && hit.arc <= this.sim.arcB + 0.12;
    });
    if (canGrabExisting) return;
    this.anchorSeamAt(mid);
  }

  /**
   * Hang the seam in front of wherever the user is actually looking, at a
   * comfortable height. Used at the start and after every world transition, so
   * the next tear is never behind you.
   */
  private placeSeamInFront() {
    const cam: THREE.Object3D = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    const pos = cam.getWorldPosition(this.tmpA);
    const dir = this.tmpB.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.tmpQ));
    dir.y = 0;
    if (dir.lengthSq() < 1e-5) dir.set(0, 0, -1);
    dir.normalize();
    const inXR = this.renderer.xr.isPresenting;
    const reach = inXR ? CONFIG.tear.xrDistance : CONFIG.tear.distance;
    const x = pos.x + dir.x * reach;
    const z = pos.z + dir.z * reach;
    // In a headset use chest height, including seated users; no forward lunge.
    const height = inXR ? Math.max(0.55, pos.y - 0.25) : this.outerWorld.groundAt(x, z) + CONFIG.tear.height;
    this.anchor.position.set(x, height, z);
    this.anchor.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
    this.anchor.updateMatrixWorld();
    this.alignInnerWorld();
  }

  async enterXR(mode: 'immersive-ar' | 'immersive-vr' = 'immersive-ar') {
    if (this.renderer.xr.isPresenting || this.renderer.xr.getSession()) return;
    if (this.xrStartPromise) return this.xrStartPromise;
    if (!navigator.xr) throw new Error('This browser has no WebXR support.');

    this.xrStartPromise = (async () => {
      // This call must be made directly from the button gesture, before audio awaits.
      const session = await navigator.xr!.requestSession(mode, {
        requiredFeatures: ['local-floor', 'hand-tracking'],
        optionalFeatures: ['bounded-floor', 'layers']
      });
      try {
        if (mode === 'immersive-ar' && session.environmentBlendMode !== 'alpha-blend') {
          throw new Error('Live-room passthrough is required. Open this project in Meta Quest Browser on your Quest 3S, or choose Desktop preview.');
        }
        this.xrMode = mode;
        // Every headset entry starts the full journey, even after a desktop preview.
        this.desktopHands.forceRelease();
        this.outerIndex = 0;
        this.currentWorld = WORLD_NAMES[0];
        this.worldOne.scene.add(this.anchor);
        this.anchor.scale.setScalar(1);
        this.swallow = -1;
        this.swapped = false;
        this.stepRequested = false;
        this.sim.reset();
        for (let i = 0; i < this.worlds.length; i++) {
          this.worlds[i].stencilLayer = i === 0 ? 0 : 1;
          this.worlds[i].refreshStencil();
        }
        this.worldOne.root.visible = mode !== 'immersive-ar';
        this.renderer.setClearAlpha(mode === 'immersive-ar' ? 0 : 1);
        await this.renderer.xr.setSession(session);
      } catch (err) {
        await session.end().catch(() => {});
        this.worldOne.root.visible = true;
        this.renderer.setClearAlpha(1);
        throw err;
      }
    })();

    try {
      await this.xrStartPromise;
    } finally {
      this.xrStartPromise = null;
    }
  }

  private tick(timestamp: number) {
    this.timer.update(timestamp);
    let dt = Math.min(this.timer.getDelta(), 0.05);
    const inXR = this.renderer.xr.isPresenting;
    if (inXR) {
      const frame = this.renderer.xr.getFrame();
      const referenceSpace = this.renderer.xr.getReferenceSpace();
      // Three retains its camera array between sessions. Only a current tracked
      // pose proves those matrices belong to this frame and this session.
      if (!frame || !referenceSpace || !frame.getViewerPose(referenceSpace)) {
        this.suspendXRInteraction();
        this.controls.endFrame();
        return;
      }
      const visible = this.renderer.xr.getSession()?.visibilityState === 'visible';
      if (!visible) this.suspendXRInteraction();
      else if (this.xrFocusSuspended) {
        this.xrFocusSuspended = false;
        // Discard the interval without a usable view; do not advance a crossing
        // on its first resumed frame or carry a previous fully-open hold timer.
        dt = 0;
        if (!this.pendingXRPose && this.swallow < 0) this.guide.flash('Open both hands|then pinch again when ready.', this.time);
      }
      if (this.xrFocusSuspended) dt = 0;
      // Resolve current world matrices before guidance, lean and seam placement,
      // rather than waiting for the first render pass to update the XR camera.
      this.renderer.xr.updateCamera(this.camera);
    }
    this.time += dt;
    if (inXR && !this.xrFocusSuspended && this.pendingXRPose && this.renderer.xr.getCamera().cameras.length > 0) {
      this.pendingXRPose = false;
      this.placeSeamInFront();
      const head = this.renderer.xr.getCamera();
      head.getWorldDirection(this.tmpB).setY(0).normalize();
      this.guide.resetJourney();
      this.guide.showNotesFor(20, this.time, head.getWorldPosition(this.tmpA), this.tmpB);
    }

    if (this.mode === 'desktop' && !inXR) {
      this.desktopHands.update(dt);
      if (this.controls.consumePress('KeyH')) {
        this.camera.getWorldDirection(this.tmpB).setY(0).normalize();
        this.guide.toggleNotes(this.camera.getWorldPosition(this.tmpA), this.tmpB, this.time);
      }
      // Space is a jump. Jumping at a tear that is open wide enough is a leap
      // through it; at a tear held but not yet wide, it hops and says why.
      if (this.controls.consumePress('Space')) {
        this.controls.jump();
        if (this.canStepThrough()) {
          this.stepRequested = true;
        } else if (this.desktopHands.gripping) {
          this.guide.flash('Pull it wider first — hold [D]|then [Space] to leap through', this.time);
        }
      }
      this.controls.update(dt);
    }

    const source: HandSource = inXR ? this.xrHands : this.desktopHands;
    const samples = [source.sample('left'), source.sample('right')];
    if (inXR) for (let h = 0; h < 2; h++) {
      const sample = samples[h];
      if (!this.xrFocusSuspended && sample.tracked && this.xrAwaitingRelease[h] &&
        sample.thumbTip.distanceTo(sample.indexTip) > CONFIG.pinch.releaseDistance) this.xrAwaitingRelease[h] = false;
      if (this.xrFocusSuspended || this.xrAwaitingRelease[h]) sample.tracked = false;
    }
    this.trackers[0].update(samples[0], dt);
    this.trackers[1].update(samples[1], dt);

    // In XR, pinching both hands together in open air starts a seam there.
    this.anchor.getWorldPosition(this.tearWorld);
    if (inXR && !this.xrFocusSuspended) this.maybePlaceSeamFromHands();

    // Preserve an in-progress tear exactly while a system overlay has focus.
    if (!inXR || !this.xrFocusSuspended) this.sim.update(this.trackers, dt, inXR ? CONFIG.tear.xrPullGain : 1);
    // Transitions change anchor scale/parent and may reset the seam. Resolve
    // them before copying the membrane transform into the stencil mask.
    if (!inXR || !this.xrFocusSuspended) this.updateTransition(dt);
    this.anchor.visible = !this.swapped;

    // Head lean: real XR head position (or desktop camera).
    const viewCam: THREE.Object3D = inXR ? this.renderer.xr.getCamera() : this.camera;
    const head = viewCam.getWorldPosition(this.viewerPosition);
    this.viewerDirection.set(0, 0, -1).applyQuaternion(viewCam.getWorldQuaternion(this.tmpQ)).normalize();
    // An open-palms hold recalls help without sharing the tear's pinch gesture.
    // World transitions, healing tears and interrupted tracking cannot summon it.
    const canRecallHelp = inXR && !this.xrFocusSuspended && !this.pendingXRPose &&
      this.swallow < 0 && this.sim.gripsHolding === 0 && this.sim.tornLength <= 0.005 &&
      !this.trackers[0].pinching && !this.trackers[1].pinching;
    if (this.helpGesture.update(samples, head, this.viewerDirection, dt, canRecallHelp)) {
      this.guide.toggleNotes(head, this.viewerDirection, this.time);
    }
    this.anchor.getWorldPosition(this.tmpB);
    const headDist = head.distanceTo(this.tmpB);
    this.lean = smoothstep(CONFIG.audio.leanFarDistance, CONFIG.audio.leanNearDistance, headDist);

    this.normal.set(0, 0, 1).transformDirection(this.anchor.matrixWorld);
    this.gapCentre.set(this.sim.centre.x, this.sim.centre.y, 0.02);
    this.anchor.localToWorld(this.gapCentre);

    const leak = this.innerWorld.leakColor;
    this.membrane.sync(this.sim, this.time, leak);
    this.light.update(dt, this.sim.openness, this.sim.crackOpenness, leak);
    this.particles.update(dt, this.gapCentre, this.normal, this.sim.openness, leak);
    const enteringWater = this.outerWorld === this.worldTwo && this.innerWorld === this.worldUnderwater && !this.swapped;
    this.waterThreshold.update(this.time, dt, this.anchor, {
      active: enteringWater && !this.xrFocusSuspended,
      openness: this.sim.openness,
      gap: this.sim.gap,
      centre: this.sim.centre,
      floorY: this.outerWorld.groundAt(this.tmpB.x, this.tmpB.z),
      groundAt: enteringWater ? this.forestGroundAt : undefined,
      crossing: this.swallow < 0 ? 0 : Math.min(this.swallow / 1.5, 1)
    });
    this.worldThree.updateView(head, this.viewerDirection,
      (this.mode === 'desktop' || this.mode === 'xr') &&
      this.outerWorld === this.worldThree && !this.swapped && this.swallow < 0 && !this.xrFocusSuspended, dt);
    if (this.worldThree.consumeReturnHint()) this.guide.flash('Something is watching.|The seam can take you home.', this.time);
    this.outerWorld.update(this.time, 0);
    this.innerWorld.update(this.time, this.lean);
    this.anchor.getWorldPosition(this.tearWorld);
    if (this.worldTwo === this.outerWorld || this.worldTwo === this.innerWorld) {
      this.creature.update(
        dt, this.time, this.tearWorld, this.normal, this.sim.openness, this.sim.energy,
        this.worldTwo === this.outerWorld, head
      );
    }

    const healing = this.sim.gripsHolding === 0 && this.sim.tornLength > 0 && !this.sim.releaseSuspended;
    for (let i = 0; i < this.soundscapes.length; i++) {
      const s = this.soundscapes[i];
      if (!s) continue;
      if (i === this.outerIndex) s.update(dt, 1, 1, this.lean, true);
      else if (!this.swapped && this.worlds[i] === this.innerWorld) s.update(dt, this.sim.openness, this.sim.crackOpenness, this.lean, false);
      else s.mute(dt);
    }
    if (this.worldUnderwater === this.outerWorld) this.whaleVoice?.update(dt, 1, 1, true);
    else if (!this.swapped && this.worldUnderwater === this.innerWorld) this.whaleVoice?.update(dt, this.sim.openness, this.sim.crackOpenness, false);
    else this.whaleVoice?.mute(dt);
    this.voice.update(dt, this.sim.strain, this.sim.energy, healing, this.sim.openness);

    const tracked = (this.trackers[0].tracked ? 1 : 0) + (this.trackers[1].tracked ? 1 : 0);
    this.state.update({
      handsTracked: tracked,
      anyPinching: this.trackers[0].pinching || this.trackers[1].pinching,
      gripsEngaged: this.sim.gripsHolding,
      energy: this.sim.energy,
      isOpen: this.sim.tornLength > 0.005 || this.sim.grips.some((g) => g.weight > 0 && g.disp.length() > 0.01),
      fullyOpen: this.sim.gap >= CONFIG.tear.fullyOpenGap,
      releaseSuspended: this.sim.releaseSuspended,
      transitioning: this.swallow >= 0,
      discovered: this.time - this.arrivedAt < 4 && this.outerIndex !== 0
    }, dt);

    this.handVisual.update(samples, this.trackers, [this.sim.grips[0].holding, this.sim.grips[1].holding]);

    if (this.debug.tick(dt)) this.updateDebug(inXR);

    if (!inXR && this.mode === 'desktop') {
      this.hud.update({
        locked: this.controls.ready,
        canGrab: this.desktopHands.canGrab,
        gripping: this.desktopHands.gripping,
        openness: this.sim.openness,
        seamWorld: this.tearWorld,
        camera: this.camera
      });
    }

    // Words of light in the world — the same guidance on desktop and in the headset.
    const viewer = viewCam.getWorldPosition(this.tmpC);
    const viewerForward = this.tmpB.set(0, 0, -1).applyQuaternion(viewCam.getWorldQuaternion(this.tmpQ)).setY(0);
    if (viewerForward.lengthSq() < 1e-6) viewerForward.set(0, 0, -1);
    viewerForward.normalize();
    this.guide.update({
      xr: inXR,
      ready: inXR || this.controls.ready,
      canGrab: inXR ? false : this.desktopHands.canGrab,
      gripping: inXR ? this.sim.gripsHolding === 2 : this.desktopHands.gripping,
      gripsHolding: this.sim.gripsHolding,
      state: this.state.state,
      openness: this.sim.openness,
      strain: this.sim.strain,
      canStep: this.canStepThrough(),
      seamWorld: this.tearWorld,
      viewer,
      viewerForward,
      halfFovH: inXR
        ? 0.85
        : Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect),
      worldName: this.currentWorld,
      time: this.time,
      dt
    });

    // The world behind the tear only costs anything while there is something to
    // see through: a shut seam draws one world, not two.
    // Once the arrival world takes over, the old enlarged tear must not expose
    // the following world. Its new closed seam appears when the transition ends.
    const portalOpen = !this.swapped &&
      (this.sim.openness > 0.0005 || this.sim.tornLength > 0.001 || this.swallow >= 0);
    const passes = portalOpen
      ? [this.outerWorld.scene, this.maskScene, this.innerWorld.scene, this.overlay]
      : [this.outerWorld.scene, this.overlay];
    // The same AR session carries the whole journey. On the way home the real
    // room is visible only inside the tear; crossing restores full passthrough.
    const liveRoom = inXR && this.xrMode === 'immersive-ar' && this.outerIndex === 0;
    const returningToRoom = inXR && this.xrMode === 'immersive-ar' && portalOpen && this.innerWorld === this.worldOne;
    this.portal.render(this.camera, passes, liveRoom ? 'passthrough' : returningToRoom ? 'portal-passthrough' : 'opaque');
    if (inXR) this.spectator.render(this.camera, passes, { sessionMode: this.xrMode, sameComputer: true });
    this.controls.endFrame();
  }

  /**
   * Stepping through: hold the tear fully open and it stops being something you
   * look through - it widens past the edges of your vision and the far world is
   * simply where you are. No teleport, no fade to black.
   */
  private updateTransition(dt: number) {
    const SWALLOW_SECONDS = 1.5;
    if (this.swallow < 0) {
      const inXR = this.renderer.xr.isPresenting;
      const fullyOpen = this.state.state === InteractionState.FullyOpen;
      // In the headset, holding it open is the action. On desktop, the leap
      // (Space) is the action, so the automatic crossing waits longer.
      const holdNeeded = inXR ? CONFIG.worlds.fullyOpenHoldSeconds : CONFIG.worlds.desktopAutoStepSeconds;
      const autoStep = fullyOpen && this.state.timeInState > holdNeeded;
      const leap = this.stepRequested && this.canStepThrough();
      this.stepRequested = false;
      if (autoStep || leap) {
        this.swallow = 0;
        this.voice.rip(2, true);
      }
      return;
    }

    this.swallow += dt;
    const k = Math.min(this.swallow / SWALLOW_SECONDS, 1);
    // Accelerating growth, so the opening rushes past you at the end.
    this.anchor.scale.setScalar(1 + Math.pow(k, 2.2) * 26);
    if (!this.swapped && k > 0.72) {
      this.swapped = true;
      this.stepThrough();
    }
    if (k >= 1) {
      this.swallow = -1;
      this.swapped = false;
      this.anchor.scale.setScalar(1);
      this.sim.reset();
      this.placeSeamInFront();
    }
  }

  private stepThrough() {
    const next = this.nextWorld[this.outerIndex];
    this.outerIndex = next;
    const outer = this.outerWorld;
    // The tear travels with the user into the world they just entered, and
    // re-hangs in front of them so the next one is never behind their back.
    // Let go of anything still held, or the old grip would drag the new seam.
    this.desktopHands.forceRelease();
    outer.scene.add(this.anchor);
    outer.stencilLayer = 0;
    this.innerWorld.stencilLayer = 1;
    outer.refreshStencil();
    this.innerWorld.refreshStencil();
    const realRoom = this.renderer.xr.isPresenting && this.xrMode === 'immersive-ar';
    this.worldOne.root.visible = !realRoom;
    this.currentWorld = WORLD_NAMES[next];
    this.arrivedAt = this.time;
    this.applyWalkBounds();
  }

  private updateDebug(inXR: boolean) {
    const [l, r] = this.trackers;
    const s = this.sim;
    const f = (v: number, d = 3) => v.toFixed(d);
    const angle = (Math.atan2(s.pullDir.y, s.pullDir.x) * 180) / Math.PI;
    this.debug.show([
      `fps        ${f(this.debug.fps, 0)}`,
      `xr         ${this.xrSessionState} (${this.mode})`,
      `world      ${this.currentWorld}`,
      `state      ${this.state.state}`,
      `L hand     ${l.tracked ? 'tracked' : 'lost'} pinch=${l.pinching} d=${f(l.pinchDistance)} v=${f(l.speed, 2)}`,
      `R hand     ${r.tracked ? 'tracked' : 'lost'} pinch=${r.pinching} d=${f(r.pinchDistance)} v=${f(r.speed, 2)}`,
      `grips      ${s.grips.map((g) => (g.holding ? 'HOLD' : g.weight > 0 ? 'relax' : '-')).join(' / ')}`,
      `gap        ${f(s.gap)} m   open ${f(s.openness, 2)}`,
      `torn       A ${f(s.tornA)}  B ${f(s.tornB)}  pts ${s.points.length}`,
      `strain     ${f(s.strain)}  energy ${f(s.energy, 2)}`,
      `direction  ${f(angle, 0)} deg`,
      `lean       ${f(this.lean, 2)}`,
      `creature   ${this.creature.state}${this.creature.ready ? '' : ' (loading)'}`,
      `audio      ${this.audio.state} rec=${this.soundscapes[1]?.loadedRecordings ?? 0}/3`,
      `swallow    ${this.swallow < 0 ? '-' : this.swallow.toFixed(2)}`
    ], inXR);
  }
}

export { InteractionState };
