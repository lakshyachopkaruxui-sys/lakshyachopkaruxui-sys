import * as THREE from 'three';

export interface HellMountainProfile {
  profile: (t: number, angle: number) => THREE.Vector3;
  cavityAt: (t: number, angle: number) => number;
  channelAt: (x: number, z: number) => { t: number; distance: number; bedHeight: number };
  poolCenter: THREE.Vector3;
  poolHeight: number;
}

/** A continuous eroded volcanic landform. Unequal drainage spines and short
 * oblique rock shoulders interrupt a larger curved body; there are no extruded
 * polygon faces, repeated ring steps or per-frame deformation. */
export function createHellMountainProfile(cx: number, cz: number, radius: number,
  height: number, index = 0, withSpill = true,
  floorAt?: (x: number, z: number) => number,
  routeAngle: (t: number) => number = () => Math.PI / 2): HellMountainProfile {
  const poolHeight = height - 2.2;
  const poolCenter = new THREE.Vector3(cx - radius * .115, poolHeight, cz + radius * .045);
  const seed = index * 17 + 43, rotation = index * .71;
  const spines = [
    { a: -.26, width: .19, strength: 1.10, at: .43, reach: .40 },
    { a: .57, width: .14, strength: .83, at: .62, reach: .31 },
    { a: 1.20, width: .22, strength: 1.04, at: .47, reach: .40 },
    { a: 2.18, width: .17, strength: 1.23, at: .61, reach: .32 },
    { a: 2.96, width: .23, strength: .88, at: .39, reach: .36 },
    { a: 3.87, width: .16, strength: 1.13, at: .55, reach: .37 },
    { a: 4.84, width: .20, strength: .91, at: .67, reach: .29 },
    { a: 5.63, width: .14, strength: .79, at: .36, reach: .34 }
  ];
  const shoulderShapes = [[.88,.60,.37,1.35],[2.23,.43,.34,1.10],[4.35,.55,.49,.9]];
  const footprint = (a: number) => 1 + .072 * Math.sin(a * 2 + .6 + rotation)
    + .038 * Math.sin(a * 3 - .9 + rotation * .3)
    + .037 * (noise(Math.cos(a) * 3.1, Math.sin(a) * 3.1, seed) - .5);
  const elevation = (t: number) => .28 * t + .72 * Math.pow(t, 1.22);
  const channelMask = (t: number, distance: number) => {
    const lip = THREE.MathUtils.smoothstep(t, .86, 1);
    return 1 - THREE.MathUtils.smoothstep(distance,
      THREE.MathUtils.lerp(1.55, .48, lip), THREE.MathUtils.lerp(2.75, .92, lip));
  };
  const centerAt = (t: number) => {
    const offset = Math.pow(Math.max(0, t), 1.35);
    return { x: cx - radius * .115 * offset, z: cz + radius * .045 * offset };
  };
  const horizontalAt = (t: number, a: number) => {
    const taper = 1 - .81 * Math.pow(Math.max(0, t), .76);
    let r = radius * taper * footprint(a);
    if (withSpill) {
      // A broad buried apron, rather than a tangent circular edge, supports
      // both banks where the stream meets the existing basin tributary.
      const toeAngle = Math.abs(delta(a, Math.PI / 2));
      const toe = (1 - THREE.MathUtils.smoothstep(toeAngle, .15, .34))
        * (1 - THREE.MathUtils.smoothstep(t, 0, .16));
      const apron = (radius + .4) * taper / Math.max(.9, Math.sin(a));
      r = THREE.MathUtils.lerp(r, apron, toe);
    }
    const center = centerAt(t);
    return { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, r };
  };
  const bedAt = (t: number) => {
    let y = (poolHeight + .395) * elevation(t) - .45 - 1.25 * Math.sin(t * Math.PI);
    if (floorAt && t < .14) {
      const toe = floorAt(cx, cz + radius + .4) + .125;
      y += (toe + .45) * (1 - THREE.MathUtils.smoothstep(t, 0, .14));
    }
    return y;
  };
  // The gully is measured against the actual winding route in XZ. Using a
  // radial angle difference would put opposite banks at different route
  // heights whenever the flow cuts across a slope, producing raised sidewalls.
  const route = Array.from({ length: 97 }, (_, index) => {
    const t = index / 96, p = horizontalAt(t, routeAngle(t));
    return { t, x: p.x, z: p.z, y: bedAt(t) };
  });
  const routeSegments = route.slice(0, -1).map((a, index) => {
    const b = route[index + 1], dx = b.x - a.x, dz = b.z - a.z;
    return { a, b, dx, dz, inverseLengthSquared: 1 / Math.max(dx * dx + dz * dz, 1e-12) };
  });
  const channelAt = (x: number, z: number) => {
    let distanceSquared = Infinity, t = 0, bedHeight = route[0].y;
    for (let index = 0; index < routeSegments.length; index++) {
      const segment = routeSegments[index], a = segment.a, b = segment.b;
      const f = THREE.MathUtils.clamp(((x - a.x) * segment.dx + (z - a.z) * segment.dz)
        * segment.inverseLengthSquared, 0, 1);
      const ex = x - a.x - segment.dx * f, ez = z - a.z - segment.dz * f;
      const candidate = ex * ex + ez * ez;
      if (candidate < distanceSquared) {
        distanceSquared = candidate;
        t = THREE.MathUtils.lerp(a.t, b.t, f); bedHeight = THREE.MathUtils.lerp(a.y, b.y, f);
      }
    }
    return { t, distance: Math.sqrt(distanceSquared), bedHeight };
  };
  const reliefAt = (t: number, a: number, x: number, z: number) => {
    const envelope = Math.max(0, Math.sin(t * Math.PI));
    let drainageRidges = 0;
    for (let i = 0; i < spines.length; i++) {
      const spine = spines[i];
      const lean = .15 * Math.sin(t * 4.8 + i * 1.7) * (1 - t);
      const distance = delta(a, spine.a + rotation + lean);
      const width = spine.width * (1 + .30 * t);
      const length = Math.exp(-Math.pow((t - spine.at) / spine.reach, 2));
      drainageRidges += Math.exp(-Math.pow(distance / width, 2)) * spine.strength * length;
    }
    // Domain-warped broad erosion avoids equally spaced, straight radial ribs.
    const warpX = x * .16 + (noise(x * .073, z * .073, seed + 5) - .5) * 1.6;
    const warpZ = z * .16 + (noise(x * .073 + 9, z * .073 - 3, seed + 11) - .5) * 1.6;
    const broad = noise(warpX, warpZ, seed + 19);
    const joints = 1 - Math.abs(noise(x * .40 - z * .11, z * .37 + x * .09, seed + 31) * 2 - 1);
    const small = triangularNoise(x * .69 + z * .16, z * .61 - x * .12, seed + 37);
    // Short oblique shoulders expose bedrock locally. Their heights, angles
    // and lengths differ, so they cannot form a continuous horizontal bench.
    let shoulder = 0;
    for (const [angle, at, width, rise] of shoulderShapes) {
      const da = delta(a, angle + rotation), center = at + da * .075;
      const upper = t < center
        ? THREE.MathUtils.smoothstep(t, center - .15, center)
        : 1 - THREE.MathUtils.smoothstep(t, center, center + .065);
      shoulder += Math.exp(-Math.pow(da / width, 2)) * upper * rise;
    }
    const relief = drainageRidges * height * .092 + (broad - .5) * height * .105
      + (joints - .5) * .72 + (small - .5) * .26 + shoulder;
    return { value: relief * envelope,
      shelter: THREE.MathUtils.clamp((.6 - broad) * 1.1 + (1 - joints) * .22 - drainageRidges * .16, 0, 1) * envelope };
  };
  let lastSample: { t: number; a: number; point: ReturnType<typeof horizontalAt>;
    relief: ReturnType<typeof reliefAt>; channel: ReturnType<typeof channelAt> | null } | undefined;
  const sampleAt = (t: number, a: number) => {
    if (lastSample?.t === t && lastSample.a === a) return lastSample;
    const point = horizontalAt(t, a);
    lastSample = { t, a, point, relief: reliefAt(t, a, point.x, point.z),
      channel: withSpill ? channelAt(point.x, point.z) : null };
    return lastSample;
  };
  const profile = (rawT: number, a: number) => {
    const t = THREE.MathUtils.clamp(rawT, 0, 1), { point, relief, channel } = sampleAt(t, a);
    let y = height * elevation(t) - .45 + relief.value;
    const crest = Math.max(poolHeight + .42, height - .45
      + (noise(Math.cos(a) * 3.6, Math.sin(a) * 3.6, seed + 53) - .5) * 1.45
      + Math.sin(a * 5 + rotation) * .25);
    y += (crest - (height - .45)) * Math.pow(t, 7);
    if (floorAt && t < .14) {
      const toeAngle = Math.abs(delta(a, Math.PI / 2));
      const front = withSpill ? 1 - THREE.MathUtils.smoothstep(toeAngle, .12, .32) : 0;
      const toe = THREE.MathUtils.lerp(floorAt(point.x, point.z) - .12,
        floorAt(cx, cz + radius + .4) + .125, front);
      y += (toe + .45) * (1 - THREE.MathUtils.smoothstep(t, 0, .14));
    }
    if (channel) y = THREE.MathUtils.lerp(y, channel.bedHeight, channelMask(channel.t, channel.distance));
    return new THREE.Vector3(point.x, y, point.z);
  };
  const cavityAt = (t: number, a: number) => {
    const { relief, channel } = sampleAt(THREE.MathUtils.clamp(t, 0, 1), a);
    const shelteredChannel = channel ? channelMask(channel.t, channel.distance) : 0;
    return THREE.MathUtils.clamp(relief.shelter * .72 + shelteredChannel * .23 * Math.sin(t * Math.PI), 0, 1);
  };
  return { profile, cavityAt, channelAt, poolCenter, poolHeight };
}

function delta(a: number, b: number) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function hash(x: number, z: number, seed: number) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 73.9) * 43758.5453;
  return value - Math.floor(value);
}
function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
  const sx = u * u * (3 - 2 * u), sz = v * v * (3 - 2 * v);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix,iz,seed),hash(ix+1,iz,seed),sx),
    THREE.MathUtils.lerp(hash(ix,iz+1,seed),hash(ix+1,iz+1,seed),sx),sz);
}
function triangularNoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
  const a = hash(ix,iz,seed), b = hash(ix+1,iz,seed), c = hash(ix,iz+1,seed), d = hash(ix+1,iz+1,seed);
  return u + v < 1 ? a + (b-a)*u + (c-a)*v : d + (c-d)*(1-u) + (b-d)*(1-v);
}
