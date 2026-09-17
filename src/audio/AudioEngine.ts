import * as THREE from 'three';
import { CONFIG } from '../config/config';

/**
 * Owns the single AudioListener (on the camera, so in XR it follows the real
 * head pose) and the unlock step browsers require before audio can play.
 */
export class AudioEngine {
  readonly listener: THREE.AudioListener;
  state: 'locked' | 'running' | 'failed' = 'locked';

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.listener.setMasterVolume(CONFIG.audio.master);
  }

  get ctx(): AudioContext {
    return this.listener.context;
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
