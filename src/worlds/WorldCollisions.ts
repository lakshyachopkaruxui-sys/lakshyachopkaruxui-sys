import * as THREE from 'three';

export interface CollisionPoint { x: number; z: number }
interface Extent { id: string; minY?: number; maxY?: number; headOcclusion?: boolean }
export interface CollisionCircle extends Extent { x: number; z: number; radius: number }
export interface CollisionCapsule extends Extent { ax: number; az: number; bx: number; bz: number; radius: number }
export interface CollisionPolygon extends Extent { points: readonly CollisionPoint[] }
export interface CollisionMoveOptions { radius: number; height: number; ignoreIds?: ReadonlySet<string> }
type Obstacle = { id: string; points: CollisionPoint[]; radius: number; polygon: boolean; minY: number; maxY: number; minX: number; maxX: number; minZ: number; maxZ: number; headOcclusion: boolean };
const SKIN = 0.0001;
const EPS = 1e-10;

/** Horizontal swept body colliders. Geometry is in the owning world's local metres.
 * World roots may translate, yaw and scale uniformly; pitch/shear are unsupported.
 * This is software locomotion, never a modification of a tracked XR pose.
 */
export class WorldCollisions {
  private obstacles = new Map<string, Obstacle>();
  private inverse = new THREE.Matrix4();
  private localStart = new THREE.Vector3();
  private localEnd = new THREE.Vector3();
  private localResult = new THREE.Vector3();
  private scaledOptions: CollisionMoveOptions = { radius: 0, height: 0 };
  private hitT = 1;
  private hitNX = 0;
  private hitNZ = 0;
  private nearestX = 0;
  private nearestZ = 0;
  private normalX = 0;
  private normalZ = 0;

  constructor(readonly root: THREE.Object3D) {}
  get size() { return this.obstacles.size; }
  clear() { this.obstacles.clear(); }
  remove(id: string) { return this.obstacles.delete(id); }

  addCircle(shape: CollisionCircle) {
    this.register(shape, [{ x: shape.x, z: shape.z }], shape.radius, false);
  }
  addCapsule(shape: CollisionCapsule) {
    this.register(shape, [{ x: shape.ax, z: shape.az }, { x: shape.bx, z: shape.bz }], shape.radius, false);
  }
  /** Uses the convex hull, so unordered footprint points remain conservative. */
  addPolygon(shape: CollisionPolygon) {
    const sorted = shape.points.map(p => ({ x: p.x, z: p.z })).sort((a, b) => a.x - b.x || a.z - b.z);
    if (sorted.length < 3) throw new Error('A collision polygon needs at least three points');
    const cross = (a: CollisionPoint, b: CollisionPoint, c: CollisionPoint) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    const lower: CollisionPoint[] = [], upper: CollisionPoint[] = [];
    for (const p of sorted) { while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (const p of sorted.reverse()) { while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    lower.pop(); upper.pop();
    const hull = lower.concat(upper);
    if (hull.length < 3) throw new Error('A collision polygon needs non-collinear points');
    this.register(shape, hull, 0, true);
  }

  private register(shape: Extent, points: CollisionPoint[], radius: number, polygon: boolean) {
    if (!shape.id || !Number.isFinite(radius) || radius < 0 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) throw new Error('Invalid collision footprint');
    const minY = shape.minY ?? -Infinity, maxY = shape.maxY ?? Infinity;
    if (Number.isNaN(minY) || Number.isNaN(maxY) || minY > maxY) throw new Error('Invalid collision height');
    this.obstacles.set(shape.id, { id: shape.id, points, radius, polygon, minY, maxY, headOcclusion: shape.headOcclusion ?? true,
      minX: Math.min(...points.map(p => p.x)) - radius, maxX: Math.max(...points.map(p => p.x)) + radius,
      minZ: Math.min(...points.map(p => p.z)) - radius, maxZ: Math.max(...points.map(p => p.z)) + radius });
  }

  private transformOptions(options: CollisionMoveOptions) {
    this.root.updateWorldMatrix(true, false);
    this.inverse.copy(this.root.matrixWorld).invert();
    const e = this.root.matrixWorld.elements;
    // Conservative under unequal X/Z scale too; tilted roots are intentionally unsupported.
    const horizontal = Math.max(1e-8, Math.min(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[8], e[9], e[10])));
    const vertical = Math.max(1e-8, Math.hypot(e[4], e[5], e[6]));
    this.scaledOptions.radius = options.radius / horizontal;
    this.scaledOptions.height = options.height / vertical;
    this.scaledOptions.ignoreIds = options.ignoreIds;
  }

  /** Positions are feet. Output Y is the requested Y; terrain remains caller-owned. */
  move(start: THREE.Vector3, desired: THREE.Vector3, options: CollisionMoveOptions, out = new THREE.Vector3()) {
    this.transformOptions(options);
    this.localStart.copy(start).applyMatrix4(this.inverse);
    this.localEnd.copy(desired).applyMatrix4(this.inverse);
    this.moveLocal(this.localStart, this.localEnd, this.scaledOptions, this.localResult);
    out.copy(this.localResult).applyMatrix4(this.root.matrixWorld);
    out.y = desired.y;
    return out;
  }

  queryWorld(position: THREE.Vector3, radius: number, height = 1.7, ignoreIds?: ReadonlySet<string>, headOcclusionOnly = false) {
    this.scaledOptions.radius = radius; this.scaledOptions.height = height; this.scaledOptions.ignoreIds = ignoreIds;
    this.transformOptions(this.scaledOptions);
    this.localStart.copy(position).applyMatrix4(this.inverse);
    return this.queryLocal(this.localStart.x, this.localStart.z, this.scaledOptions.radius, this.scaledOptions.height, this.localStart.y, ignoreIds, headOcclusionOnly);
  }

  queryLocal(x: number, z: number, radius: number, height = 1.7, feetY = 0, ignoreIds?: ReadonlySet<string>, headOcclusionOnly = false) {
    for (const obstacle of this.obstacles.values()) {
      if (ignoreIds?.has(obstacle.id) || (headOcclusionOnly && !obstacle.headOcclusion) || feetY >= obstacle.maxY || feetY + height <= obstacle.minY) continue;
      if (x + radius < obstacle.minX || x - radius > obstacle.maxX || z + radius < obstacle.minZ || z - radius > obstacle.maxZ) continue;
      if (this.distance(obstacle, x, z) < radius - EPS) return true;
    }
    return false;
  }

  moveLocal(start: THREE.Vector3, desired: THREE.Vector3, options: CollisionMoveOptions, out = new THREE.Vector3()) {
    const { radius, height, ignoreIds } = options;
    if (![start.x, start.y, start.z, desired.x, desired.y, desired.z, radius, height].every(Number.isFinite) || radius < 0 || height < 0) throw new Error('Invalid collision movement');
    let x = start.x, z = start.z;
    const low = Math.min(start.y, desired.y), high = Math.max(start.y, desired.y) + height;
    // Resolve spawn/dynamic-object overlap before sweeping, with bounded work.
    for (let pass = 0; pass < 12; pass++) {
      let pushed = false;
      for (const obstacle of this.obstacles.values()) {
        if (ignoreIds?.has(obstacle.id) || low >= obstacle.maxY || high <= obstacle.minY) continue;
        if (x + radius + SKIN < obstacle.minX || x - radius - SKIN > obstacle.maxX || z + radius + SKIN < obstacle.minZ || z - radius - SKIN > obstacle.maxZ) continue;
        const depth = radius + SKIN - this.distance(obstacle, x, z);
        if (depth > SKIN * .5) { x += this.normalX * depth; z += this.normalZ * depth; pushed = true; }
      }
      if (!pushed) break;
    }
    let dx = desired.x - start.x, dz = desired.z - start.z;
    // Exact continuous sweeps: a long frame cannot step across a thin trunk.
    for (let contact = 0; contact < 10 && dx * dx + dz * dz > EPS; contact++) {
      this.hitT = 1; this.hitNX = 0; this.hitNZ = 0;
      for (const obstacle of this.obstacles.values()) {
        if (ignoreIds?.has(obstacle.id) || low >= obstacle.maxY || high <= obstacle.minY) continue;
        if (Math.max(x, x + dx) + radius < obstacle.minX || Math.min(x, x + dx) - radius > obstacle.maxX || Math.max(z, z + dz) + radius < obstacle.minZ || Math.min(z, z + dz) - radius > obstacle.maxZ) continue;
        this.sweep(obstacle, x, z, dx, dz, radius + SKIN);
      }
      x += dx * this.hitT; z += dz * this.hitT;
      if (this.hitNX === 0 && this.hitNZ === 0) break;
      dx *= 1 - this.hitT; dz *= 1 - this.hitT;
      const inward = dx * this.hitNX + dz * this.hitNZ;
      if (inward < 0) { dx -= this.hitNX * inward; dz -= this.hitNZ * inward; }
    }
    return out.set(x, desired.y, z);
  }

  private nearest(ax: number, az: number, bx: number, bz: number, x: number, z: number) {
    const dx = bx - ax, dz = bz - az;
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    this.nearestX = ax + dx * t; this.nearestZ = az + dz * t;
  }

  /** Signed distance plus outward normal; negative means inside a footprint. */
  private distance(obstacle: Obstacle, x: number, z: number) {
    const points = obstacle.points;
    let best = Infinity, nx = 1, nz = 0, inside = obstacle.polygon;
    const edges = obstacle.polygon ? points.length : Math.max(1, points.length - 1);
    for (let i = 0; i < edges; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      this.nearest(a.x, a.z, b.x, b.z, x, z);
      const dx = x - this.nearestX, dz = z - this.nearestZ, d = Math.hypot(dx, dz);
      if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < 0) inside = false;
      if (d < best) {
        best = d;
        const edgeLength = Math.hypot(b.x - a.x, b.z - a.z);
        nx = d > EPS ? dx / d : edgeLength > EPS ? (b.z - a.z) / edgeLength : 1;
        nz = d > EPS ? dz / d : edgeLength > EPS ? -(b.x - a.x) / edgeLength : 0;
      }
    }
    this.normalX = inside && best > EPS ? -nx : nx;
    this.normalZ = inside && best > EPS ? -nz : nz;
    return (inside ? -best : best) - obstacle.radius;
  }

  private candidate(t: number, nx: number, nz: number, dx: number, dz: number) {
    if (t < -EPS || t > this.hitT || dx * nx + dz * nz >= -EPS) return;
    this.hitT = Math.max(0, t); this.hitNX = nx; this.hitNZ = nz;
  }

  private sweepCircle(cx: number, cz: number, radius: number, x: number, z: number, dx: number, dz: number) {
    const ox = x - cx, oz = z - cz, a = dx * dx + dz * dz;
    const b = ox * dx + oz * dz, c = ox * ox + oz * oz - radius * radius;
    const discriminant = b * b - a * c;
    if (discriminant < 0 || a < EPS) return;
    const t = (-b - Math.sqrt(discriminant)) / a;
    const nx = x + dx * t - cx, nz = z + dz * t - cz, length = Math.hypot(nx, nz);
    if (length > EPS) this.candidate(t, nx / length, nz / length, dx, dz);
  }

  private sweep(obstacle: Obstacle, x: number, z: number, dx: number, dz: number, bodyRadius: number) {
    const points = obstacle.points, radius = obstacle.radius + bodyRadius;
    for (const p of points) this.sweepCircle(p.x, p.z, radius, x, z, dx, dz);
    const edges = obstacle.polygon ? points.length : points.length - 1;
    for (let i = 0; i < edges; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const ex = b.x - a.x, ez = b.z - a.z, length = Math.hypot(ex, ez);
      if (length < EPS) continue;
      const nx = ez / length, nz = -ex / length;
      for (let side = 0; side < (obstacle.polygon ? 1 : 2); side++) {
        const sign = obstacle.polygon || side === 1 ? 1 : -1;
        const sx = nx * sign, sz = nz * sign, speed = dx * sx + dz * sz;
        if (speed >= -EPS) continue;
        const t = (radius - ((x - a.x) * sx + (z - a.z) * sz)) / speed;
        const projection = ((x + dx * t - a.x) * ex + (z + dz * t - a.z) * ez) / length;
        if (projection >= 0 && projection <= length) this.candidate(t, sx, sz, dx, dz);
      }
    }
  }
}
