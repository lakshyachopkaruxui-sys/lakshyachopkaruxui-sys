// Explicit interaction state model (per brief: avoid scattered booleans).
// TwoHandTearController is the only system allowed to call setState();
// everyone else just reads .current or subscribes to onChange.

export const States = Object.freeze({
  IDLE: 'idle',
  ONE_HAND: 'one-hand-detected',
  BOTH_HANDS: 'both-hands-detected',
  PINCHING: 'pinching',
  PULLING: 'pulling',
  HOLDING: 'holding',
  RELEASING: 'releasing',
  HEALING: 'healing',
  FULLY_OPEN: 'fully-open',
  TRANSITIONING: 'transitioning',
  WORLD_DISCOVERED: 'world-discovered'
});

export class InteractionState {
  constructor() {
    this.current = States.IDLE;
    this.previous = null;
    this.enteredAt = performance.now();
    this._listeners = new Set();
  }

  setState(next) {
    if (next === this.current) return;
    this.previous = this.current;
    this.current = next;
    this.enteredAt = performance.now();
    for (const fn of this._listeners) fn(next, this.previous);
  }

  timeInState() {
    return performance.now() - this.enteredAt;
  }

  is(...states) {
    return states.includes(this.current);
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}
