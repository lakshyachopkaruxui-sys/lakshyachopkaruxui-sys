// Every tunable number in the experience lives here.
// Units: metres, seconds, Hz unless noted.

export const CONFIG = {
  render: {
    pixelRatioCap: 1.5,
    xrFramebufferScale: 1.0,
    xrFoveation: 1.0,
    shadows: true,               // one tight shadow map in the outdoor worlds
    shadowMapSize: 1024,
    shadowsInXR: false           // headset frame rate matters more than shadows
  },

  pinch: {
    engageDistance: 0.018,     // thumb-tip ↔ index-tip distance that starts a pinch
    releaseDistance: 0.035,    // must open wider than this to release (hysteresis)
    maxJumpPerFrame: 0.25,     // raw joint jumps larger than this are ignored as tracking noise
    lostGraceSeconds: 0.3,     // a hand may vanish this long without releasing its grip
    filterMinCutoff: 1.2,      // One-Euro filter: jitter removal at rest
    filterBeta: 8.0,           // One-Euro filter: responsiveness when moving fast
    velocitySmoothing: 12      // exponential rate for velocity / acceleration estimates
  },

  tear: {
    height: 1.35,              // centre of the seam above the floor
    distance: 1.1,             // seam distance in front of the starting position
    xrDistance: 0.65,          // closer initial reach in XR; desktop placement stays unchanged
    membraneWidth: 1.4,
    membraneHeight: 1.6,
    gridSegments: 150,
    seamLength: 0.52,          // visible scar before anything is torn
    captureRadius: 0.22,       // how close a pinch must be to the membrane/seam to grab it
    xrPullGain: 1.22,          // XY tear response in XR: about 18% less hand travel, still requires a pull
    gripFalloffAlong: 0.32,    // how far along the crack a grip drags material
    gripFalloffAcross: 0.2,    // how far away from the crack a grip drags material
    openingPerCrackLength: 0.9,// max gap a crack of half-length L allows: L * this
    firstYield: 0.07,          // extra strain (m) needed for the very first rip (breakthrough)
    yield: 0.035,              // strain (m) needed for each further rip
    ripStep: 0.035,            // crack growth per rip (m)
    ripCooldown: 0.14,         // minimum pause between rips — the "stick" in stick-slip (s)
    velocitySensitivity: 0.6,  // hand speed (m/s) → energy
    accelerationSensitivity: 0.05,
    maxCrackHalfLength: 0.55,
    minCrackHalfLength: 0.0,
    fullyOpenGap: 0.55,        // gap (m) that counts as fully open
    edgeCurl: 0.05,
    strainWrinkle: 0.012
  },

  healing: {
    suspendSeconds: 0.6,       // pause after release before healing begins
    edgeRelaxStart: 0.18,      // how fast released edges drift back at first (1/s)
    edgeRelaxAcceleration: 0.7,// how quickly that drift speeds up (1/s²)
    crackBaseRate: 0.015,      // crack half-length healed per second at start
    crackAcceleration: 0.09    // extra heal rate gained per second of healing
  },

  light: {
    maxIntensity: 9,
    spillDistance: 5,
    idleGlow: 0.25
  },

  particles: {
    maxRipParticles: 600,
    ripBurst: 32,
    moteRate: 7,               // leak motes per second at full opening
    fibresPerEdge: 90
  },

  audio: {
    master: 0.9,
    leakClosedGain: 0.035,     // how much World Two is audible through the closed seam
    leakClosedCutoff: 420,
    leakOpenCutoff: 18000,
    tearGain: 0.9,
    leanNearDistance: 0.35,    // head this close to the tear → full whisper detail
    leanFarDistance: 0.95
  },

  worlds: {
    fullyOpenHoldSeconds: 1.2,     // headset: hold it fully open this long to step through
    desktopAutoStepSeconds: 4.5,   // desktop: Space steps through; this is only the fallback
    spaceStepFraction: 0.75        // Space works once the gap is this share of "fully open"
  },

  desktop: {
    moveSpeed: 1.4,
    lookSensitivity: 0.0025,
    dragToMetres: 0.0016,
    keyPullSpeed: 0.28,          // m/s each hand moves outward while D / → is held
    keyPullSpeedHard: 0.75,      // with Shift: faster pull = more violent tear
    maxSpread: 0.9,
    jumpSpeed: 4.2,              // m/s upward — about a 0.9 m jump
    gravity: 9.8,
    wheelToMetres: 0.0006,
    eyeHeight: 1.55
  },

  debug: {
    enabledByDefault: false
  }
} as const;
