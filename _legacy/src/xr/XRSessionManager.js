import { VRButton } from 'three/addons/webxr/VRButton.js';

// Wraps WebXR session lifecycle. Uses the official three.js VRButton addon
// rather than hand-rolling session-request logic, since it already handles
// feature detection, the "VR NOT SUPPORTED" fallback text, and the
// sessiongranted auto-resume flow correctly.
export class XRSessionManager {
  constructor(renderer, { onSessionStart, onSessionEnd } = {}) {
    this.renderer = renderer;
    this.onSessionStart = onSessionStart;
    this.onSessionEnd = onSessionEnd;
    this.isPresenting = false;
    this.handTrackingSupported = null; // unknown until a session actually starts

    renderer.xr.enabled = true;
    // 'local-floor' gives us a floor-relative origin (correct standing
    // height) instead of the device-relative 'local' default.
    renderer.xr.setReferenceSpaceType('local-floor');

    renderer.xr.addEventListener('sessionstart', () => {
      this.isPresenting = true;
      const session = renderer.xr.getSession();
      this.handTrackingSupported = !!(session && session.inputSources &&
        Array.from(session.inputSources).some((s) => s.hand));
      this.onSessionStart && this.onSessionStart(session);
    });

    renderer.xr.addEventListener('sessionend', () => {
      this.isPresenting = false;
      this.onSessionEnd && this.onSessionEnd();
    });
  }

  createButton() {
    return VRButton.createButton(this.renderer, {
      optionalFeatures: ['hand-tracking', 'local-floor', 'bounded-floor', 'layers']
    });
  }

  static async isImmersiveVRSupported() {
    if (!('xr' in navigator)) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  }
}
