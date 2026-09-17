import { CONFIG } from '../config/config.js';

// Fires short haptic pulses on meaningful tear events (brief: "Use one
// brief pulse when the tear begins... stronger near breakthrough... sharp
// pulse when the world becomes exposed" — "do not overuse haptics").
//
// IMPORTANT, spec-verified: bare-hand WebXR tracking has NO vibration
// hardware at all — haptics only exist on the XRInputSource.gamepad of a
// physical controller (Gamepad.hapticActuators). Since this experience's
// primary and intended input is hand tracking (brief: "Controllers may
// exist only as fallback"), this system is a genuine no-op for the normal
// bare-hand flow and only does anything if the player is actually holding
// tracked controllers instead. That's not a bug — it's the honest limit of
// what the platform can do without a controller in hand.
export class HapticsSystem {
  constructor(renderer) {
    this.renderer = renderer;
    this._prevEngaged = { left: false, right: false };
    this._reachedNearBreakthrough = { left: false, right: false };
    this._reachedFullyOpen = { left: false, right: false };
  }

  _actuatorFor(handedness) {
    if (!CONFIG.haptics.enabled) return null;
    const session = this.renderer.xr.getSession && this.renderer.xr.getSession();
    if (!session) return null;
    for (const src of session.inputSources) {
      if (src.handedness === handedness && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators.length) {
        return src.gamepad.hapticActuators[0];
      }
    }
    return null;
  }

  _pulse(handedness, { intensity, durationMs }) {
    const actuator = this._actuatorFor(handedness);
    if (actuator && actuator.pulse) actuator.pulse(intensity, durationMs);
  }

  /** Called once per frame with the currently-active world's tear signal. */
  update(signal) {
    ['left', 'right'].forEach((hand) => {
      if (signal.engaged && !this._prevEngaged[hand]) {
        this._pulse(hand, CONFIG.haptics.tearBeginPulse);
      }
      if (signal.stage >= 4 && !this._reachedNearBreakthrough[hand]) {
        this._reachedNearBreakthrough[hand] = true;
        this._pulse(hand, CONFIG.haptics.nearBreakthroughPulse);
      }
      if (signal.openAmount >= 0.999 && !this._reachedFullyOpen[hand]) {
        this._reachedFullyOpen[hand] = true;
        this._pulse(hand, CONFIG.haptics.breakthroughPulse);
      }
      if (!signal.engaged) {
        this._reachedFullyOpen[hand] = false;
        this._reachedNearBreakthrough[hand] = false;
      }
      this._prevEngaged[hand] = signal.engaged;
    });
  }
}
