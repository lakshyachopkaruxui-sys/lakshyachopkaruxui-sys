import * as THREE from 'three';
import { assetUrl } from '../utils/assetUrl';
import { damp, lerp, mulberry32 } from '../utils/math';
import type { AudioEngine } from './AudioEngine';

export const HELL_MONSTER_CLIPS = [
  { file: assetUrl('/audio/hell/creature-growl.wav'), kind: 'creature', gain: .82, rate: [.79, .94] },
  { file: assetUrl('/audio/hell/creature-answer.wav'), kind: 'creature', gain: .74, rate: [.86, 1.02] },
  { file: assetUrl('/audio/hell/stone-grind.wav'), kind: 'stone', gain: .27, rate: [.67, .83] },
  { file: assetUrl('/audio/hell/creature-threat.wav'), kind: 'creature', gain: .78, rate: [.76, .91] },
  { file: assetUrl('/audio/hell/sky-screech.wav'), kind: 'sky', gain: .56, rate: [.70, .86] },
  { file: assetUrl('/audio/hell/sky-chitter.wav'), kind: 'sky', gain: .50, rate: [.78, .96] }
] as const;
const CREATURE_CLIP_INDICES = [0, 1, 3] as const;
const SKY_CLIP_INDICES = [4, 5] as const;

export interface HellAudioWorld {
  root: THREE.Object3D;
  fauna: { creatures: readonly { root: THREE.Object3D; height?: number }[] };
  /** Actual moving fliers, in world.root local coordinates. Fill existing vectors. */
  getSkyCreaturePositions?(out: THREE.Vector3[]): number;
}

interface Voice {
  audio: THREE.PositionalAudio;
  filter: BiquadFilterNode;
  startedAt: number;
  duration: number;
  gain: number;
  filterHz: number;
  skyIndex: number;
}

/** Sparse recorded voices on the existing environmental bus. No new listener,
 * reverb processor or continuous oscillator; at most two HRTF voices overlap. */
export class HellHorrorAudio {
  ready: Promise<void> = Promise.resolve();
  status: 'idle' | 'loading' | 'ready' | 'fallback' = 'idle';
  started = false;
  readonly failedFiles: string[] = [];
  readonly stats = { playing: 0, creatureCalls: 0, skyCalls: 0, stoneEvents: 0, decodedBytes: 0 };
  private voices: Voice[] = [];
  private buffers: (AudioBuffer | null)[] = [];
  private readonly random = mulberry32(81927);
  private leak = 0;
  private inside = false;
  private callClock = 0;
  private nextCall = 5.8;
  private stoneClock = 0;
  private nextStone = 12;
  private answerIn = -1;
  private actorIndex = -1;
  private lastClip = -1;
  private stoneIndex = 0;
  private skyClock = 0;
  private nextSky = 9;
  private skyIndex = -1;
  private lastSkyClip = -1;
  private skyCount = 0;
  private readonly skyPositions = Array.from({ length: 8 }, () => new THREE.Vector3());

  constructor(private engine: AudioEngine, private world: HellAudioWorld) {}

  start() {
    if (this.started || this.engine.state !== 'running') return;
    this.started = true;
    this.status = 'loading';
    for (let i = 0; i < 2; i++) {
      const audio = new THREE.PositionalAudio(this.engine.listener);
      audio.name = 'Pooled Strange World voice ' + i;
      audio.setLoop(false);
      audio.setRefDistance(9);
      audio.setRolloffFactor(1.15);
      audio.setDistanceModel('inverse');
      audio.setMaxDistance(48);
      audio.panner.panningModel = 'HRTF';
      const filter = this.engine.ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 1800; filter.Q.value = .45;
      audio.setFilters([filter]); audio.setVolume(0);
      this.world.root.add(audio);
      this.voices.push({ audio, filter, startedAt: 0, duration: 0, gain: 0, filterHz: 2800, skyIndex: -1 });
    }
    this.ready = Promise.all(HELL_MONSTER_CLIPS.map(async clip => {
      try {
        const response = await fetch(clip.file);
        if (!response.ok) throw new Error('Missing Hell recording');
        const decoded = await this.engine.ctx.decodeAudioData(await response.arrayBuffer());
        // decodeAudioData resamples to the host rate. Store compact 24 kHz mono
        // buffers again, including on 96 kHz desktop audio devices.
        if (!decoded.length || !Number.isFinite(decoded.duration) || decoded.duration > 8) throw new Error('Invalid Hell recording');
        const rate = 24000, count = Math.max(1, Math.round(decoded.duration * rate));
        const compact = this.engine.ctx.createBuffer(1, count, rate);
        const data = compact.getChannelData(0);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const source = decoded.getChannelData(channel);
          for (let i = 0; i < count; i++) {
            const at = i * decoded.sampleRate / rate, a = Math.min(source.length - 1, Math.floor(at));
            data[i] += lerp(source[a], source[Math.min(source.length - 1, a + 1)], at - a) / decoded.numberOfChannels;
          }
        }
        this.stats.decodedBytes += data.byteLength;
        return compact;
      } catch {
        this.failedFiles.push(clip.file);
        return null;
      }
    })).then(buffers => {
      this.buffers = buffers;
      this.status = this.failedFiles.length ? 'fallback' : 'ready';
    });
  }

  /** Outside-world preview does not start disembodied attacks. Existing ambience
   * supplies the portal leak; departing voices fade as the listener leaves. */
  update(dt: number, _openness: number, _crackOpenness: number, inside: boolean) {
    if (!this.started) return;
    if (this.engine.state !== 'running' || this.engine.ctx.state !== 'running' ||
        (typeof document !== 'undefined' && document.hidden)) {
      this.mute(0, true); return;
    }
    if (!inside) { this.mute(dt); return; }
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, .1);
    if (!this.inside) {
      this.callClock = this.stoneClock = this.skyClock = 0;
      this.nextCall = 5 + this.random() * 3;
      this.nextStone = 11 + this.random() * 5;
      this.nextSky = 9 + this.random() * 3;
      this.answerIn = -1;
    }
    this.inside = true;
    this.leak = damp(this.leak, 1, 5, dt);
    this.skyCount = Math.max(0, Math.min(this.skyPositions.length,
      Math.floor(this.world.getSkyCreaturePositions?.(this.skyPositions) || 0)));
    this.refreshVoices();
    this.callClock += dt; this.stoneClock += dt; this.skyClock += dt;
    if (this.answerIn >= 0) {
      this.answerIn -= dt;
      if (this.answerIn <= 0) {
        this.answerIn = -1;
        this.creatureCall(true);
      }
    }
    if (this.callClock >= this.nextCall) {
      this.callClock = 0; this.nextCall = 11 + this.random() * 10;
      if (this.creatureCall(false) && this.world.fauna.creatures.length > 1 && this.random() < .65) {
        this.answerIn = 3.4 + this.random() * 2.2;
      }
    }
    if (this.stoneClock >= this.nextStone) {
      this.stoneClock = 0; this.nextStone = 13 + this.random() * 12;
      this.stoneEvent();
    }
    if (this.skyCount && this.skyClock >= this.nextSky) {
      // A busy pool postpones the bird; it never steals a creature's voice.
      if (this.skyCall()) {
        this.skyClock = 0; this.nextSky = 10 + this.random() * 11;
      }
    }
  }

  /** Immediate silence is for intro/focus loss. Ordinary departure has a brief
   * smooth tail; all sources finish at zero and the next visit gets a new wait. */
  mute(dt: number, immediate = false) {
    this.inside = false; this.answerIn = -1;
    this.leak = immediate ? 0 : damp(this.leak, 0, 10, Math.max(0, Number.isFinite(dt) ? dt : 0));
    if (immediate || this.leak < .001) {
      this.leak = 0;
      for (const voice of this.voices) {
        if (voice.audio.isPlaying) voice.audio.stop();
        voice.audio.setVolume(0); voice.gain = 0; voice.skyIndex = -1;
      }
      this.stats.playing = 0;
    } else this.refreshVoices();
  }

  private refreshVoices() {
    const now = this.engine.ctx.currentTime;
    this.stats.playing = 0;
    for (const voice of this.voices) {
      if (!voice.audio.isPlaying) {
        if (voice.gain) { voice.audio.setVolume(0); voice.gain = 0; voice.skyIndex = -1; }
        continue;
      }
      if (voice.skyIndex >= 0 && voice.skyIndex < this.skyCount) {
        const at = this.skyPositions[voice.skyIndex];
        if (Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z)) voice.audio.position.copy(at);
      }
      const age = Math.max(0, now - voice.startedAt);
      if (age >= voice.duration) { voice.audio.stop(); voice.audio.setVolume(0); voice.gain = 0; continue; }
      const edge = Math.max(0, Math.min(1, age / .18, (voice.duration - age) / .32));
      const envelope = Math.sin(edge * Math.PI * .5) ** 2;
      voice.audio.setVolume(voice.gain * this.leak * envelope);
      voice.filter.frequency.setTargetAtTime(lerp(650, voice.filterHz, this.leak), now, .08);
      this.stats.playing++;
    }
  }

  private creatureCall(answer: boolean) {
    const actors = this.world.fauna.creatures;
    if (!actors.length) return false;
    this.actorIndex = (this.actorIndex + 1) % actors.length;
    let sequence = (this.lastClip + 1) % CREATURE_CLIP_INDICES.length;
    for (let attempt = 0; attempt < CREATURE_CLIP_INDICES.length; attempt++) {
      if (this.buffers[CREATURE_CLIP_INDICES[sequence]]) break;
      sequence = (sequence + 1) % CREATURE_CLIP_INDICES.length;
    }
    const index = CREATURE_CLIP_INDICES[sequence];
    const actor = actors[this.actorIndex];
    const mouthHeight = Math.max(.5, (actor.height ?? 2.25) * .88);
    if (!this.play(index, actor.root, 0, mouthHeight, 0, answer ? .80 : 1)) return false;
    this.lastClip = sequence; this.stats.creatureCalls++;
    return true;
  }

  private skyCall() {
    if (!this.skyCount) return false;
    const actorIndex = (this.skyIndex + 1) % this.skyCount;
    const at = this.skyPositions[actorIndex];
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || !Number.isFinite(at.z)) return false;
    let sequence = (this.lastSkyClip + 1) % SKY_CLIP_INDICES.length;
    if (!this.buffers[SKY_CLIP_INDICES[sequence]]) sequence = 1 - sequence;
    if (!this.play(SKY_CLIP_INDICES[sequence], this.world.root, at.x, at.y, at.z, 1, actorIndex)) return false;
    this.skyIndex = actorIndex; this.lastSkyClip = sequence; this.stats.skyCalls++;
    return true;
  }

  private stoneEvent() {
    const anchors = [[-13, .45, -15], [15, .4, -11], [4, .5, -29]];
    const at = anchors[this.stoneIndex++ % anchors.length];
    if (this.play(2, this.world.root, at[0], at[1], at[2], 1)) this.stats.stoneEvents++;
  }

  private play(index: number, parent: THREE.Object3D, x: number, y: number, z: number, scale: number, skyIndex = -1) {
    const buffer = this.buffers[index];
    const voice = this.voices.find(item => !item.audio.isPlaying);
    if (!buffer || !voice) return false;
    const spec = HELL_MONSTER_CLIPS[index];
    const rate = lerp(spec.rate[0], spec.rate[1], this.random());
    parent.add(voice.audio); voice.audio.position.set(x, y, z);
    voice.audio.setBuffer(buffer); voice.audio.setPlaybackRate(rate); voice.audio.setVolume(0);
    voice.startedAt = this.engine.ctx.currentTime; voice.duration = buffer.duration / rate;
    voice.gain = spec.gain * scale;
    voice.filterHz = spec.kind === 'sky' ? 6200 : spec.kind === 'stone' ? 1800 : 2800;
    voice.skyIndex = skyIndex;
    voice.audio.setRefDistance(spec.kind === 'sky' ? 11 : 9);
    voice.audio.play();
    this.stats.playing++;
    return true;
  }
}
