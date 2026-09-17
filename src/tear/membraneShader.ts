// GLSL for the torn membrane. The SAME vertex deformation is used by the
// visible paper, the stencil mask and the depth reset, so the portal hole
// always matches the visible torn edge exactly.

export const MEMBRANE_VERTEX = /* glsl */ `
#define MAX_POINTS 32
uniform vec3 uCrack[MAX_POINTS];
uniform int uCrackCount;
uniform float uTornA;
uniform float uTornB;
uniform vec4 uGripMat[2];   // xy material point, z side, w weight
uniform float uGripArc[2];
uniform vec3 uGripDisp[2];
uniform float uStrain;
uniform float uEnergy;
uniform float uTime;
uniform float uFallAlong;
uniform float uFallAcross;
uniform float uEdgeCurl;
uniform float uWrinkle;
uniform float uCell;
uniform vec2 uSize;

varying float vDs;
varying float vTorn;
varying float vArc;
varying float vDist;
varying float vStretch;
varying vec2 vRest;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float noise1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash1(i), hash1(i + 1.0), f); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

void crackQuery(vec2 p, out float dist, out float side, out float arc) {
  dist = 1e9; side = 1.0; arc = 0.0;
  for (int i = 0; i < MAX_POINTS - 1; i++) {
    if (i >= uCrackCount - 1) break;
    vec2 a = uCrack[i].xy;
    vec2 ab = uCrack[i + 1].xy - a;
    float len2 = max(dot(ab, ab), 1e-8);
    float tRaw = dot(p - a, ab) / len2;
    float t = clamp(tRaw, 0.0, 1.0);
    float d = length(p - (a + ab * t));
    if (d < dist) {
      dist = d;
      side = (ab.x * (p.y - a.y) - ab.y * (p.x - a.x)) >= 0.0 ? 1.0 : -1.0;
      bool extend = (i == 0 && tRaw < 0.0) || (i == uCrackCount - 2 && tRaw > 1.0);
      arc = uCrack[i].z + (extend ? tRaw : t) * sqrt(len2);
    }
  }
}

float tornFactor(float arc) {
  float taper = 0.05;
  float a = smoothstep(-uTornA - taper, -uTornA + 0.01, arc);
  float b = 1.0 - smoothstep(uTornB - 0.01, uTornB + taper, arc);
  return a * b * smoothstep(0.0, 0.03, uTornA + uTornB);
}

vec3 displacement(vec2 p, out float ds, out float torn, out float arc, out float dist, out float stretch) {
  float side;
  crackQuery(p, dist, side, arc);
  ds = side * dist;
  torn = tornFactor(arc);
  float pin = smoothstep(0.0, 0.22, uSize.x * 0.5 - abs(p.x)) * smoothstep(0.0, 0.22, uSize.y * 0.5 - abs(p.y));
  vec3 d = vec3(0.0);
  stretch = 0.0;
  for (int h = 0; h < 2; h++) {
    vec4 g = uGripMat[h];
    if (g.w <= 0.0) continue;
    vec2 dm = p - g.xy;
    float wIso = exp(-dot(dm, dm) / (uFallAcross * uFallAcross));
    float sameSide = step(0.0, ds * g.z);
    float da = arc - uGripArc[h];
    // Uneven along the crack, so the opening is an irregular torn shape
    // rather than a clean symmetric lens.
    float ragged = 0.72 + 0.56 * noise1(arc * 6.0 + 3.1) * (0.6 + 0.4 * noise1(arc * 17.0));
    float wLens = ragged * torn * sameSide * exp(-da * da / (uFallAlong * uFallAlong)) * exp(-dist * dist / (uFallAcross * uFallAcross * 0.5));
    float w = max(wIso, wLens) * (1.0 - torn * (1.0 - sameSide));
    d += uGripDisp[h] * w * g.w * pin;
    stretch += length(uGripDisp[h]) * w * g.w;
  }
  float strainAmt = clamp(uStrain * 12.0 + stretch * 0.6, 0.0, 1.5);
  d.z += uWrinkle * strainAmt * sin(arc * 150.0 + noise1(arc * 20.0) * 3.0 + ds * 30.0) * exp(-dist * dist / 0.02) * (1.0 - torn * 0.7) * pin;
  float edge = torn * exp(-dist * dist / (0.03 * 0.03));
  d.z += uEdgeCurl * edge * min(stretch * 3.0, 1.0) * (0.6 + 0.4 * noise1(arc * 25.0));
  d.z += uEnergy * 0.014 * (noise2(p * 7.0 + uTime * 5.0) - 0.5) * pin;
  d.z += 0.003 * sin(uTime * 0.8 + p.y * 4.0) * sin(uTime * 0.53 + p.x * 3.0) * pin;
  return d;
}

void main() {
  vec2 p = position.xy;
  float ds, torn, arc, dist, stretch;
  float t1, t2, t3, t4, t5;
  vec3 d0 = displacement(p, ds, torn, arc, dist, stretch);
  vec3 dx = displacement(p + vec2(uCell, 0.0), t1, t2, t3, t4, t5);
  vec3 dy = displacement(p + vec2(0.0, uCell), t1, t2, t3, t4, t5);
  vec3 P0 = vec3(p, 0.0) + d0;
  vec3 Px = vec3(p + vec2(uCell, 0.0), 0.0) + dx;
  vec3 Py = vec3(p + vec2(0.0, uCell), 0.0) + dy;
  vec3 n = normalize(cross(Px - P0, Py - P0));

  vDs = ds; vTorn = torn; vArc = arc; vDist = dist; vStretch = stretch; vRest = p;
  vec4 world = modelMatrix * vec4(P0, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const MEMBRANE_FRAGMENT = /* glsl */ `
uniform float uCell;
uniform float uOpen;
uniform float uTime;
uniform float uIdleGlow;
uniform float uArcA;
uniform float uArcB;
uniform vec2 uSize;
uniform vec3 uPaperColor;
uniform vec3 uLeakColor;
uniform vec3 uAmbient;

varying float vDs;
varying float vTorn;
varying float vArc;
varying float vDist;
varying float vStretch;
varying vec2 vRest;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float noise1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash1(i), hash1(i + 1.0), f); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  float edgeNoise = noise1(vArc * 70.0) * 0.7 + noise1(vArc * 230.0) * 0.3;
  float eps = uCell * (0.55 + 0.9 * edgeNoise);
  bool hole = vTorn > 0.5 && abs(vDs) < eps;

#if defined(MASK_MODE) || defined(DEPTH_RESET)
  if (!hole) discard;
  gl_FragColor = vec4(1.0);
  #ifdef DEPTH_RESET
  gl_FragDepth = 1.0;
  #endif
#else
  if (hole) discard;

  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  if (dot(N, V) < 0.0) N = -N;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  float edgeDist = max(abs(vDs) - eps, 0.0);
  float rim = vTorn * exp(-edgeDist * edgeDist / (0.014 * 0.014));
  float fibres = noise2(vec2(vArc * 380.0, edgeDist * 90.0));
  rim *= 0.55 + 0.45 * smoothstep(0.25, 0.8, fibres);
  float stretchVis = smoothstep(0.004, 0.07, vStretch);

  float scarMask = smoothstep(-uArcA - 0.01, -uArcA + 0.04, vArc) * (1.0 - smoothstep(uArcB - 0.04, uArcB + 0.01, vArc));
  float intact = (1.0 - vTorn) * scarMask;

  // The unopened seam has to read as a crack in the air against ANY background,
  // bright forest or dark room. A glow alone vanishes on a light background, so
  // it is built from three parts: a dark fracture that darkens whatever is
  // behind it, a thin luminous core, and a few hairline branches.
  float widthNoise = 0.75 + 0.5 * noise1(vArc * 38.0);
  float darkW = 0.0075 * widthNoise;
  float dark = exp(-vDist * vDist / (darkW * darkW)) * intact;
  float core = exp(-vDist * vDist / (0.0042 * 0.0042)) * intact;
  // Hairline branches, and a wider halo that separates the crack from a bright
  // background the way a shadow separates an object from a white wall.
  float branch = smoothstep(0.58, 0.96, noise1(vArc * 95.0)) * exp(-vDist * vDist / (0.022 * 0.022)) * intact;
  float halo = exp(-vDist * vDist / (0.035 * 0.035)) * intact;
  float scar = core;
  float haze = exp(-vDist * vDist / (0.045 * 0.045)) * scarMask;

  vec3 L = normalize(vec3(-0.3, 0.8, 0.5));
  float diff = 0.45 + 0.55 * max(dot(N, L), 0.0);
  vec3 Hh = normalize(L + V);
  float spec = pow(max(dot(N, Hh), 0.0), 70.0) * 0.7;

  vec3 paper = uPaperColor * (uAmbient * 0.7 + diff * 0.45) * (0.85 + 0.3 * fibres);
  float back = rim * 1.3 + stretchVis * 0.2 + haze * 0.15;
  vec3 col = paper + vec3(spec) + uLeakColor * back * (0.3 + uOpen * 1.6);
  col *= 1.0 - 0.5 * vTorn * exp(-edgeDist * edgeDist / (0.003 * 0.003));
  float pulse = 0.75 + 0.25 * sin(uTime * 1.3) * sin(uTime * 0.37 + 1.0);
  col += uLeakColor * scar * uIdleGlow * pulse * 2.0;

  float pin = smoothstep(0.0, 0.2, uSize.x * 0.5 - abs(vRest.x)) * smoothstep(0.0, 0.2, uSize.y * 0.5 - abs(vRest.y));
  // Keep the visible film tight around the torn edge: further out it should
  // read as a faint shimmer in the air, not a grey shroud around the hole.
  float nearEdge = exp(-edgeDist * edgeDist / (0.09 * 0.09));
  float alpha = rim * 0.95 + stretchVis * nearEdge * (0.16 + fres * 0.25 + spec) + haze * 0.05 * (0.6 + pulse * 0.4);
  alpha = clamp(alpha, 0.0, 1.0) * pin;

  // Composite the crack on top, so it stays readable whatever is behind it.
  float breathe = 0.72 + 0.28 * sin(uTime * 1.6) * sin(uTime * 0.41 + 1.0);
  // Three layers: a soft dark halo, an almost-black fracture, a bright core.
  float seamAlpha = clamp(halo * 0.26 + dark * 0.82 + branch * 0.26 + core * 0.9, 0.0, 1.0) * pin;
  vec3 seamDark = vec3(0.012, 0.013, 0.028);
  // The light of the other world, seen through the width of a hair.
  float coreLight = smoothstep(0.25, 0.95, core) * (0.55 + 0.45 * breathe);
  vec3 seamCol = mix(seamDark, uLeakColor * 4.0, coreLight);
  col = mix(col, seamCol, clamp(seamAlpha * 1.15, 0.0, 1.0));
  alpha = max(alpha, seamAlpha);

  if (alpha < 0.003) discard;
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}
`;
