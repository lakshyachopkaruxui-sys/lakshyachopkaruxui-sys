import type * as THREE from 'three';

type Point = { v: number; x: number; y: number; z: number; arc: number };

/** Reparameterize a fitted overflow once, after clipping it to the mountain.
 * U remains the stationary bank coordinate. V follows physical surface distance,
 * including near-vertical scarps that occupy almost no horizontal footprint. */
export function remapHellSpillCoordinates(geometry: THREE.BufferGeometry): void {
  if (geometry.userData.physicalSpillCoordinates) return;
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
  if (!position || !uv || position.count !== uv.count || position.count < 3) return;
  const index = geometry.getIndex(), count = index?.count ?? position.count;
  const vertex = (i: number) => index ? index.getX(i) : i;
  const cuts: Point[] = [];
  let minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i));
  }
  const tolerance = Math.max(1e-7, (maxV - minV) * 1e-7);
  const add = (a: number, b: number, t: number) => cuts.push({
    v: uv.getY(a) + (uv.getY(b) - uv.getY(a)) * t,
    x: position.getX(a) + (position.getX(b) - position.getX(a)) * t,
    y: position.getY(a) + (position.getY(b) - position.getY(a)) * t,
    z: position.getZ(a) + (position.getZ(b) - position.getZ(a)) * t, arc: 0
  });
  // Intersections with U=.5 recover the actual piecewise planar centerline,
  // rather than the authored profile that existed before facet clipping.
  for (let i = 0; i + 2 < count; i += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = vertex(i + edge), b = vertex(i + (edge + 1) % 3);
      const ua = uv.getX(a), ub = uv.getX(b), span = ub - ua;
      if (Math.abs(span) < 1e-9) {
        if (Math.abs(ua - .5) < 1e-7) { add(a, b, 0); add(a, b, 1); }
      } else {
        const t = (.5 - ua) / span;
        if (t >= -1e-7 && t <= 1 + 1e-7) add(a, b, Math.max(0, Math.min(1, t)));
      }
    }
  }
  cuts.sort((a, b) => a.v - b.v);
  const center: Point[] = [];
  // Adjacent facets duplicate their intersection. Averaging removes tiny
  // Float32 discrepancies without introducing seams between shared edges.
  for (let i = 0; i < cuts.length;) {
    const first = cuts[i], merged = { ...first };
    let j = i + 1;
    for (; j < cuts.length && cuts[j].v - first.v <= tolerance; j++) {
      merged.v += cuts[j].v; merged.x += cuts[j].x;
      merged.y += cuts[j].y; merged.z += cuts[j].z;
    }
    const n = j - i;
    merged.v /= n; merged.x /= n; merged.y /= n; merged.z /= n;
    if (center.length) {
      const previous = center[center.length - 1];
      merged.arc = previous.arc + Math.hypot(merged.x - previous.x,
        merged.y - previous.y, merged.z - previous.z);
    }
    center.push(merged); i = j;
  }
  if (center.length < 2 || center[center.length - 1].arc < 1e-6) return;
  const tangent = center.map((point, i) => {
    const before = center[Math.max(0, i - 1)], after = center[Math.min(center.length - 1, i + 1)];
    const x = after.x - before.x, y = after.y - before.y, z = after.z - before.z;
    const length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
  });
  const previous = new Float64Array(uv.count), base = new Float64Array(uv.count);
  const correction = new Float64Array(uv.count), proposed = new Float64Array(uv.count);
  for (let i = 0; i < uv.count; i++) {
    const v = uv.getY(i); previous[i] = v;
    let lo = 0, hi = center.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (center[mid].v > v) hi = mid; else lo = mid; }
    const a = center[lo], b = center[hi], f = (v - a.v) / Math.max(1e-12, b.v - a.v);
    const y = a.y + (b.y - a.y) * f;
    const tx = tangent[lo].x + (tangent[hi].x - tangent[lo].x) * f;
    const ty = tangent[lo].y + (tangent[hi].y - tangent[lo].y) * f;
    const tz = tangent[lo].z + (tangent[hi].z - tangent[lo].z) * f;
    const length = Math.hypot(tx, ty, tz) || 1;
    base[i] = minV + (a.arc + (b.arc - a.arc) * f) / 3;
    // Project the side-height difference onto the local downhill tangent.
    // Horizontal curvature is already encoded by the original U/V chart;
    // projecting sideways across a bend would incorrectly shear that chart.
    correction[i] = v <= minV + tolerance ? 0 : (position.getY(i) - y) * ty / length / 3;
    if (v <= minV + tolerance) base[i] = minV;
    proposed[i] = base[i];
  }
  const safeBlend = (from: Float64Array, to: Float64Array) => {
    let blend = 1;
    for (let i = 0; i + 2 < count; i += 3) {
      const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
      const uab = uv.getX(b) - uv.getX(a), uac = uv.getX(c) - uv.getX(a);
      const oldArea = uab * (from[c] - from[a]) - uac * (from[b] - from[a]);
      if (Math.abs(oldArea) < 1e-12) continue;
      const newArea = (uab * (to[c] - to[a]) - uac * (to[b] - to[a])) * Math.sign(oldArea);
      if (newArea < Math.abs(oldArea) * .01)
        blend = Math.min(blend, Math.abs(oldArea) * .99 / (Math.abs(oldArea) - newArea));
    }
    return blend;
  };
  // Safeguard the centerline chart independently. A difficult side facet may
  // limit its lateral correction without rolling back the physical arc repair.
  const centerBlend = safeBlend(previous, base);
  for (let i = 0; i < uv.count; i++) {
    base[i] = previous[i] + (base[i] - previous[i]) * centerBlend;
    proposed[i] = base[i] + correction[i];
  }
  const blend = safeBlend(base, proposed);
  for (let i = 0; i < uv.count; i++) uv.setY(i, base[i] + correction[i] * blend);
  uv.needsUpdate = true;
  geometry.userData.physicalSpillCoordinates = true;
  geometry.userData.spillUvArc = center[center.length - 1].arc;
  geometry.userData.spillUvCenterBlend = centerBlend;
  geometry.userData.spillUvBlend = blend;
}
