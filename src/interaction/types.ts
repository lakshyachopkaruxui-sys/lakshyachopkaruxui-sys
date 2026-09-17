import type * as THREE from 'three';

export type Handedness = 'left' | 'right';

/** One frame of raw data from whichever hand source is active (XR or desktop). */
export interface RawHandSample {
  tracked: boolean;
  thumbTip: THREE.Vector3;
  indexTip: THREE.Vector3;
  /** All available joint world positions, for the hand visual / debug. */
  joints: THREE.Vector3[];
  /** Live named XR joints only; omitted by desktop sources. Never infer anatomy
   * from `joints`, whose packed order can change when tracking loses a joint. */
  jointPositions?: Partial<Record<XRHandJoint, THREE.Vector3>>;
}

export interface HandSource {
  readonly kind: 'xr' | 'desktop';
  sample(hand: Handedness): RawHandSample;
}
