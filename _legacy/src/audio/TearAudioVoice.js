import * as THREE from 'three';
import { createFilteredNoiseVoice, playNoiseBurst } from '../utils/audioSynthesis.js';
import { damp, lerp } from '../utils/math.js';

// The sound of ONE veil: continuous paper-tension texture + world-leak
// "whoosh" (audio priority #1 and #2 per brief), plus one-shot stingers on
// meaningful state edges (tear begins, near-breakthrough, breakthrough,
// release). Everything is positioned at the veil via a single
// THREE.PositionalAudio so it's naturally spatial — closer/leaning in
// reads as louder and more detailed, per the brief's head-lean section.
export class TearAudioVoice {
  constructor(listener, veilAnchor, audioContext, noiseBuffer) {
    this.ctx = audioContext;
    this.noiseBuffer = noiseBuffer;

    this.positional = new THREE.PositionalAudio(listener);
    this.positional.setRefDistance(1.0);
    this.positional.setRolloffFactor(2.2);
    this.positional.setDistanceModel('exponential');
    veilAnchor.add(this.positional);

    this._mix = audioContext.createGain();
    this._mix.gain.value = 1;
    this.positional.setNodeSource(this._mix);

    this.stretch = createFilteredNoiseVoice(audioContext, noiseBuffer, { type: 'bandpass', frequency: 450, Q: 1.3 });
    this.stretch.output.connect(this._mix);

    this.leak = createFilteredNoiseVoice(audioContext, noiseBuffer, { type: 'lowpass', frequency: 200, Q: 0.5 });
    this.leak.output.connect(this._mix);

    this._prevEngaged = false;
    this._prevStage = 0;
    this._reachedFullyOpen = false;
  }

  update(dt, signal) {
    const stretchGain = signal.stress * 0.3;
    this.stretch.gain.gain.value = damp(this.stretch.gain.gain.value, stretchGain, 10, dt);
    this.stretch.filter.frequency.value = damp(this.stretch.filter.frequency.value, lerp(300, 1500, signal.stress), 8, dt);

    const leakStrength = THREE.MathUtils.smoothstep(signal.openAmount, 0.02, 0.5);
    this.leak.gain.gain.value = damp(this.leak.gain.gain.value, leakStrength * 0.28, 6, dt);
    this.leak.filter.frequency.value = damp(this.leak.filter.frequency.value, lerp(180, 2600, signal.openAmount), 5, dt);

    if (signal.engaged && !this._prevEngaged) {
      playNoiseBurst(this.ctx, this.noiseBuffer, this._mix, { duration: 0.1, frequency: 900, Q: 2, peakGain: 0.22 });
    }
    if (!signal.engaged && this._prevEngaged) {
      playNoiseBurst(this.ctx, this.noiseBuffer, this._mix, { duration: 0.35, frequency: 260, Q: 0.8, peakGain: 0.16 });
      this._reachedFullyOpen = false;
    }
    if (signal.stage >= 4 && this._prevStage < 4) {
      playNoiseBurst(this.ctx, this.noiseBuffer, this._mix, { duration: 0.22, frequency: 1400, Q: 2.5, peakGain: 0.3 });
    }
    if (signal.openAmount >= 0.999 && !this._reachedFullyOpen) {
      this._reachedFullyOpen = true;
      playNoiseBurst(this.ctx, this.noiseBuffer, this._mix, { duration: 0.4, frequency: 2200, Q: 3, peakGain: 0.45, type: 'highpass' });
    }

    this._prevEngaged = signal.engaged;
    this._prevStage = signal.stage;
  }
}
