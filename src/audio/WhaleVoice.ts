import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { damp, lerp, mulberry32 } from '../utils/math';
import type { AudioEngine } from './AudioEngine';
import { whaleBuffer } from './synth';

interface Call {
  file: string;
  gain: number;
  rateRange: [number, number];
}

/** Recorded humpback calls: NPS, Glacier Bay hydrophone (public domain). See ASSETS.md. */
const CALLS: Call[] = [
  { file: '/audio/whale-moan-1.wav', gain: 1, rateRange: [0.96, 1.04] },
  { file: '/audio/whale-moan-2.wav', gain: 1, rateRange: [0.96, 1.04] },
  { file: '/audio/whale-whup.wav', gain: 1.15, rateRange: [0.97, 1.03] },
  { file: '/audio/whale-feeding.wav', gain: 0.8, rateRange: [0.98, 1.02] }
];

/**
 * The whale's own voice, attached directly to its (moving) model group so the
 * call always sounds where the whale actually is. Calls are infrequent and
 * irregular: a silent whale most of the time, punctuated by one real recorded
 * call every 10-15s, never the same clip twice in a row.
 */
export class WhaleVoice {
  private audio?: THREE.PositionalAudio;
  private filter?: BiquadFilterNode;
  private buffers: AudioBuffer[] = [];
  private rng = mulberry32(9001);
  private sinceCall = 0;
  private nextCall = 3 + this.rng() * 4;
  private lastIndex = -1;
  private wasPlaying = false;
  private leak = 0;
  started = false;

  constructor(private engine: AudioEngine, private group: THREE.Group) {}

  start() {
    if (this.started || this.engine.state !== 'running') return;
    this.started = true;
    const ctx = this.engine.ctx;
    this.audio = new THREE.PositionalAudio(this.engine.listener);
    this.audio.setRefDistance(12);
    this.audio.setRolloffFactor(1.1);
    this.audio.setDistanceModel('inverse');
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = CONFIG.audio.leakClosedCutoff;
    this.filter.Q.value = 0.5;
    this.audio.setFilters([this.filter]);
    this.audio.setVolume(0);
    this.group.add(this.audio);

    Promise.all(
      CALLS.map(async (call) => {
        try {
          const res = await fetch(call.file);
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return await ctx.decodeAudioData(await res.arrayBuffer());
        } catch (err) {
          console.warn(`Whale call ${call.file} unavailable — using synthesized fallback`, err);
          return whaleBuffer(ctx);
        }
      })
    ).then((buffers) => { this.buffers = buffers; });
  }

  /** @param inside true when the listener is standing in the underwater world, not peering into it */
  update(dt: number, openness: number, crackOpenness: number, inside: boolean) {
    if (!this.started || !this.audio || !this.filter) return;
    const A = CONFIG.audio;
    const target = inside ? 1 : Math.max(openness, crackOpenness * 0.2);
    this.leak = damp(this.leak, target, 5, dt);
    const t = this.engine.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(lerp(A.leakClosedCutoff, Math.min(1050, A.leakOpenCutoff), Math.pow(this.leak, 0.6)), t, 0.05);
    const volume = 0.23 * lerp(A.leakClosedGain, 1, Math.pow(this.leak, 0.7));

    if (!this.buffers.length) return;
    const isPlaying = this.audio.isPlaying;
    // The 10-15s gap is counted from when a call ENDS, not when it started.
    if (this.wasPlaying && !isPlaying) { this.sinceCall = 0; this.nextCall = 10 + this.rng() * 5; }
    this.wasPlaying = isPlaying;
    if (isPlaying) { this.audio.setVolume(this.playingGain * volume); return; }
    this.sinceCall += dt;
    if (this.sinceCall >= this.nextCall) this.playCall(volume);
  }

  /** Fade right down (world neither inside nor visible). */
  mute(dt: number) {
    this.leak = damp(this.leak, 0, 3, dt);
    if (this.audio) this.audio.setVolume(damp(this.audio.getVolume(), 0, 8, dt));
  }

  private playingGain = 1;

  private playCall(envelope: number) {
    let index = Math.floor(this.rng() * this.buffers.length);
    if (index === this.lastIndex) index = (index + 1) % this.buffers.length;
    this.lastIndex = index;
    const call = CALLS[index];
    this.playingGain = call.gain;
    this.audio!.setBuffer(this.buffers[index]);
    this.audio!.setPlaybackRate(lerp(call.rateRange[0], call.rateRange[1], this.rng()));
    this.audio!.setVolume(call.gain * envelope);
    this.audio!.play();
  }
}
