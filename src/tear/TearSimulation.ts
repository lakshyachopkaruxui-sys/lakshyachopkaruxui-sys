import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { clamp, damp, mulberry32 } from '../utils/math';
import type { PinchTracker } from '../interaction/PinchTracker';

export const MAX_CRACK_POINTS = 32;
const POINT_SPACING = 0.04;
const T = CONFIG.tear;
const H = CONFIG.healing;

export interface Grip {
  holding: boolean;
  weight: number;                 // 1 while held, stays 1 while the released edge relaxes
  material: THREE.Vector2;        // where on the membrane it was grabbed (rest coordinates)
  side: number;                   // which side of the crack (-1 / +1)
  arc: number;                    // position along the crack
  grabZ: number;
  grabPosition: THREE.Vector2;    // physical XY position when this grip began
  grabDisplacement: THREE.Vector2;// visual XY displacement when this grip began (also on regrip)
  disp: THREE.Vector3;            // current displacement of the gripped material
  target: THREE.Vector3;
  releasedFor: number;
}

export type TearEvent =
  | { type: 'rip'; strength: number; tips: THREE.Vector3[] }
  | { type: 'breakthrough'; tips: THREE.Vector3[] }
  | { type: 'grab'; hand: 0 | 1 }
  | { type: 'release' }
  | { type: 'healed' };

interface CrackHit { dist: number; side: number; arc: number }

/**
 * Physical model of the tear, in the membrane's local 2D rest space.
 * - The crack is a polyline. Only the part between -tornA..+tornB is torn.
 * - Each grip drags material on its own side of the crack; across a torn
 *   crack the two sides separate, beyond the tips the material only stretches.
 * - Separation beyond what the crack allows is strain. Strain above the yield
 *   rips the crack further in jumps (stick-slip): wet paper, not rubber.
 * - Releasing starts healing: a pause, then accelerating closure.
 */
export class TearSimulation {
  readonly points: THREE.Vector3[] = []; // x, y, arc (signed from centre)
  tornA = 0;  // torn length toward points[0]
  tornB = 0;  // torn length toward points[last]
  readonly grips: [Grip, Grip] = [makeGrip(), makeGrip()];
  gap = 0;
  strain = 0;
  energy = 0;
  openness = 0;        // 0..1 visual opening, drives light / audio / particles
  crackOpenness = 0;   // 0..1 how much crack exists at all (even if edges touch)
  healTime = 0;
  releaseTimer = 0;
  everOpened = false;
  readonly pullDir = new THREE.Vector2(1, 0);
  readonly centre = new THREE.Vector2();

  private rng = mulberry32(7);
  private ripCooldown = 0;
  private closed = true;
  private listeners: ((e: TearEvent) => void)[] = [];
  private tmpLocal = new THREE.Vector3();

  constructor(private anchor: THREE.Object3D) {
    this.buildSeam();
  }

  on(fn: (e: TearEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: TearEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private buildSeam() {
    const n = Math.max(3, Math.round(T.seamLength / POINT_SPACING) + 1);
    this.points.length = 0;
    for (let i = 0; i < n; i++) {
      const y = -T.seamLength / 2 + (i / (n - 1)) * T.seamLength;
      const x = (this.rng() - 0.5) * 0.016;
      this.points.push(new THREE.Vector3(x, y, 0));
    }
    this.recomputeArcs(Math.floor(n / 2));
  }

  private centreIndex = 0;
  private recomputeArcs(centreIndex: number) {
    this.centreIndex = centreIndex;
    const p = this.points;
    p[centreIndex].z = 0;
    for (let i = centreIndex - 1; i >= 0; i--) p[i].z = p[i + 1].z - Math.hypot(p[i].x - p[i + 1].x, p[i].y - p[i + 1].y);
    for (let i = centreIndex + 1; i < p.length; i++) p[i].z = p[i - 1].z + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    this.centre.set(p[centreIndex].x, p[centreIndex].y);
  }

  get arcA() { return -this.points[0].z; }
  get arcB() { return this.points[this.points.length - 1].z; }
  get tornLength() { return this.tornA + this.tornB; }

  /** Distance to crack, side, and arc position (extended past the tips). */
  query(x: number, y: number): CrackHit {
    const p = this.points;
    let best = Infinity, side = 1, arc = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i].x, ay = p[i].y, abx = p[i + 1].x - ax, aby = p[i + 1].y - ay;
      const len2 = Math.max(abx * abx + aby * aby, 1e-8);
      const tRaw = ((x - ax) * abx + (y - ay) * aby) / len2;
      const t = clamp(tRaw, 0, 1);
      const d = Math.hypot(x - (ax + abx * t), y - (ay + aby * t));
      if (d < best) {
        best = d;
        side = abx * (y - ay) - aby * (x - ax) >= 0 ? 1 : -1;
        const len = Math.sqrt(len2);
        const tt = (i === 0 && tRaw < 0) || (i === p.length - 2 && tRaw > 1) ? tRaw : t;
        arc = p[i].z + tt * len;
      }
    }
    return { dist: best, side, arc };
  }

  /** Nearest point ON the crack to a point in the membrane plane. */
  closestPoint(x: number, y: number) {
    const p = this.points;
    let best = Infinity;
    let bx = p[0].x, by = p[0].y;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i].x, ay = p[i].y, abx = p[i + 1].x - ax, aby = p[i + 1].y - ay;
      const len2 = Math.max(abx * abx + aby * aby, 1e-8);
      const t = clamp(((x - ax) * abx + (y - ay) * aby) / len2, 0, 1);
      const qx = ax + abx * t, qy = ay + aby * t;
      const d = Math.hypot(x - qx, y - qy);
      if (d < best) {
        best = d;
        bx = qx;
        by = qy;
      }
    }
    return { x: bx, y: by, distance: best };
  }

  update(hands: [PinchTracker, PinchTracker], dt: number, pullGain = 1) {
    // Only amplify motion after capture. A small, bounded gain reduces XR reach
    // without moving the hands themselves or changing the pinch / release rules.
    const gain = Number.isFinite(pullGain) ? clamp(pullGain, 1, 1.5) : 1;
    this.anchor.updateMatrixWorld();

    // --- grips -----------------------------------------------------------
    for (let h = 0; h < 2; h++) {
      const hand = hands[h];
      const g = this.grips[h];
      const local = this.anchor.worldToLocal(this.tmpLocal.copy(hand.position));

      if (hand.pinchStarted && !g.holding) this.tryGrab(h as 0 | 1, local);
      if (g.holding && (!hand.pinching || !hand.tracked)) {
        g.holding = false;
        g.releasedFor = 0;
        if (!this.grips[0].holding && !this.grips[1].holding) this.emit({ type: 'release' });
      }

      if (g.holding) {
        g.target.set(
          g.grabDisplacement.x + (local.x - g.grabPosition.x) * gain,
          g.grabDisplacement.y + (local.y - g.grabPosition.y) * gain,
          local.z - g.grabZ
        );
        if (g.target.length() > 0.7) g.target.setLength(0.7);
        g.disp.x = damp(g.disp.x, g.target.x, 30, dt);
        g.disp.y = damp(g.disp.y, g.target.y, 30, dt);
        g.disp.z = damp(g.disp.z, g.target.z, 30, dt);
      } else if (g.weight > 0) {
        g.releasedFor += dt;
        const healing = Math.max(0, g.releasedFor - H.suspendSeconds);
        const k = g.releasedFor < H.suspendSeconds ? 0.05 : H.edgeRelaxStart + H.edgeRelaxAcceleration * healing * healing;
        g.disp.multiplyScalar(Math.exp(-k * dt));
        if (g.disp.length() < 0.0015) {
          g.weight = 0;
          g.disp.set(0, 0, 0);
        }
      }
    }

    // --- energy from hand velocity and acceleration ----------------------
    const holdingHands = hands.filter((_, i) => this.grips[i].holding);
    let rawEnergy = 0;
    for (const hand of holdingHands) {
      rawEnergy += hand.speed * T.velocitySensitivity + hand.acceleration.length() * T.accelerationSensitivity;
    }
    rawEnergy = holdingHands.length ? clamp(rawEnergy / holdingHands.length, 0, 1) : 0;
    this.energy = damp(this.energy, rawEnergy, rawEnergy > this.energy ? 18 : 4, dt);

    // --- gap & strain ------------------------------------------------------
    const [gL, gR] = this.grips;
    const opposite = gL.weight > 0 && gR.weight > 0 && gL.side !== gR.side;
    this.gap = 0;
    if (opposite) {
      const restDist = gL.material.distanceTo(gR.material);
      const ax = gL.material.x + gL.disp.x, ay = gL.material.y + gL.disp.y;
      const bx = gR.material.x + gR.disp.x, by = gR.material.y + gR.disp.y;
      this.gap = Math.max(0, Math.hypot(bx - ax, by - ay) - restDist);
      if (Math.hypot(bx - ax, by - ay) > 1e-3) this.pullDir.set(bx - ax, by - ay).normalize();
    }
    const allowed = T.openingPerCrackLength * this.tornLength * 0.5;
    this.strain = Math.max(0, this.gap - allowed);

    const bothHolding = gL.holding && gR.holding && opposite;
    this.ripCooldown = Math.max(0, this.ripCooldown - dt);
    if (bothHolding) {
      const yieldNow = (this.tornLength < 0.01 ? T.firstYield : T.yield) * (1 - 0.45 * this.energy);
      let rips = 0;
      // Stick-slip: strain must build past the yield, then the paper gives way
      // in one jump and holds again for a moment before it can give way again.
      if (this.strain > yieldNow && this.ripCooldown <= 0) {
        const step = T.ripStep * (0.7 + 0.6 * this.rng()) * (1 + this.energy * 0.8);
        const grewA = this.extendTip('A', step);
        const grewB = this.extendTip('B', step);
        if (grewA || grewB) {
          rips = 1;
          this.ripCooldown = T.ripCooldown * (1 - 0.6 * this.energy) * (0.7 + 0.6 * this.rng());
          const newAllowed = T.openingPerCrackLength * this.tornLength * 0.5;
          this.strain = Math.max(0, this.gap - newAllowed);
        }
      }
      if (rips > 0) {
        const tips = this.tipWorldPositions();
        if (this.closed) {
          this.closed = false;
          this.everOpened = true;
          this.emit({ type: 'breakthrough', tips });
        }
        this.emit({ type: 'rip', strength: clamp(0.4 + this.energy + rips * 0.2, 0, 2), tips });
      }
    }

    // --- healing -----------------------------------------------------------
    const anyHolding = gL.holding || gR.holding;
    if (!anyHolding && (this.tornLength > 0 || gL.weight > 0 || gR.weight > 0)) {
      this.releaseTimer += dt;
      if (this.releaseTimer > H.suspendSeconds) {
        this.healTime += dt;
        const rate = H.crackBaseRate + H.crackAcceleration * this.healTime;
        this.tornA = Math.max(0, this.tornA - rate * dt);
        this.tornB = Math.max(0, this.tornB - rate * dt);
        this.pruneScar();
      }
      if (this.tornLength <= 0 && gL.weight === 0 && gR.weight === 0 && !this.closed) {
        this.closed = true;
        this.emit({ type: 'healed' });
      }
    } else {
      this.releaseTimer = 0;
      this.healTime = 0;
    }

    const visualGap = this.tornLength > 0.01 ? Math.min(this.gap, allowed + 0.03) : 0;
    this.openness = clamp(visualGap / T.fullyOpenGap, 0, 1);
    this.crackOpenness = clamp(this.tornLength / (T.maxCrackHalfLength * 2), 0, 1);
  }

  get releaseSuspended() {
    return this.releaseTimer > 0 && this.releaseTimer < H.suspendSeconds;
  }

  get gripsHolding() {
    return (this.grips[0].holding ? 1 : 0) + (this.grips[1].holding ? 1 : 0);
  }

  private tryGrab(h: 0 | 1, local: THREE.Vector3) {
    if (Math.abs(local.z) > T.captureRadius) return;
    const hit = this.query(local.x, local.y);
    if (hit.dist > T.captureRadius) return;
    if (hit.arc < -(this.arcA + 0.12) || hit.arc > this.arcB + 0.12) return;
    const g = this.grips[h];
    const other = this.grips[1 - h];
    let side = hit.side;
    if (other.holding && other.side === side && hit.dist < 0.03) side = -side;
    g.holding = true;
    g.weight = 1;
    g.side = side;
    g.arc = hit.arc;
    // Grab material that is currently displaced here, not the rest position.
    g.material.set(local.x - g.disp.x * (g.weight ? 1 : 0), local.y - g.disp.y);
    g.grabZ = local.z - g.disp.z;
    g.grabPosition.set(local.x, local.y);
    g.grabDisplacement.set(g.disp.x, g.disp.y);
    g.target.copy(g.disp);
    this.emit({ type: 'grab', hand: h });
  }

  private extendTip(which: 'A' | 'B', step: number): boolean {
    const p = this.points;
    const torn = which === 'A' ? this.tornA : this.tornB;
    if (torn >= T.maxCrackHalfLength) return false;
    const want = Math.min(torn + step, T.maxCrackHalfLength);
    let tipArc = which === 'A' ? this.arcA : this.arcB;
    while (tipArc < want && p.length < MAX_CRACK_POINTS) {
      const tip = which === 'A' ? p[0] : p[p.length - 1];
      const prev = which === 'A' ? p[1] : p[p.length - 2];
      const dir = new THREE.Vector2(tip.x - prev.x, tip.y - prev.y).normalize();
      const perp = new THREE.Vector2(-this.pullDir.y, this.pullDir.x);
      if (perp.dot(dir) < 0) perp.negate();
      dir.lerp(perp, 0.35).normalize().rotateAround(new THREE.Vector2(), (this.rng() - 0.5) * 0.7);
      const nx = tip.x + dir.x * POINT_SPACING;
      const ny = tip.y + dir.y * POINT_SPACING;
      if (Math.abs(nx) > T.membraneWidth / 2 - 0.12 || Math.abs(ny) > T.membraneHeight / 2 - 0.12) break;
      if (which === 'A') {
        p.unshift(new THREE.Vector3(nx, ny, 0));
        this.recomputeArcs(this.centreIndex + 1);
      } else {
        p.push(new THREE.Vector3(nx, ny, 0));
        this.recomputeArcs(this.centreIndex);
      }
      tipArc = which === 'A' ? this.arcA : this.arcB;
    }
    const newTorn = Math.min(want, tipArc);
    if (newTorn <= torn + 1e-4) return false;
    if (which === 'A') this.tornA = newTorn;
    else this.tornB = newTorn;
    return true;
  }

  /** Once healed past them, remove crack points beyond the original seam (scar lingers a little). */
  private pruneScar() {
    const keepA = Math.max(T.seamLength / 2, this.tornA + 0.08);
    const keepB = Math.max(T.seamLength / 2, this.tornB + 0.08);
    while (this.points.length > 3 && this.arcA > keepA + POINT_SPACING) {
      this.points.shift();
      this.recomputeArcs(this.centreIndex - 1);
    }
    while (this.points.length > 3 && this.arcB > keepB + POINT_SPACING) {
      this.points.pop();
      this.recomputeArcs(this.centreIndex);
    }
  }

  /** Approximate world positions of the two torn tips, for particles and sound. */
  tipWorldPositions(): THREE.Vector3[] {
    return [this.pointAtArc(-this.tornA), this.pointAtArc(this.tornB)].map((v) => this.anchor.localToWorld(v));
  }

  pointAtArc(arc: number): THREE.Vector3 {
    const p = this.points;
    for (let i = 0; i < p.length - 1; i++) {
      if (arc <= p[i + 1].z || i === p.length - 2) {
        const t = clamp((arc - p[i].z) / Math.max(p[i + 1].z - p[i].z, 1e-6), 0, 1);
        return new THREE.Vector3(p[i].x + (p[i + 1].x - p[i].x) * t, p[i].y + (p[i + 1].y - p[i].y) * t, 0.01);
      }
    }
    return new THREE.Vector3();
  }

  /** Back to an untouched seam — used after stepping through into a new world. */
  reset() {
    this.buildSeam();
    this.tornA = 0;
    this.tornB = 0;
    this.gap = 0;
    this.strain = 0;
    this.energy = 0;
    this.openness = 0;
    this.crackOpenness = 0;
    this.healTime = 0;
    this.releaseTimer = 0;
    this.ripCooldown = 0;
    this.closed = true;
    for (const g of this.grips) {
      g.holding = false;
      g.weight = 0;
      g.releasedFor = 0;
      g.disp.set(0, 0, 0);
      g.target.set(0, 0, 0);
      g.grabPosition.set(0, 0);
      g.grabDisplacement.set(0, 0);
    }
  }

  /** Force the tear open or closed — used by world transitions. */
  setOpenAmount(gap: number, tornHalf: number) {
    this.tornA = Math.max(this.tornA, Math.min(tornHalf, this.arcA));
    this.tornB = Math.max(this.tornB, Math.min(tornHalf, this.arcB));
    this.gap = gap;
  }
}

function makeGrip(): Grip {
  return {
    holding: false,
    weight: 0,
    material: new THREE.Vector2(),
    side: 1,
    arc: 0,
    grabZ: 0,
    grabPosition: new THREE.Vector2(),
    grabDisplacement: new THREE.Vector2(),
    disp: new THREE.Vector3(),
    target: new THREE.Vector3(),
    releasedFor: 0
  };
}
