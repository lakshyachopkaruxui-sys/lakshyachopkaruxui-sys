import { CONFIG } from '../config/config.js';
import { TwoHandTearController } from '../interaction/TwoHandTearController.js';
import { States } from '../state/InteractionState.js';
import { WorldOne } from './WorldOne.js';
import { WorldTwo } from './WorldTwo.js';
import { WorldThree } from './WorldThree.js';
import { WorldOneEcho } from './WorldOneEcho.js';
import { WORLD_Z } from './worldConstants.js';

// Owns which worlds exist, loads the next one progressively once its
// "peek" is reachable (brief: "Load worlds progressively. Do not load
// everything immediately"), and drives the fade-cut transition when the
// player commits to stepping through a fully-open tear.
//
// Key design point: EVERY loaded world keeps its OWN TwoHandTearController
// ticking every frame, all fed the same live hand input. This isn't
// wasted work — because each controller only engages when both hands are
// within ~0.5m of ITS OWN veil (see TwoHandTearController's proximity
// gate), and the worlds are 20-30+ meters apart along the shared Z line,
// at most one controller is ever actually engaged at a time. The useful
// side effect: a world's tear keeps healing on its own after the player
// walks away from it (their hands are simply no longer near it), which is
// exactly the "effort" behavior the brief asks for, with no special-casing.
export class WorldManager {
  constructor(scene, camera, playerRig, interactionState, fadeOverlay, audio) {
    this.scene = scene;
    this.camera = camera;
    this.playerRig = playerRig;
    this.interactionState = interactionState;
    this.fadeOverlay = fadeOverlay;
    this.audio = audio;

    this.current = 'one';
    this._transitioning = false;
    this._commitTimer = 0;

    this.worldOne = new WorldOne(scene, { audio });
    this.worldOne.setCamera(camera);
    this.worldOne.tearController = new TwoHandTearController(this.worldOne.veilAnchor);

    this.worldTwo = null;
    this.worldThree = null;
    this.worldOneEcho = null;
  }

  update(hands, handAvailable, dt) {
    const oneSignal = this.worldOne.tearController.update(hands, handAvailable, dt);
    this.worldOne.update(dt, oneSignal);

    let twoSignal = null;
    let threeSignal = null;

    if (this.worldTwo) {
      twoSignal = this.worldTwo.tearController.update(hands, handAvailable, dt);
      this.worldTwo.update(dt, twoSignal, oneSignal);
    } else if (oneSignal.stage >= CONFIG.worlds.peekLoadStage) {
      this._loadWorldTwo();
    }

    if (this.worldThree) {
      threeSignal = this.worldThree.tearController.update(hands, handAvailable, dt);
      this.worldThree.update(dt, threeSignal, twoSignal);
    } else if (twoSignal && twoSignal.stage >= CONFIG.worlds.peekLoadStage) {
      this._loadWorldThree();
    }

    if (!this.worldOneEcho && threeSignal && threeSignal.stage >= CONFIG.worlds.peekLoadStage) {
      this.worldOneEcho = new WorldOneEcho(this.scene);
    }

    const currentWorld = this.current === 'one' ? this.worldOne : this.current === 'two' ? this.worldTwo : this.worldThree;
    const currentSignal = this.current === 'one' ? oneSignal : this.current === 'two' ? twoSignal : threeSignal;

    // Only the world the player can actually reach right now is allowed to
    // drive the shared InteractionState — see the class comment above and
    // TwoHandTearController.localState for why every OTHER loaded
    // controller's opinion must be ignored here.
    if (!this._transitioning && currentWorld) {
      this.interactionState.setState(currentWorld.tearController.localState);
    }

    this._checkCommit(currentSignal, dt);

    return currentSignal;
  }

  _loadWorldTwo() {
    this.worldTwo = new WorldTwo(this.scene, { audio: this.audio });
    this.worldTwo.setCamera(this.camera);
    this.worldTwo.tearController = new TwoHandTearController(this.worldTwo.veilAnchor);
  }

  _loadWorldThree() {
    this.worldThree = new WorldThree(this.scene, { audio: this.audio });
    this.worldThree.setCamera(this.camera);
    this.worldThree.tearController = new TwoHandTearController(this.worldThree.veilAnchor);
  }

  _checkCommit(signal, dt) {
    if (this._transitioning || !signal) {
      this._commitTimer = 0;
      return;
    }
    if (signal.engaged && signal.openAmount >= 0.999) {
      this._commitTimer += dt;
      if (this._commitTimer >= CONFIG.worlds.commitHoldSeconds) {
        this._commit();
      }
    } else {
      this._commitTimer = 0;
    }
  }

  _commit() {
    this._transitioning = true;
    this._commitTimer = 0;
    this.interactionState.setState(States.TRANSITIONING);

    const leakHex = (this.current === 'one' ? this.worldOne.leakColor
      : this.current === 'two' ? this.worldTwo.leakColor
      : this.worldThree.leakColor).getHex();

    const halfDuration = CONFIG.worlds.transitionFadeMs / 1000 / 2;

    this.fadeOverlay.play(leakHex, halfDuration, () => {
      if (this.current === 'one') {
        this.playerRig.position.set(0, 1.6, WORLD_Z.worldTwoSpawn);
        this.current = 'two';
      } else if (this.current === 'two') {
        this.playerRig.position.set(0, 1.6, WORLD_Z.worldThreeSpawn);
        this.current = 'three';
      } else {
        // Final loop: back to the ORIGINAL World One instance, now
        // permanently marked with the echo of World Two.
        this.worldOne.addEchoOfWorldTwo();
        this.playerRig.position.set(0, 1.6, WORLD_Z.worldOneSpawn);
        this.current = 'one';
      }
    });

    setTimeout(() => {
      this.interactionState.setState(States.WORLD_DISCOVERED);
      this._transitioning = false;
    }, CONFIG.worlds.transitionFadeMs + 50);
  }
}
