import { CONFIG } from '../config/config.js';

// Developer-only debug HUD (brief: "Keep debug UI hidden by default. Make
// it easy to enable during development."). Toggled with F2 by default.
// Not rendered inside the XR headset (DOM overlay only) — it's a desktop
// development aid, not part of the delivered experience.
export class DebugOverlay {
  constructor() {
    this.enabled = CONFIG.debug.defaultEnabled;

    this.el = document.createElement('pre');
    this.el.id = 'debug-overlay';
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '10px',
      left: '10px',
      margin: '0',
      padding: '10px 12px',
      background: 'rgba(0,0,0,0.6)',
      color: '#9dffb8',
      font: '11px/1.5 monospace',
      whiteSpace: 'pre',
      zIndex: '100',
      pointerEvents: 'none',
      display: this.enabled ? 'block' : 'none'
    });
    document.body.appendChild(this.el);

    this._frameTimes = [];

    window.addEventListener('keydown', (e) => {
      if (e.code === CONFIG.debug.keyToggle) {
        this.enabled = !this.enabled;
        this.el.style.display = this.enabled ? 'block' : 'none';
      }
    });
  }

  update(dt, { interactionState, worldManager, xr, activeHandSourceName }) {
    if (!this.enabled) return;

    this._frameTimes.push(dt);
    if (this._frameTimes.length > 30) this._frameTimes.shift();
    const avgDt = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
    const fps = avgDt > 0 ? Math.round(1 / avgDt) : 0;

    const currentWorld = worldManager.current;
    const controller =
      currentWorld === 'one' ? worldManager.worldOne.tearController
      : currentWorld === 'two' ? worldManager.worldTwo?.tearController
      : worldManager.worldThree?.tearController;
    const sig = controller?.signal;

    const lines = [
      `FPS: ${fps}`,
      `XR presenting: ${xr.isPresenting} (hand source: ${activeHandSourceName})`,
      `Interaction state: ${interactionState.current}`,
      `Current world: ${currentWorld}`,
      sig ? `openAmount: ${sig.openAmount.toFixed(3)}  stage: ${sig.stage}  energy: ${sig.energy.toFixed(2)}  stress: ${sig.stress.toFixed(2)}` : '',
      sig ? `engaged: ${sig.engaged}  gapLocal: ${sig.gapLocal.toFixed(3)}  dirAngle: ${sig.directionAngle.toFixed(2)}` : '',
      `worlds loaded: one, ${worldManager.worldTwo ? 'two' : '-'}, ${worldManager.worldThree ? 'three' : '-'}, ${worldManager.worldOneEcho ? 'echo' : '-'}`,
      `[F2] toggle debug`
    ];
    this.el.textContent = lines.filter(Boolean).join('\n');
  }
}
