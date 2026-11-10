/** The approved 5 x 5 metre review area, immediately right of forest arrival. */
export const FOREST_SAMPLE = Object.freeze({ minX: 1.5, maxX: 6.5, minZ: -4.5, maxZ: .5 });

export const SAMPLE_COLONIES = Object.freeze([
  { x: 2.7, z: -3.0, radius: .9 }, { x: 4.7, z: -3.6, radius: .95 },
  { x: 5.6, z: -.6, radius: .85 }, { x: 3.65, z: -1.5, radius: 1.0 }
]);

export function inForestSample(x: number, z: number, inset = 0) {
  return x >= FOREST_SAMPLE.minX + inset && x <= FOREST_SAMPLE.maxX - inset
    && z >= FOREST_SAMPLE.minZ + inset && z <= FOREST_SAMPLE.maxZ - inset;
}

export interface SamplePlacement {
  mesh: string; x: number; z: number; yaw: number; width: number; height?: number;
}

/** A few composed landmarks leave open soil between the planted colonies. */
export const SAMPLE_ROCKS: readonly SamplePlacement[] = [
  { mesh: 'rock_06', x: 5.15, z: -2.65, yaw: .45, width: 1.05 },
  { mesh: 'rock_03', x: 2.45, z: -3.65, yaw: -1.05, width: .58 },
  { mesh: 'pebble_03', x: 5.75, z: -.4, yaw: .6, width: .26 },
  { mesh: 'pebble_03', x: 4.6, z: -3.5, yaw: 1.8, width: .18 },
  { mesh: 'pebble_03', x: 4.35, z: -3.95, yaw: .3, width: .14 },
  { mesh: 'pebble_03', x: 2.2, z: -2.85, yaw: -.8, width: .17 },
  { mesh: 'pebble_03', x: 3.0, z: -.4, yaw: 2.2, width: .15 },
  { mesh: 'pebble_03', x: 5.75, z: -1.2, yaw: -.4, width: .19 }
];

export const SAMPLE_BRANCHES: readonly SamplePlacement[] = [
  { mesh: 'branch_b', x: 4.05, z: -.55, yaw: 1.05, width: .85 },
  { mesh: 'branch_c', x: 2.6, z: -1.35, yaw: -1.15, width: .68 }
];
