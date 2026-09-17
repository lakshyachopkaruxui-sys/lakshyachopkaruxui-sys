import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uStress;
  uniform vec2 uCenter;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vLocalPos;

  void main() {
    vec3 pos = position;
    float distToCenter = length(pos.xy - uCenter);

    // Stylized wrinkle/strain displacement — NOT a physical cloth
    // simulation, a cheap shader approximation of "the surface visibly
    // strains" called for in the brief.
    float wrinkle =
      sin(distToCenter * 18.0 - uTime * 2.0) * 0.0035 * uStress +
      sin(pos.x * 9.0 + pos.y * 7.0 + uTime * 1.3) * 0.0022 * uStress;
    pos.z += wrinkle;

    vLocalPos = pos.xy;
    vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPosition.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec2 uCenter;
  uniform float uA;
  uniform float uB;
  uniform float uDirAngle;
  uniform vec3 uBaseColor;
  uniform vec3 uLeakColor;
  uniform float uLeakStrength;
  uniform vec3 uCameraPos;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vLocalPos;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 rel = vLocalPos - uCenter;
    float ca = cos(-uDirAngle);
    float sa = sin(-uDirAngle);
    vec2 rot = vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);
    float ellipseDist = length(vec2(rot.x / max(uA, 0.001), rot.y / max(uB, 0.001)));

    float grain = (hash(floor(vLocalPos * 14.0)) - 0.5) * 0.018;
    vec3 paperColor = uBaseColor + grain;

    float edgeBand = smoothstep(1.35, 0.8, ellipseDist); // 0 far from hole, 1 right at its edge
    vec3 wetColor = mix(paperColor, paperColor * 0.35, edgeBand * 0.85);

    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0), 2.5);
    vec3 sheen = wetColor + fresnel * 0.12 * edgeBand;

    vec3 leaked = sheen + uLeakColor * uLeakStrength * edgeBand;

    gl_FragColor = vec4(leaked, 1.0);
  }
`;

// Stylized "wet paper" material for the veil's front surface: procedural
// grain (no texture file), a darkened/wet band near the tear edge, a
// fresnel sheen, and world-two light bleeding into that band. All driven
// by uniforms so it needs no re-allocation as the tear changes shape.
export class TearMaterial {
  constructor(baseColor = new THREE.Color(0x9c8f7a)) {
    this.uniforms = {
      uTime: { value: 0 },
      uStress: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uA: { value: 0.001 },
      uB: { value: 0.001 },
      uDirAngle: { value: 0 },
      uBaseColor: { value: baseColor },
      uLeakColor: { value: new THREE.Color(0xffffff) },
      uLeakStrength: { value: 0 },
      uCameraPos: { value: new THREE.Vector3() }
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      side: THREE.DoubleSide
    });

    this._tmpCamWorld = new THREE.Vector3();
  }

  update(dt, signal, { leakColor, leakStrength, camera }) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uStress.value = signal.stress;
    this.uniforms.uCenter.value.copy(signal.centerLocal);
    this.uniforms.uDirAngle.value = signal.directionAngle;

    const a = THREE.MathUtils.lerp(0.006, 0.62 * 0.9, signal.openAmount);
    const b = THREE.MathUtils.lerp(0.004, 0.38 * 0.9, signal.openAmount);
    this.uniforms.uA.value = a;
    this.uniforms.uB.value = b;

    this.uniforms.uLeakColor.value.copy(leakColor);
    this.uniforms.uLeakStrength.value = leakStrength;

    // World-space, to match vWorldPos in the fragment shader (both derive
    // from modelMatrix, not the veil's local space).
    camera.getWorldPosition(this._tmpCamWorld);
    this.uniforms.uCameraPos.value.copy(this._tmpCamWorld);
  }
}
