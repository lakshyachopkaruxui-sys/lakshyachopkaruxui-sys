import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { clamp, damp } from '../utils/math';
import type { AudioEngine } from './AudioEngine';
import { crackleBuffer, noiseBuffer } from './synth';

/**
 * The sound of the membrane itself, positioned at the tear:
 *  - strain: a resonant creak that rises in pitch and level with strain
 *  - rip: crackle bursts whose size follows how violently it tore
 *  - healing: a soft closing hiss that fades as it seals
 */
export class TearVoice {
  private strain?: THREE.PositionalAudio;
  private strainFilter?: BiquadFilterNode;
  private heal?: THREE.PositionalAudio;
  private healFilter?: BiquadFilterNode;
  private rips: THREE.PositionalAudio[] = [];
  private ripBuffers: AudioBuffer[] = [];
  private nextRip = 0;
  private strainLevel = 0;
  private healLevel = 0;
  started = false;

  constructor(private engine: AudioEngine, private anchor: THREE.Object3D) {}

  start() {
    if (this.started || this.engine.state !== 'running') return;
    const ctx = this.engine.ctx;
    const noise = noiseBuffer(ctx, 3);

    [this.strain, this.strainFilter] = this.loop(noise, 'bandpass', 500, 7);
    [this.heal, this.healFilter] = this.loop(noise, 'lowpass', 900, 0.7);

    this.ripBuffers = [crackleBuffer(ctx, 0.35, 0.6), crackleBuffer(ctx, 0.6, 1.0), crackleBuffer(ctx, 1.1, 1.6)];
    for (let i = 0; i < 4; i++) {
      const a = new THREE.PositionalAudio(this.engine.listener);
      a.setRefDistance(0.6);
      this.anchor.add(a);
      this.rips.push(a);
    }
    this.started = true;
  }

  private loop(buffer: AudioBuffer, type: BiquadFilterType, freq: number, q: number): [THREE.PositionalAudio, BiquadFilterNode] {
    const a = new THREE.PositionalAudio(this.engine.listener);
    a.setBuffer(buffer);
    a.setLoop(true);
    a.setRefDistance(0.6);
    const f = this.engine.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    a.setFilters([f]);
    a.setVolume(0);
    this.anchor.add(a);
    a.play();
    return [a, f];
  }

  rip(strength: number, breakthrough = false) {
    if (!this.started) return;
    const a = this.rips[this.nextRip];
    this.nextRip = (this.nextRip + 1) % this.rips.length;
    const idx = breakthrough ? 2 : strength > 1 ? 1 : 0;
    if (a.isPlaying) a.stop();
    a.setBuffer(this.ripBuffers[idx]);
    a.setPlaybackRate(0.85 + Math.random() * 0.3);
    a.setVolume(CONFIG.audio.tearGain * clamp(0.35 + strength * 0.45, 0, 1.2));
    a.play();
  }

  update(dt: number, strain: number, energy: number, healing: boolean, openness: number) {
    if (!this.started || !this.strain || !this.heal) return;
    const t = this.engine.ctx.currentTime;
    const s = clamp(strain / 0.07, 0, 1);
    this.strainLevel = damp(this.strainLevel, s * (0.4 + energy * 0.6), 14, dt);
    this.strain.setVolume(CONFIG.audio.tearGain * this.strainLevel * 0.5);
    this.strainFilter!.frequency.setTargetAtTime(280 + s * 1400 + energy * 900, t, 0.03);

    this.healLevel = damp(this.healLevel, healing ? openness * 0.6 + 0.08 : 0, 3, dt);
    this.heal.setVolume(CONFIG.audio.tearGain * this.healLevel * 0.35);
    this.healFilter!.frequency.setTargetAtTime(300 + openness * 1500, t, 0.1);
  }
}
