/** Stable world IDs. Journey order is deliberately independent of array order. */
export const WORLD_NAMES = [
  'Did I Wake Up?',
  'Is This Finally Real?',
  'How Am I Breathing?',
  "Something Knows I'm Here"
] as const;

export const WORLD = { ROOM: 0, FOREST: 1, OCEAN: 2, SHADOW: 3 } as const;
/** Room → ocean → shadow → forest → the same room, in both interaction modes. */
export const JOURNEY = [WORLD.ROOM, WORLD.OCEAN, WORLD.SHADOW, WORLD.FOREST, WORLD.ROOM] as const;
export const NEXT_WORLD = [WORLD.OCEAN, WORLD.ROOM, WORLD.SHADOW, WORLD.FOREST] as const;
