import * as THREE from 'three';
import { createFilteredNoiseVoice, createDroneVoice, playNoiseBurst } from '../utils/audioSynthesis.js';

// A world's ambient soundscape (audio priority #4, "environmental
// ambience"), positioned so it's only really present once the player has
// actually walked into that world — a small refDistance means it's
// near-silent from the "peek through the tear" distance and grows once
// close, distinct from the veil's own leak sound.
export class AmbienceVoice {
  constructor(listener, anchorObject3D, audioContext, noiseBuffer, { mode = 'wind', refDistance = 6 } = {}) {
    this.mode = mode;
    this.ctx = audioContext;
    this.noiseBuffer = noiseBuffer;

    this.positional = new THREE.PositionalAudio(listener);
    this.positional.setRefDistance(refDistance);
    this.positional.setRolloffFactor(1.4);
    this.positional.setDistanceModel('exponential');
    anchorObject3D.add(this.positional);

    if (mode === 'wind') {
      this.voice = createFilteredNoiseVoice(audioContext, noiseBuffer, { type: 'bandpass', frequency: 650, Q: 0.6 });
      this.voice.gain.gain.value = 0.16;
      this._chirpTimer = 1 + Math.random() * 3;
    } else {
      this.voice = createDroneVoice(audioContext, { baseFrequency: 68, detune: 5 });
      this.voice.gain.gain.value = 0.1;
    }
    this.positional.setNodeSource(this.voice.output);
  }

  update(dt) {
    if (this.mode !== 'wind') return;
    this._chirpTimer -= dt;
    if (this._chirpTimer <= 0) {
      this._chirpTimer = 2.5 + Math.random() * 5;
      playNoiseBurst(this.ctx, this.noiseBuffer, this.voice.output, {
        duration: 0.1,
        frequency: 1700 + Math.random() * 900,
        Q: 6,
        peakGain: 0.07,
        type: 'bandpass'
      });
    }
  }
}
