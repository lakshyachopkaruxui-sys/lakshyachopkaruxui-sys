// Small math helpers shared across systems. Kept dependency-free and
// framerate-independent where it matters (hand smoothing, healing, etc).

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Framerate-independent exponential smoothing ("damp"), per Freya Holmer's
// derivation: converges toward `target` at a rate independent of dt, so the
// same `lambda` feels identical at 72Hz (Quest) and 60Hz (desktop).
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampVec3(currentVec3, targetVec3, lambda, dt) {
  currentVec3.x = damp(currentVec3.x, targetVec3.x, lambda, dt);
  currentVec3.y = damp(currentVec3.y, targetVec3.y, lambda, dt);
  currentVec3.z = damp(currentVec3.z, targetVec3.z, lambda, dt);
  return currentVec3;
}

// Deterministic hash-based value noise (1D), used for organic jitter
// (tear boundary irregularity, fibre placement) without pulling in a
// noise library dependency.
export function hashNoise1D(x) {
  const s = Math.sin(x * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

export function hashNoise2D(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

// Smooth 1D value noise via cosine interpolation between hashed lattice points.
export function smoothNoise1D(x) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashNoise1D(i);
  const b = hashNoise1D(i + 1);
  const t = smoothstep(0, 1, f);
  return lerp(a, b, t);
}

export function remap(value, inMin, inMax, outMin, outMax) {
  const t = (value - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, clamp(t, 0, 1));
}
