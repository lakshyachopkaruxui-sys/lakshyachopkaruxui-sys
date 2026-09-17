// Minimal keyboard state tracker for the desktop fallback controls.
export class KeyState {
  constructor() {
    this.pressed = new Set();
    this._onKeyDown = (e) => this.pressed.add(e.code);
    this._onKeyUp = (e) => this.pressed.delete(e.code);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  isDown(code) {
    return this.pressed.has(code);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
