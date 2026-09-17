export enum InteractionState {
  Idle = 'idle',
  OneHand = 'one-hand-detected',
  TwoHands = 'two-hands-detected',
  Pinching = 'pinching',
  Pulling = 'pulling',
  Holding = 'holding',
  Releasing = 'releasing',
  Healing = 'healing',
  FullyOpen = 'fully-open',
  WorldTransition = 'world-transition',
  WorldDiscovered = 'world-discovered'
}

export interface InteractionInputs {
  handsTracked: number;       // 0, 1 or 2
  anyPinching: boolean;
  gripsEngaged: number;       // grips holding the membrane (0..2)
  energy: number;             // 0..1 from hand velocity / acceleration
  isOpen: boolean;            // any visible gap or fresh crack
  fullyOpen: boolean;
  releaseSuspended: boolean;  // in the short pause right after letting go
  transitioning: boolean;
  discovered: boolean;
}

/**
 * The single source of truth for "what is the user doing right now".
 * Priority order is explicit; Pulling/Holding use hysteresis on energy
 * so the state doesn't flicker.
 */
export class InteractionStateMachine {
  state = InteractionState.Idle;
  previous = InteractionState.Idle;
  timeInState = 0;
  private listeners: ((s: InteractionState, prev: InteractionState) => void)[] = [];

  onChange(fn: (s: InteractionState, prev: InteractionState) => void) {
    this.listeners.push(fn);
  }

  update(i: InteractionInputs, dt: number) {
    const next = this.resolve(i);
    if (next !== this.state) {
      this.previous = this.state;
      this.state = next;
      this.timeInState = 0;
      for (const fn of this.listeners) fn(next, this.previous);
    } else {
      this.timeInState += dt;
    }
  }

  private resolve(i: InteractionInputs): InteractionState {
    if (i.transitioning) return InteractionState.WorldTransition;
    if (i.discovered) return InteractionState.WorldDiscovered;
    if (i.gripsEngaged === 2) {
      if (i.fullyOpen) return InteractionState.FullyOpen;
      const pullingNow = this.state === InteractionState.Pulling ? i.energy > 0.18 : i.energy > 0.35;
      return pullingNow ? InteractionState.Pulling : InteractionState.Holding;
    }
    if (i.isOpen && i.releaseSuspended) return InteractionState.Releasing;
    if (i.isOpen) return i.gripsEngaged === 1 ? InteractionState.Holding : InteractionState.Healing;
    if (i.anyPinching) return InteractionState.Pinching;
    if (i.handsTracked === 2) return InteractionState.TwoHands;
    if (i.handsTracked === 1) return InteractionState.OneHand;
    return InteractionState.Idle;
  }
}
