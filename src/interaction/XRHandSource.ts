import * as THREE from 'three';
import type { Handedness, HandSource, RawHandSample } from './types';

const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'
] as const;

type JointGroup = THREE.Group & { jointRadius?: number };
type HandGroup = THREE.Group & { joints: Record<string, JointGroup> };

/**
 * Reads real WebXR hand-tracking joints via three.js (renderer.xr.getHand).
 * Handedness comes from the XRInputSource on the 'connected' event, because
 * index 0/1 is not guaranteed to be left/right.
 */
export class XRHandSource implements HandSource {
  readonly kind = 'xr' as const;
  private hands: Partial<Record<Handedness, HandGroup>> = {};
  private samples: Record<Handedness, RawHandSample> = {
    left: makeSample(),
    right: makeSample()
  };
  private jointPositions = {
    left: makeJointPositions(),
    right: makeJointPositions()
  };

  constructor(renderer: THREE.WebGLRenderer, rig: THREE.Object3D) {
    for (let i = 0; i < 2; i++) {
      const hand = renderer.xr.getHand(i) as unknown as HandGroup;
      rig.add(hand);
      const events = hand as unknown as { addEventListener(type: string, fn: (e: { data?: XRInputSource }) => void): void };
      events.addEventListener('connected', (event) => {
        const source = event.data;
        if (source?.hand && (source.handedness === 'left' || source.handedness === 'right')) {
          this.hands[source.handedness] = hand;
        }
      });
      events.addEventListener('disconnected', () => {
        for (const side of ['left', 'right'] as Handedness[]) {
          if (this.hands[side] === hand) delete this.hands[side];
        }
      });
    }
  }

  sample(side: Handedness): RawHandSample {
    const s = this.samples[side];
    const hand = this.hands[side];
    s.tracked = false;
    // Missing and hidden joints must not retain last frame's anatomical pose.
    // Keep named storage separate from the compacted dots used by HandVisual.
    const named = s.jointPositions!;
    for (const name of JOINT_NAMES) delete named[name];
    // Three hides the hand group during a system overlay without clearing the
    // old joint visibility flags. Never treat those retained poses as live input.
    if (!hand || !hand.visible || !hand.joints) return s;
    const thumb = hand.joints['thumb-tip'];
    const index = hand.joints['index-finger-tip'];
    if (!thumb || !index || !thumb.visible || !index.visible) return s;
    thumb.getWorldPosition(s.thumbTip);
    index.getWorldPosition(s.indexTip);
    if (!isFiniteVec(s.thumbTip) || !isFiniteVec(s.indexTip)) return s;
    let n = 0;
    for (const name of JOINT_NAMES) {
      const j = hand.joints[name];
      if (!j || !j.visible) continue;
      const position = this.jointPositions[side][name];
      j.getWorldPosition(position);
      if (!isFiniteVec(position)) continue;
      named[name] = position;
      s.joints[n++].copy(position);
    }
    s.joints.length = JOINT_NAMES.length;
    for (let k = n; k < JOINT_NAMES.length; k++) s.joints[k].copy(s.indexTip);
    s.tracked = true;
    return s;
  }
}

function makeSample(): RawHandSample {
  return {
    tracked: false,
    thumbTip: new THREE.Vector3(),
    indexTip: new THREE.Vector3(),
    joints: Array.from({ length: JOINT_NAMES.length }, () => new THREE.Vector3()),
    jointPositions: {}
  };
}

function makeJointPositions(): Record<XRHandJoint, THREE.Vector3> {
  return Object.fromEntries(JOINT_NAMES.map(name => [name, new THREE.Vector3()])) as Record<XRHandJoint, THREE.Vector3>;
}

const isFiniteVec = (v: THREE.Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
