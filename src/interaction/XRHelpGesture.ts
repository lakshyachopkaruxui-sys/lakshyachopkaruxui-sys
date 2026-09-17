import * as THREE from 'three';
import type { RawHandSample } from './types';

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const REQUIRED_JOINTS: XRHandJoint[] = [
  'wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...FINGERS.flatMap(finger => [
    `${finger}-finger-phalanx-proximal`, `${finger}-finger-phalanx-intermediate`,
    `${finger}-finger-phalanx-distal`, `${finger}-finger-tip`
  ] as XRHandJoint[])
];

/**
 * A deliberate, hands-only way to recall the field notes: hold both open palms
 * toward your face for 1.5 seconds, comfortably in front of your chest.
 *
 * This never reads pinch grace/filter history. Both complete live poses are
 * required, so a partially tracked hand cannot accidentally open instructions.
 * An emitted event stays latched until a live pose leaves the gesture.
 */
export class XRHelpGesture {
  private dwell = 0;
  private latched = false;
  private forward = new THREE.Vector3();
  private long = new THREE.Vector3();
  private across = new THREE.Vector3();
  private normal = new THREE.Vector3();
  private towardViewer = new THREE.Vector3();
  private palm = [new THREE.Vector3(), new THREE.Vector3()];
  private offset = new THREE.Vector3();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();

  reset() {
    this.dwell = 0;
    this.latched = false;
  }

  /** Focus/pose loss can happen without another frame. Cancel any partial
   * hold, retaining the release requirement for a gesture already emitted. */
  cancelHold() {
    this.dwell = 0;
  }

  /** `samples` is left then right. `forward` is the actual head direction. */
  update(
    samples: readonly RawHandSample[], viewer: THREE.Vector3, forward: THREE.Vector3,
    dt: number, enabled: boolean
  ): boolean {
    // Long gaps must start a fresh dwell; dt=0 only freezes an otherwise live
    // pose. Keep the latch during pauses/loss so held palms cannot retrigger.
    if (!enabled || !Number.isFinite(dt) || dt < 0 || dt > 0.15 ||
      !finite(viewer) || !finite(forward) || forward.lengthSq() < 1e-8 ||
      samples.length !== 2 || !this.livePose(samples[0]) || !this.livePose(samples[1])) {
      this.dwell = 0;
      return false;
    }
    this.forward.copy(forward).normalize();
    const open = this.openPalm(samples[0], 0, viewer) && this.openPalm(samples[1], 1, viewer);
    const separation = open ? this.palm[0].distanceTo(this.palm[1]) : 0;
    if (!open || separation < 0.12 || separation > 0.75) {
      this.dwell = 0;
      this.latched = false;
      return false;
    }
    if (this.latched || dt === 0) return false;
    this.dwell += dt;
    if (this.dwell < 1.5 - 1e-9) return false;
    this.dwell = 0;
    this.latched = true;
    return true;
  }

  private livePose(sample: RawHandSample | undefined): boolean {
    if (!sample?.tracked || !finite(sample.thumbTip) || !finite(sample.indexTip)) return false;
    const pose = sample.jointPositions;
    return !!pose && REQUIRED_JOINTS.every(name => finite(pose[name]));
  }

  private openPalm(sample: RawHandSample, side: number, viewer: THREE.Vector3): boolean {
    const pose = sample.jointPositions!;
    const wrist = pose.wrist!;
    const middle = pose['middle-finger-phalanx-proximal']!;
    const index = pose['index-finger-phalanx-proximal']!;
    const pinky = pose['pinky-finger-phalanx-proximal']!;
    const palm = this.palm[side].copy(wrist).add(middle).multiplyScalar(0.5);
    this.offset.subVectors(palm, viewer);
    const distance = this.offset.length();
    // A relaxed chest-height pose, visible without extending the arms. The
    // cone uses head orientation rather than the world's original -Z axis.
    if (distance < 0.22 || distance > 0.85 || palm.y < viewer.y - 0.8 || palm.y > viewer.y + 0.12 ||
      this.offset.dot(this.forward) < distance * 0.62) return false;
    const thumbTip = pose['thumb-tip']!;
    const indexTip = pose['index-finger-tip']!;
    if (sample.thumbTip.distanceTo(sample.indexTip) < 0.045 || thumbTip.distanceTo(indexTip) < 0.045) return false;

    this.long.subVectors(middle, wrist);
    this.across.subVectors(index, pinky);
    const palmLength = this.long.length();
    const palmWidth = this.across.length();
    if (palmLength < 0.035 || palmLength > 0.16 || palmWidth < 0.025 || palmWidth > 0.14) return false;
    this.long.normalize();
    this.normal.crossVectors(this.across, this.long);
    if (this.normal.lengthSq() < 1e-6) return false;
    // Radial-to-ulnar direction is reversed between left and right hands.
    this.normal.normalize().multiplyScalar(side === 0 ? 1 : -1);
    this.towardViewer.subVectors(viewer, palm).normalize();
    if (this.normal.dot(this.towardViewer) < 0.62) return false;

    for (const finger of FINGERS) {
      const base = pose[`${finger}-finger-phalanx-proximal`]!;
      const mid = pose[`${finger}-finger-phalanx-intermediate`]!;
      const distal = pose[`${finger}-finger-phalanx-distal`]!;
      const tip = pose[`${finger}-finger-tip`]!;
      if (!this.extended(base, mid, distal, tip)) return false;
      if (this.a.subVectors(tip, base).normalize().dot(this.long) < 0.45) return false;
    }
    return this.extended(pose['thumb-metacarpal']!, pose['thumb-phalanx-proximal']!,
      pose['thumb-phalanx-distal']!, thumbTip, true);
  }

  private extended(base: THREE.Vector3, mid: THREE.Vector3, distal: THREE.Vector3, tip: THREE.Vector3, thumb = false): boolean {
    this.a.subVectors(mid, base);
    this.b.subVectors(distal, mid);
    this.c.subVectors(tip, distal);
    const first = this.a.length(), second = this.b.length(), third = this.c.length();
    const path = first + second + third;
    if (first < 0.004 || second < 0.004 || third < 0.004 || path > 0.18) return false;
    // Chord/path ratio rejects curled fingers; adjacent bones also have to
    // agree so one sharply bent fingertip cannot hide in a long first bone.
    // A naturally spread thumb can angle farther at its first knuckle than
    // the four long fingers. Its distal joint must still stay extended.
    return base.distanceTo(tip) / path >= (thumb ? 0.82 : 0.88) &&
      this.a.dot(this.b) / (first * second) >= (thumb ? 0.45 : 0.65) &&
      this.b.dot(this.c) / (second * third) >= 0.65;
  }
}

const finite = (v: THREE.Vector3 | undefined): v is THREE.Vector3 =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
