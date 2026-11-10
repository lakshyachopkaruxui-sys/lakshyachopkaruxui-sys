import * as THREE from 'three';
import { FOREST_SAMPLE, inForestSample } from './ForestSampleLayout';

/** Grass occupies every dry part of the forest, including the arrival and old
 * trail. Only water and the outer terrain boundary exclude living cover. */
export function forestCoverAt(x: number, z: number, margin = 0) {
  const pond = Math.hypot((x - 5) / (2.7 + margin), (z + 9) / (4.5 + margin));
  return THREE.MathUtils.smoothstep(pond, 1.0, 1.12)
    * (1 - THREE.MathUtils.smoothstep(Math.hypot(x, z + 4), 48, 53));
}

/** Preserve existing solid-object and terrain placement. This is deliberately
 * separate from vegetation: non-colliding grass does not need a walking lane. */
export function forestObjectClearanceAt(x: number, z: number, margin = 0) {
  const pond = Math.hypot((x - 5) / (2.7 + margin), (z + 9) / (4.5 + margin));
  const trail = Math.abs(x - Math.sin(z * .15) * 1.25);
  return THREE.MathUtils.smoothstep(Math.hypot(x, z), 2.3 + margin, 2.8 + margin)
    * THREE.MathUtils.smoothstep(trail, .85 + margin, 1.35 + margin)
    * THREE.MathUtils.smoothstep(pond, 1.02, 1.24)
    * THREE.MathUtils.smoothstep(Math.hypot(x + 1.7, z + 4.8), 1.25 + margin, 1.65 + margin)
    * (1 - THREE.MathUtils.smoothstep(Math.hypot(x, z + 4), 48, 53));
}

/** Low soil deposits use the same ground mesh queried by feet and plant roots. */
export function forestOrganicRelief(x: number, z: number) {
  if (inForestSample(x, z)) return 0;
  const dx = Math.max(FOREST_SAMPLE.minX - x, 0, x - FOREST_SAMPLE.maxX);
  const dz = Math.max(FOREST_SAMPLE.minZ - z, 0, z - FOREST_SAMPLE.maxZ);
  const patchEdge = THREE.MathUtils.smoothstep(Math.hypot(dx, dz), 0, .65);
  const deposits = .5 + .25 * Math.sin(x * 2.1 + Math.sin(z * .8)) + .25 * Math.cos(z * 2.3 - x * .6);
  return forestObjectClearanceAt(x, z) * patchEdge * (.014 + .085 * deposits * deposits);
}
