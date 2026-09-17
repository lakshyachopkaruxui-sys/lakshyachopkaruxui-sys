import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import { XRSessionManager } from '../xr/XRSessionManager.js';
import { FadeOverlay } from '../xr/FadeOverlay.js';
import { HapticsSystem } from '../xr/HapticsSystem.js';
import { DebugOverlay } from '../debug/DebugOverlay.js';
import { HandTrackingSystem } from '../interaction/HandTrackingSystem.js';
import { DesktopFallbackController } from '../interaction/DesktopFallbackController.js';
import { InteractionState } from '../state/InteractionState.js';
import { SpatialAudioManager } from '../audio/SpatialAudioManager.js';
import { WorldManager } from '../worlds/WorldManager.js';
import { WORLD_Z } from '../worlds/worldConstants.js';

export class App {
  constructor(container) {
    this.container = container;

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0c0d10, CONFIG.render.fogNear, CONFIG.render.fogFar);

    this.renderer = new THREE.WebGLRenderer({
      antialias: CONFIG.render.antialias,
      stencil: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0c0d10, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.03, CONFIG.render.fogFar + 5);

    this.playerRig = new THREE.Group();
    this.playerRig.name = 'PlayerRig';
    this.playerRig.add(this.camera);
    this.playerRig.position.set(0, 1.6, WORLD_Z.worldOneSpawn);
    this.scene.add(this.playerRig);

    this.fadeOverlay = new FadeOverlay(this.camera);

    this.interactionState = new InteractionState();

    this.xr = new XRSessionManager(this.renderer, {
      onSessionStart: () => this._onXRStart(),
      onSessionEnd: () => this._onXREnd()
    });
    container.appendChild(this.xr.createButton());

    this.handTracking = new HandTrackingSystem(this.renderer, this.scene);
    this.desktopFallback = new DesktopFallbackController(this.renderer.domElement, this.camera, this.playerRig);
    this._activeHandSource = this.desktopFallback;

    this.audio = new SpatialAudioManager(this.camera);

    this.worldManager = new WorldManager(this.scene, this.camera, this.playerRig, this.interactionState, this.fadeOverlay, this.audio);

    this.haptics = new HapticsSystem(this.renderer);
    this.debugOverlay = new DebugOverlay();

    window.addEventListener('resize', () => this._onResize());

    this._started = false;
  }

  _onXRStart() {
    this._activeHandSource = this.handTracking;
  }

  _onXREnd() {
    this._activeHandSource = this.desktopFallback;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    if (this._started) return;
    this._started = true;
    this.renderer.setAnimationLoop((time) => this._tick(time));
  }

  _tick(time) {
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 0.05); // clamp huge dt spikes (tab backgrounded, etc.)

    if (this.xr.isPresenting) {
      this.handTracking.update(dt);
    } else {
      this.desktopFallback.update(dt);
    }

    const hands = this._activeHandSource.getHands();
    const handAvailable = this._activeHandSource.handAvailable;
    const currentSignal = this.worldManager.update(hands, handAvailable, dt);
    this.fadeOverlay.update(dt);

    if (currentSignal) this.haptics.update(currentSignal);

    this.debugOverlay.update(dt, {
      interactionState: this.interactionState,
      worldManager: this.worldManager,
      xr: this.xr,
      activeHandSourceName: this.xr.isPresenting ? 'hand-tracking' : 'desktop-fallback'
    });

    this.renderer.render(this.scene, this.camera);
  }
}
