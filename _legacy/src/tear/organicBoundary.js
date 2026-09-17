import { smoothNoise1D, lerp, clamp } from '../utils/math.js';
import { CONFIG } from '../config/config.js';

/**
 * Builds the irregular tear boundary polygon in the veil's local XY plane.
 *
 * This is the single source of truth for the tear's silhouette — both the
 * hole cut into the wall mesh (TearGeometry) and the curled edge ribbon
 * (TearEdgeGeometry) sample the SAME boundary so the flap geometry always
 * matches the hole exactly.
 *
 * Shape approach: an ellipse elongated along the current pull direction
 * (not a circle — brief explicitly calls out "avoid a perfect ellipse" as
 * the FINAL look, which we get by layering two noise frequencies over the
 * ellipse radius: a low-frequency layer for big organic lobes/bites, and a
 * high-frequency layer for jagged fibre-scale roughness). Noise amplitude
 * scales with `stress`/`energy` so a violent fast pull looks more ragged
 * than a slow controlled one, per brief.
 *
 * @returns {{x:number,y:number}[]} closed loop, NOT repeating the first point
 */
export function computeTearBoundary(signal, segments = 40, timeSeed = 0) {
  const { centerLocal, directionAngle, openAmount, stress, energy } = signal;

  const a = lerp(0.006, CONFIG.tear.maxGap * 0.62, openAmount); // semi-major (along pull axis)
  const b = lerp(0.004, CONFIG.tear.maxGap * 0.38, openAmount); // semi-minor (across pull axis)

  const lowFreqAmp = lerp(0.06, 0.32, stress) * Math.max(a, b);
  const highFreqAmp = lerp(0.015, 0.09, clamp(energy, 0, 1)) * Math.max(a, b);

  const cos = Math.cos(directionAngle);
  const sin = Math.sin(directionAngle);

  const points = new Array(segments);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;

    const lowNoise = smoothNoise1D(Math.cos(t) * 2.1 + Math.sin(t) * 2.1 + timeSeed * 0.15 + 4.7) - 0.5;
    const highNoise = smoothNoise1D(t * 6.0 + timeSeed * 0.6 + 91.3) - 0.5;
    const radiusJitter = 1 + (lowNoise * lowFreqAmp + highNoise * highFreqAmp) / Math.max(a, b, 0.001);

    const ex = Math.cos(t) * a * radiusJitter;
    const ey = Math.sin(t) * b * radiusJitter;

    // rotate ellipse-local point by directionAngle, then place at center
    const x = centerLocal.x + ex * cos - ey * sin;
    const y = centerLocal.y + ex * sin + ey * cos;

    points[i] = { x, y };
  }
  return points;
}
