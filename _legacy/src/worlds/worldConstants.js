// Single shared coordinate line for the whole experience. Rather than
// scattering unrelated worlds far apart in the scene (which would force a
// render-target/stencil portal to fake what's "through" a tear), every
// world's content is real, continuous geometry positioned directly behind
// the wall that reveals it — see README "Portal rendering strategy" for
// why this matters for true parallax. World-to-world TRAVEL still uses a
// comfortable fade-cut (WorldTransition), it just means the destination
// the player cuts to is a spawn point a little further down this same
// line, already-built and already glimpsed through the hole.
//
// Spawn-to-wall distance is deliberately short (a comfortable few real
// steps) so a real VR user can reach the seam by simply walking within a
// typical room-scale guardian boundary — no artificial locomotion needed.
export const WORLD_Z = {
  worldOneSpawn: 1.2,
  worldOneFrontWall: 2.4,  // wall behind the player
  worldOneWall: -1.8,      // the tear wall

  worldTwoSpawn: -4.8,
  worldTwoWall: -28,       // the split tree / rock that tears open to World Three

  worldThreeSpawn: -31,
  worldThreeWall: -60,     // the impossible surface that tears back to World One

  worldOneEchoPreview: -66 // static dressed set glimpsed through the final tear
};

export const ROOM = {
  width: 4,
  height: 2.8,
  wallWidth: 2.6,
  wallHeight: 2.0
};
