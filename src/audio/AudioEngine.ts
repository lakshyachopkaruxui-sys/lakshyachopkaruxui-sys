import * as THREE from 'three';
import { CONFIG } from '../config/config';

/**
 * Owns the single AudioListener (on the camera, so in XR it follows the real
 * head pose) and the unlock step browsers require before audio can play.
 */
export class AudioEngine {
  readonly listener: THREE.AudioListener;
  state: 'locked' | 'running' | 'failed' = 'locked';
  private active = true;
  private narrationDucked = false;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.listener.setMasterVolume(CONFIG.audio.master);
  }

  get ctx(): AudioContext {
    return this.listener.context;
  }

  /**
   * Gate the scene mix without suspending the shared context. Returning to the
   * entry page must stay silent even if a pending unlock or duck callback ends.
   * Narration owns a separate bus and must also be stopped by the session owner.
   */
  setActive(active: boolean) {
    this.active = active;
    this.applyMixGain();
  }

  /** Narration has its own bus; lower the environmental mix while words play. */
  setNarrationDucking(ducked: boolean) {
    this.narrationDucked = ducked;
    this.applyMixGain();
  }

  private applyMixGain() {
    const gain = this.listener.gain.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    if (!this.active) {
      // Immediate silence also removes a preceding scheduled recovery ramp.
      gain.setValueAtTime(0, now);
    } else {
      gain.setTargetAtTime(CONFIG.audio.master * (this.narrationDucked ? 0.28 : 1), now, 0.12);
    }
  }

  /** Must be called from a user gesture (the Enter VR / Desktop button). */
  async unlock() {
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.state = this.ctx.state === 'running' ? 'running' : 'failed';
    } catch (err) {
      console.warn('Audio could not start', err);
      this.state = 'failed';
    }
    return this.state === 'running';
  }
}
