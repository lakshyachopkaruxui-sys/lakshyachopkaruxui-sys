type WidthControl = Readonly<{ t: number; halfWidth: number }>;
type Curve = Readonly<{ positions: readonly number[]; values: readonly number[]; slopes: readonly number[] }>;

/** A physical lateral excursion relative to the mountain radius. Bends are
 * authored along radial distance, not polar angle: their inner banks retain
 * enough turn radius instead of pinching into a tight angular hairpin. */
export const HELL_LAVA_ROUTE_AMPLITUDE_RATIO = 3.4 / 23;

/** Half-width in metres. Broader lobes alternate with irregular constrictions,
 * retaining the existing small caldera notch and basin tributary connection. */
export const HELL_LAVA_WIDTH_CONTROL_POINTS: readonly WidthControl[] = Object.freeze([
  [0, .76], [.12, 1.04], [.28, 1.34], [.43, .86],
  [.60, 1.42], [.73, 1.05], [.86, .80], [1, .44]
].map(([t, halfWidth]) => Object.freeze({ t, halfWidth })));

const widthCurve = prepareCurve(HELL_LAVA_WIDTH_CONTROL_POINTS.map(point => point.t),
  HELL_LAVA_WIDTH_CONTROL_POINTS.map(point => point.halfWidth));

/** Polar angle in the owning world's XZ plane. Both joins point along +Z. */
export function hellLavaRouteAngle(t: number): number {
  t = clampParameter(t);
  if (t === 0 || t === 1) return Math.PI / 2;
  const taper = 1 - .81 * Math.pow(t, .76), radialProgress = (taper - .19) / .81;
  // One whole-flank S has two broad turns. Its envelope eases both physical
  // joins; terrain asymmetry and varying widths prevent a repeating zigzag.
  const lateral = -HELL_LAVA_ROUTE_AMPLITUDE_RATIO * Math.sin(radialProgress * Math.PI * 2)
    * Math.sin(radialProgress * Math.PI);
  return Math.PI / 2 - Math.asin(lateral / taper);
}

/** The geometry's full channel width is twice this value. */
export function hellLavaRouteWidth(t: number): number {
  return sampleCurve(widthCurve, t);
}

function prepareCurve(positions: readonly number[], values: readonly number[]): Curve {
  const slopes = new Array<number>(positions.length).fill(0);
  // Shape-preserving cubic Hermite interpolation: tangents vanish at reversals
  // and at the two physical joins. No overshoot can add another artificial bend.
  for (let index = 1; index < positions.length - 1; index++) {
    const before = positions[index] - positions[index - 1];
    const after = positions[index + 1] - positions[index];
    const left = (values[index] - values[index - 1]) / before;
    const right = (values[index + 1] - values[index]) / after;
    if (left * right > 0) {
      const a = 2 * after + before, b = after + 2 * before;
      slopes[index] = (a + b) / (a / left + b / right);
    }
  }
  return { positions, values, slopes };
}

function sampleCurve(curve: Curve, input: number): number {
  const t = clampParameter(input);
  const { positions, values, slopes } = curve;
  if (t === 0) return values[0];
  if (t === 1) return values[values.length - 1];
  let index = 0;
  while (positions[index + 1] < t) index++;
  const span = positions[index + 1] - positions[index], u = (t - positions[index]) / span;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * values[index]
    + (u3 - 2 * u2 + u) * span * slopes[index]
    + (-2 * u3 + 3 * u2) * values[index + 1]
    + (u3 - u2) * span * slopes[index + 1];
}

function clampParameter(input: number): number {
  if (Number.isNaN(input)) throw new RangeError('Lava route parameter must be a number');
  return Math.max(0, Math.min(1, input));
}
