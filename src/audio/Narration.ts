import type { AudioEngine } from './AudioEngine';
import { NARRATION_SCRIPT, type NarrationCue, type NarrationCueId } from './narrationScript';

export type NarrationMode = 'audio' | 'captions';

export interface NarrationCaption {
  id: NarrationCueId;
  text: string;
  durationSeconds: number;
  mode: NarrationMode;
}

export interface NarrationOptions {
  /** Render this in the desktop UI AND inside the XR scene; null clears it. */
  onCaption: (caption: NarrationCaption | null) => void;
  onSpeakingChange?: (speaking: boolean) => void;
}

/**
 * Self-hosted prerecorded narration with phrase-timed captions.
 * AudioContext.unlock() must run in the entry/replay button gesture.
 * The voice is locally synthesized. Unavailable audio keeps captions; an
 * arbitrary device voice must never replace the requested narrator.
 */
export class Narration {
  private readonly buffers = new Map<NarrationCueId, AudioBuffer>();
  private readonly loads = new Map<NarrationCueId, Promise<AudioBuffer | null>>();
  private readonly played = new Set<NarrationCueId>();
  private readonly gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private requests = new Set<AbortController>();
  private revision = 0;
  private activeCue: NarrationCue | null = null;
  private speaking = false;
  private disposed = false;
  private _enabled = true;
  private audioOrigin: number | null = null;
  private captionPosition = 0;
  private audioFocus: BroadcastChannel | null = null;
  private readonly focusOwner = Math.random().toString(36).slice(2);
  private focusClaim: { at: number; owner: string } | null = null;

  constructor(
    private readonly engine: Pick<AudioEngine, 'ctx' | 'setNarrationDucking'>,
    private readonly options: NarrationOptions,
    private readonly script: Readonly<Record<NarrationCueId, NarrationCue>> = NARRATION_SCRIPT
  ) {
    this.gain = engine.ctx.createGain();
    this.gain.gain.value = 0.9;
    // Bypass the environmental listener gain so ducking cannot mute narration.
    this.gain.connect(engine.ctx.destination);
    // Multiple Tear tabs must not speak over one another. The most recent
    // explicit playback owns narration, including work still waiting to decode.
    if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
      try {
        this.audioFocus = new window.BroadcastChannel('tear:narration');
        this.audioFocus.onmessage = event => {
          const incoming = event.data;
          const own = this.focusClaim;
          if (incoming?.type !== 'claim' || !Number.isFinite(incoming.at) || typeof incoming.owner !== 'string' || !own) return;
          // Ignore older messages delivered after a newer local request. Ties
          // resolve consistently so simultaneous tabs cannot silence both takes.
          if (incoming.at > own.at || (incoming.at === own.at && incoming.owner > own.owner)) this.stop();
        };
      } catch { /* Restricted hosts retain normal single-tab narration. */ }
    }
  }

  get enabled() { return this._enabled; }

  /** Preload without playing or resuming audio. Safe before user activation. */
  async prepare() {
    if (this.disposed) return;
    await Promise.all(Object.values(this.script).map(cue => this.load(cue)));
  }

  /** Call after a new Desktop/XR entry. A replay button may bypass once-per-session. */
  startSession() {
    this.stop();
    this.played.clear();
  }

  /** Disabling voice keeps the same text captions, including the current line. */
  setEnabled(enabled: boolean) {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    if (!enabled) {
      this.focusClaim = null;
      const elapsed = this.audioOrigin !== null ? this.engine.ctx.currentTime - this.audioOrigin : this.captionPosition;
      const offset = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
      // Invalidate loading/queued voice work even if the user quickly switches
      // voice back on before decoding completes. Only a new cue or replay speaks.
      this.revision++;
      this.clearTimers();
      this.stopVoice();
      if (this.activeCue) {
        const revision = this.revision;
        this.timeline(this.activeCue, 'captions', revision, offset);
        this.later(() => this.finish(revision), Math.max(0, this.activeCue.durationSeconds - offset) * 1000);
      }
    }
  }

  /** Returns false if the cue already played this session or the owner disposed. */
  play(id: NarrationCueId, replay = false) {
    if (this.disposed || (!replay && this.played.has(id))) return false;
    this.stop();
    this.played.add(id);
    const cue = this.script[id];
    this.activeCue = cue;
    if (this._enabled && cue.file && this.engine.ctx.state === 'running') {
      this.focusClaim = { at: Date.now(), owner: this.focusOwner };
      this.audioFocus?.postMessage({ type: 'claim', ...this.focusClaim });
    }
    const revision = this.revision;
    this.timeline(cue, 'captions', revision);
    // Bounded caption lifetime even if a host API never resolves or fires events.
    this.later(() => this.finish(revision), cue.durationSeconds * 1000);
    if (!this._enabled) return true;
    const buffer = this.buffers.get(id);
    if (buffer && this.engine.ctx.state === 'running') {
      this.playBuffer(cue, buffer, revision);
    } else if (cue.file && this.engine.ctx.state === 'running') {
      void this.load(cue).then(loaded => {
        if (!this.current(revision) || !this._enabled) return;
        if (loaded) this.playBuffer(cue, loaded, revision);
        // A failed load leaves the existing caption-only timeline running.
      });
    }
    return true;
  }

  /** Stops current words and captions; prevents late decode/end events restarting. */
  stop() {
    this.revision++;
    this.clearTimers();
    this.stopVoice();
    this.activeCue = null;
    this.focusClaim = null;
    this.captionPosition = 0;
    this.options.onCaption(null);
  }

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.gain.disconnect();
    this.audioFocus?.close();
    this.audioFocus = null;
  }

  private async load(cue: NarrationCue): Promise<AudioBuffer | null> {
    if (!cue.file || this.disposed) return null;
    if (this.buffers.has(cue.id)) return this.buffers.get(cue.id)!;
    if (this.loads.has(cue.id)) return this.loads.get(cue.id)!;
    const request = new AbortController();
    this.requests.add(request);
    // A public host may queue audio behind large environment downloads.
    // Caption lifetime remains bounded independently; do not cancel voice loads
    // at the four-second arrival pause before they have reached the network.
    const timeout = setTimeout(() => request.abort(), 30000);
    const promise = (async () => {
      try {
        const response = await fetch(cue.file!, { signal: request.signal });
        if (!response.ok) throw new Error(`Narration HTTP ${response.status}`);
        const buffer = await this.engine.ctx.decodeAudioData(await response.arrayBuffer());
        if (this.disposed) return null;
        this.buffers.set(cue.id, buffer);
        return buffer;
      } catch {
        // No blocking error panel: caption playback remains available.
        return null;
      } finally {
        clearTimeout(timeout);
        this.requests.delete(request);
        this.loads.delete(cue.id);
      }
    })();
    this.loads.set(cue.id, promise);
    return promise;
  }

  private playBuffer(cue: NarrationCue, buffer: AudioBuffer, revision: number) {
    if (!this.current(revision) || !this._enabled) return;
    try {
      const source = this.engine.ctx.createBufferSource();
      this.source = source;
      source.buffer = buffer;
      source.connect(this.gain);
      source.onended = () => {
        if (!this.current(revision) || this.source !== source) return;
        this.source = null;
        source.disconnect();
        this.setSpeaking(false);
      };
      source.start();
      this.clearTimers();
      this.audioOrigin = Number.isFinite(this.engine.ctx.currentTime) ? this.engine.ctx.currentTime : null;
      this.timeline(cue, 'audio', revision);
      const length = Math.max(cue.durationSeconds, buffer.duration + 0.4);
      const origin = this.audioOrigin;
      const finishOnClock = () => {
        if (!this.current(revision)) return;
        const remaining = origin !== null ? length - (this.engine.ctx.currentTime - origin) : 0;
        if (remaining > .015) this.later(finishOnClock, this.engine.ctx.state === 'running' ? remaining * 1000 : 250);
        else this.finish(revision);
      };
      this.later(finishOnClock, length * 1000);
    } catch {
      this.stopVoice();
      this.timeline(cue, 'captions', revision);
    }
  }

  private caption(cue: NarrationCue, mode: NarrationMode) {
    this.options.onCaption({ id: cue.id, text: cue.text, durationSeconds: cue.durationSeconds, mode });
  }

  /** Phrase boundaries share the AudioBuffer clock; no per-frame caption work. */
  private timeline(cue: NarrationCue, mode: NarrationMode, revision: number, offset = 0) {
    this.captionPosition = offset;
    if (!cue.segments?.length) {
      if (mode === 'audio') this.setSpeaking(true);
      this.caption(cue, mode);
      return;
    }
    this.options.onCaption(null);
    const origin = mode === 'audio' ? this.audioOrigin : null;
    const at = (position: number, callback: () => void) => {
      const invoke = () => {
        if (!this.current(revision)) return;
        const remaining = origin !== null ? position - (this.engine.ctx.currentTime - origin) : 0;
        if (remaining > .015) { this.later(invoke, this.engine.ctx.state === 'running' ? Math.max(20, remaining * 1000) : 250); return; }
        this.captionPosition = position;
        callback();
      };
      if (position <= offset) invoke();
      else this.later(invoke, (position - offset) * 1000);
    };
    for (const segment of cue.segments) {
      if (segment.end <= offset) continue;
      at(Math.max(offset, segment.start), () => {
        if (mode === 'audio') this.setSpeaking(true);
        this.options.onCaption({ id: cue.id, text: segment.text, durationSeconds: segment.end - Math.max(offset, segment.start), mode });
      });
      at(segment.end, () => { this.options.onCaption(null); this.setSpeaking(false); });
    }
  }

  private stopVoice() {
    this.audioOrigin = null;
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* Already ended. */ }
      this.source.disconnect();
      this.source = null;
    }
    this.setSpeaking(false);
  }

  private setSpeaking(speaking: boolean) {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.engine.setNarrationDucking(speaking);
    this.options.onSpeakingChange?.(speaking);
  }

  private current(revision: number) { return !this.disposed && revision === this.revision; }

  private finish(revision: number) { if (this.current(revision)) this.stop(); }

  private later(callback: () => void, milliseconds: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, milliseconds);
    this.timers.add(timer);
  }

  private clearTimers() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
