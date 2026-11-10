import * as THREE from 'three';

export interface HellRiverPath { points: readonly (readonly number[])[]; width: number }

/** Round only a short section of each authored corner. The visual channel stays
 * inside the existing straight collision capsules and terrain incision. */
export function sampleHellRiverPath(river: HellRiverPath) {
  const controls = river.points.map(point => new THREE.Vector2(point[0], point[1]));
  if (controls.length < 2 || !Number.isFinite(river.width) || river.width <= 0)
    throw new RangeError('A lava river needs two points and a positive width');
  const samples = [controls[0].clone()];
  const lineTo = (end: THREE.Vector2) => {
    const start = samples[samples.length - 1], steps = Math.max(1, Math.ceil(start.distanceTo(end) / .45));
    for (let step = 1; step <= steps; step++) samples.push(start.clone().lerp(end, step / steps));
  };
  for (let index = 1; index < controls.length - 1; index++) {
    const corner = controls[index], incoming = corner.clone().sub(controls[index - 1]);
    const outgoing = controls[index + 1].clone().sub(corner);
    const trim = Math.min(incoming.length() * .18, outgoing.length() * .18, river.width * .4);
    const entry = corner.clone().addScaledVector(incoming.normalize(), -trim);
    const exit = corner.clone().addScaledVector(outgoing.normalize(), trim);
    lineTo(entry);
    const steps = Math.max(3, Math.ceil(trim * 2 / .3));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, one = 1 - t;
      samples.push(entry.clone().multiplyScalar(one * one).addScaledVector(corner, 2 * one * t).addScaledVector(exit, t * t));
    }
  }
  lineTo(controls[controls.length - 1]);
  return samples;
}

/** One static batch: curved banks, asymmetrical widths and a shallow rounded
 * surface. Texture distance follows the channel rather than restarting at bends. */
export function buildHellRiverGeometry(rivers: readonly HellRiverPath[], floorAt: (x: number, z: number) => number) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (const [riverIndex, river] of rivers.entries()) {
    const samples = sampleHellRiverPath(river), first = positions.length / 3;
    let distance = 0;
    for (let index = 0; index < samples.length; index++) {
      const center = samples[index];
      if (index) distance += center.distanceTo(samples[index - 1]);
      const tangent = samples[Math.min(samples.length - 1, index + 1)].clone()
        .sub(samples[Math.max(0, index - 1)]).normalize();
      const normal = new THREE.Vector2(-tangent.y, tangent.x);
      const baseWidth = river.width * (.54 + .105 * valueNoise(distance * .52 + riverIndex * 31));
      const left = baseWidth * (.94 + .06 * valueNoise(distance * .83 + 13));
      const right = baseWidth * (.94 + .06 * valueNoise(distance * .71 + 53));
      // Coarse terrain facets can rise above an analytical channel edge. Keep
      // each liquid cross-section level and seated above both actual banks.
      const y = Math.max(floorAt(center.x, center.y) + .17,
        floorAt(center.x-normal.x*left,center.y-normal.y*left)+.045,
        floorAt(center.x+normal.x*right,center.y+normal.y*right)+.045);
      for (const side of [-1, 0, 1]) {
        const offset = side * (side < 0 ? left : right);
        const x = center.x + normal.x * offset, z = center.y + normal.y * offset;
        positions.push(x, y + (side === 0 ? .012 : 0), z);
        uv.push(side * .5 + .5, distance / 3);
      }
      if (index < samples.length - 1) for (let across = 0; across < 2; across++) {
        const a = first + index * 3 + across;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometry.userData.curvedChannels = true;
  return geometry;
}

function valueNoise(x: number) {
  const cell = Math.floor(x), fraction = x - cell, smooth = fraction * fraction * (3 - 2 * fraction);
  const hash = (value: number) => { const result = Math.sin(value * 127.1 + 311.7) * 43758.5453; return result - Math.floor(result); };
  return THREE.MathUtils.lerp(hash(cell), hash(cell + 1), smooth);
}
