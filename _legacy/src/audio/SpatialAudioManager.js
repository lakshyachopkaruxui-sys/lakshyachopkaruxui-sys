import * as THREE from 'three';
import { CONFIG } from '../config/config.js';
import { createNoiseBuffer } from '../utils/audioSynthesis.js';
import { TearAudioVoice } from './TearAudioVoice.js';
import { AmbienceVoice } from './AmbienceVoice.js';

// Top-level audio system: one shared AudioListener/AudioContext, one
// shared noise buffer (every synthesized sound in the project reuses it —
// see README "Asset Strategy", no audio files anywhere), and factories for
// the per-veil and per-world voices. Browsers require a user gesture
// before an AudioContext can produce sound, so playback is silently
// muted until the first click/key/tap/XR-select, matching the WebXR
// entry flow (the VRButton click itself satisfies this in-headset).
export class SpatialAudioManager {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    this.ctx = this.listener.context;

    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.audio.masterGain;
    this.master.connect(this.ctx.destination);
    // Route the listener's own output into our master gain instead of
    // straight to destination, so CONFIG.audio.masterGain governs everything.
    this.listener.getInput().disconnect();
    this.listener.getInput().connect(this.master);

    this.noiseBuffer = createNoiseBuffer(this.ctx, 2);

    this._resumeOnGesture = () => {
      if (this.ctx.state === 'suspended') this.ctx.resume();
    };
    ['pointerdown', 'keydown'].forEach((evt) =>
      window.addEventListener(evt, this._resumeOnGesture, { passive: true })
    );
  }

  createTearVoice(veilAnchor) {
    return new TearAudioVoice(this.listener, veilAnchor, this.ctx, this.noiseBuffer);
  }

  createAmbience(anchorObject3D, options) {
    return new AmbienceVoice(this.listener, anchorObject3D, this.ctx, this.noiseBuffer, options);
  }
}
