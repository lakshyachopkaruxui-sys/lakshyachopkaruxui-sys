import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { damp, lerp, smoothstep } from '../utils/math';
import type { AudioEngine } from './AudioEngine';
import { birdsBuffer, bubblesBuffer, chimesBuffer, currentBuffer, droneBuffer, insectsBuffer, loopTrim, streamBuffer, underwaterBuffer, uneaseBuffer, windBuffer } from './synth';

export interface SoundscapeWorld {
  /** Audio and soundSpots share this world's movable local coordinate frame. */
  root: THREE.Object3D;
  soundSpots: Record<string, THREE.Vector3>;
}

interface ClipSpec {
  /** Recorded file (CC0). Falls back to the synthesized voice if it fails. */
  file?: string;
  synth: 'insects' | 'wind' | 'birds' | 'stream' | 'drone' | 'chimes' | 'unease' | 'water' | 'bubbles' | 'current';
  spot: string;
  gain: number;
  ref: number;
  near?: boolean;
  seconds?: number;
  /** Artistic acoustic ceiling: retained after crossing into the world. */
  maxCutoff?: number;
}

/** Recorded ambience: BigSoundBank, CC0 (public domain). */
export const WORLD_TWO_SOUNDS: ClipSpec[] = [
  { synth: 'insects', spot: 'insectsNear', gain: 0.8, ref: 0.25, near: true },
  { synth: 'wind', spot: 'canopyLeft', gain: 0.55, ref: 3.5 },
  { file: '/audio/forest-birds.mp3', synth: 'birds', spot: 'canopyLeft', gain: 0.85, ref: 3, seconds: 50 },
  { file: '/audio/countryside.mp3', synth: 'birds', spot: 'canopyRight', gain: 0.7, ref: 4, seconds: 55 },
  { file: '/audio/forest-stream.mp3', synth: 'stream', spot: 'stream', gain: 0.9, ref: 1.5, seconds: 45 }
];

export const WORLD_THREE_SOUNDS: ClipSpec[] = [
  // Violet is the fourth world in the journey; its original export name stays
  // stable. Sound implies a presence without speech, alarms or jump stings.
  { synth: 'drone', spot: 'drone', gain: 0.4, ref: 12, maxCutoff: 1200 },
  { synth: 'chimes', spot: 'chimes', gain: 0.32, ref: 9, maxCutoff: 2400 },
  { synth: 'unease', spot: 'near', gain: 0.45, ref: 1.8, near: true, maxCutoff: 2300 }
];

/**
 * Underwater ambience. The deep water bed is a recorded deep-ocean hydrophone
 * clip (MBARI, CC BY 4.0 — see ASSETS.md); bubbles and current stay synthesized.
 * The whale's own voice is not here: it is WhaleVoice, attached to the moving
 * whale model so its call always sounds where the whale actually is.
 */
export const UNDERWATER_SOUNDS: ClipSpec[] = [
  { file: '/audio/deep-ocean.wav', synth: 'water', spot: 'water', gain: 0.62, ref: 12, maxCutoff: 850, seconds: 50 },
  { synth: 'bubbles', spot: 'bubbles', gain: 0.28, ref: 4, maxCutoff: 1450 },
  { synth: 'current', spot: 'near', gain: 0.3, ref: 1.8, near: true, maxCutoff: 700 }
];

interface Source {
  audio: THREE.PositionalAudio;
  filter: BiquadFilterNode;
  baseGain: number;
  near: boolean;
  maxCutoff: number;
  volume: number;
}

/**
 * A world's sounds, positioned inside that world.
 * While the world is BEHIND a tear, the membrane occludes it: a closed seam
 * lets through only a faint muffled trickle, and opening it raises both volume
 * and filter cutoff. Once inside, it plays at its intended acoustic character;
 * the underwater sources keep their low-pass ceiling.
 */
export class Soundscape {
  private sources: Source[] = [];
  private leak = 0;
  started = false;
  loadedRecordings = 0;

  constructor(private engine: AudioEngine, private world: SoundscapeWorld, private clips: ClipSpec[]) {}

  start() {
    if (this.started || this.engine.state !== 'running') return;
    this.started = true;
    for (const clip of this.clips) {
      const spot = this.world.soundSpots[clip.spot];
      if (!spot) continue;
      if (!clip.file) {
        this.add(this.synthesize(clip.synth, spot), spot, clip);
        continue;
      }
      this.loadClip(clip.file, clip.seconds ?? 45)
        .then((buffer) => {
          this.add(buffer, spot, clip);
          this.loadedRecordings++;
        })
        .catch((err) => {
          console.warn(`Recording ${clip.file} unavailable — using synthesized fallback`, err);
          this.add(this.synthesize(clip.synth, spot), spot, clip);
        });
    }
  }

  private synthesize(kind: ClipSpec['synth'], spot: THREE.Vector3) {
    const ctx = this.engine.ctx;
    switch (kind) {
      case 'insects': return insectsBuffer(ctx);
      case 'wind': return windBuffer(ctx);
      case 'stream': return streamBuffer(ctx);
      case 'drone': return droneBuffer(ctx);
      case 'chimes': return chimesBuffer(ctx);
      case 'unease': return uneaseBuffer(ctx);
      case 'water': return underwaterBuffer(ctx);
      case 'bubbles': return bubblesBuffer(ctx);
      case 'current': return currentBuffer(ctx);
      default: return birdsBuffer(ctx, Math.abs(spot.z | 0) + 1);
    }
  }

  private async loadClip(url: string, seconds: number) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const decoded = await this.engine.ctx.decodeAudioData(await res.arrayBuffer());
    return loopTrim(this.engine.ctx, decoded, seconds);
  }

  private add(buffer: AudioBuffer, at: THREE.Vector3, clip: ClipSpec) {
    const near = !!clip.near;
    const maxCutoff = Math.min(clip.maxCutoff ?? CONFIG.audio.leakOpenCutoff, this.engine.ctx.sampleRate * 0.45);
    const audio = new THREE.PositionalAudio(this.engine.listener);
    audio.setBuffer(buffer);
    audio.setLoop(true);
    audio.setRefDistance(clip.ref);
    audio.setRolloffFactor(near ? 3 : 1);
    audio.setDistanceModel('inverse');
    const filter = this.engine.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(CONFIG.audio.leakClosedCutoff, maxCutoff);
    filter.Q.value = 0.5;
    audio.setFilters([filter]);
    audio.setVolume(0);
    audio.position.copy(at);
    this.world.root.add(audio);
    audio.offset = Math.random() * buffer.duration;
    audio.play();
    this.sources.push({ audio, filter, baseGain: clip.gain, near, maxCutoff, volume: 0 });
  }

  /** @param inside true when the listener is standing in this world, not peering into it */
  update(dt: number, openness: number, crackOpenness: number, lean: number, inside: boolean) {
    if (!this.started) return;
    const A = CONFIG.audio;
    const target = inside ? 1 : Math.max(openness, crackOpenness * 0.2);
    this.leak = damp(this.leak, target, 5, dt);
    const cutoff = lerp(A.leakClosedCutoff, A.leakOpenCutoff, Math.pow(this.leak, 0.6));
    const volume = lerp(A.leakClosedGain, 1, Math.pow(this.leak, 0.7));
    const t = this.engine.ctx.currentTime;
    for (const s of this.sources) {
      const localCutoff = s.near ? Math.max(cutoff, 1200 + lean * 8000) : cutoff;
      s.filter.frequency.setTargetAtTime(Math.min(localCutoff, s.maxCutoff), t, 0.05);
      const nearGain = s.near ? (inside ? 0.5 : smoothstep(0, 1, lean) * (0.3 + 0.7 * Math.max(this.leak, 0.25))) : 1;
      s.volume = s.baseGain * volume * nearGain;
      s.audio.setVolume(s.volume);
    }
  }

  /** Fade right down (used when a world is neither inside nor visible). */
  mute(dt: number) {
    this.leak = damp(this.leak, 0, 3, dt);
    for (const s of this.sources) {
      // Fade the actual previous gain; a fixed multiplier would step abruptly
      // down on the first inactive frame. Finish at zero rather than leak forever.
      s.volume = damp(s.volume, 0, 8, dt);
      if (s.volume < 0.00001) s.volume = 0;
      s.audio.setVolume(s.volume);
    }
  }
}
