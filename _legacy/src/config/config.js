// Central tunable configuration. Every "magic number" that shapes feel or
// behavior should live here, not scattered through the systems that use it.

export const CONFIG = {
  render: {
    pixelRatioCap: 1.5,          // caps devicePixelRatio for XR frame budget
    fogNear: 4,
    fogFar: 40,
    antialias: true
  },

  pinch: {
    // Distance (meters) between thumb-tip and index-finger-tip joints.
    engageThreshold: 0.025,      // pinch "on" below this distance
    releaseThreshold: 0.038,     // pinch "off" above this distance (hysteresis)
    maxValidJointJump: 0.35,     // meters/frame — beyond this, treat as bad tracking data
    missingHandGraceMs: 350      // how long a hand may vanish before we treat it as gone
  },

  smoothing: {
    // These are exponential-decay rate constants (1/seconds) fed into
    // utils/math.js:damp(), not 0..1 blend factors — higher = snappier.
    // A rate of ~24 reaches ~90% of the way to target in ~100ms.
    handPositionDamping: 24,
    velocityDamping: 8,
    tearSizeDamping: 10
  },

  tear: {
    engageProximity: 0.55,       // meters — how close both hands must be to the veil plane to engage it
    minGap: 0.0,                 // meters, both-pinch distance at which tear = 0
    maxGap: 0.9,                 // meters, both-pinch distance at which tear = 1 (fully open)
    resistanceCurve: 2.2,        // exponent — higher = resistance ramps up faster near full open
    velocityEnergyScale: 3.0,    // hand speed -> "violence" of the tear (affects wrinkle/particle intensity)
    directionBlend: 0.08,        // how quickly tear orientation follows current pull direction
    stages: [0.02, 0.12, 0.32, 0.62, 0.88] // normalized thresholds for stage 1..5 (see WorldManager/PortalState)
  },

  healing: {
    startDelayMs: 220,           // brief suspended moment before healing accelerates
    baseRate: 0.12,              // fraction of opening healed per second, after the delay ramps in
    accelerate: 1.6              // multiplier applied to baseRate as healing progresses
  },

  haptics: {
    enabled: true,
    tearBeginPulse: { intensity: 0.3, durationMs: 40 },
    nearBreakthroughPulse: { intensity: 0.55, durationMs: 90 },
    breakthroughPulse: { intensity: 0.9, durationMs: 140 }
    // NOTE: only physical XR controllers expose hapticActuators. Bare-hand
    // tracking has no vibration hardware, so these are no-ops in pure
    // hand-tracking mode and only fire if a controller input source is active.
  },

  particles: {
    maxFibres: 220,
    maxLeakageParticles: 400,
    spawnPerTearEnergy: 40        // particles/sec scaled by current tear velocity energy
  },

  audio: {
    masterGain: 0.9,
    tearGain: 0.8,
    worldLeakGain: 0.7,
    musicGain: 0.25
  },

  worlds: {
    transitionFadeMs: 600,
    maxLoadedWorlds: 3,
    commitHoldSeconds: 1.1,   // how long the tear must stay fully-open+held to commit to stepping through
    peekLoadStage: 2          // tear stage at which the next world's content is built, so it's ready to be glimpsed
  },

  desktopFallback: {
    handPlaneDepth: -0.6,         // meters in front of camera where simulated hands live
    keyboardMoveSpeed: 0.9,       // m/s for keyboard-driven (left) hand
    mouseSensitivity: 0.0016
  },

  debug: {
    defaultEnabled: false,
    keyToggle: 'F2'
  }
};
