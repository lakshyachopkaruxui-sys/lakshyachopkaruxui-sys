import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { mulberry32 } from '../utils/math';

/**
 * Two kinds of particles, rendered in the overlay pass (in front of the portal):
 *  - rip burst: torn fibres / droplets thrown out when the membrane rips
 *  - leak motes: slow warm pollen drifting from World Two into World One
 */
export class TearParticles {
  readonly points: THREE.Points;
  private max = CONFIG.particles.maxRipParticles;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private life: Float32Array; // age, maxAge
  private kind: Uint8Array;   // 0 rip, 1 mote
  private cursor = 0;
  private rng = mulberry32(99);
  private moteAccumulator = 0;
  private tmp = new THREE.Vector3();

  constructor(overlay: THREE.Scene) {
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max * 2);
    this.kind = new Uint8Array(this.max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('life', new THREE.BufferAttribute(this.life, 2));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute vec2 life; varying vec3 vColor; varying float vAlpha;
        void main() {
          float t = life.y > 0.0 ? clamp(life.x / life.y, 0.0, 1.0) : 1.0;
          vAlpha = life.y > 0.0 ? smoothstep(0.0, 0.08, t) * (1.0 - t) : 0.0;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (life.y > 2.0 ? 9.0 : 14.0) / max(-mv.z, 0.05);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          gl_FragColor = vec4(vColor * vAlpha * (1.0 - d * 4.0), 1.0);
        }`
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    overlay.add(this.points);
  }

  private spawn(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, maxAge: number, kind: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.life[i * 2] = 0;
    this.life[i * 2 + 1] = maxAge;
    this.kind[i] = kind;
  }

  burst(tips: THREE.Vector3[], strength: number, normal: THREE.Vector3, color: THREE.Color) {
    const n = Math.round(CONFIG.particles.ripBurst * Math.min(strength, 2) * 0.5);
    const fibre = new THREE.Color(0xe9e0cf);
    for (const tip of tips) {
      for (let k = 0; k < n; k++) {
        const r = this.rng;
        this.tmp.set((r() - 0.5) * 0.8, (r() - 0.5) * 0.8, 0).add(normal.clone().multiplyScalar(0.3 + r() * 0.9)).multiplyScalar(0.4 + strength * 0.5);
        this.spawn(tip, this.tmp, r() < 0.55 ? color : fibre, 0.5 + r() * 1.1, 0);
      }
    }
  }

  update(dt: number, gapCentre: THREE.Vector3, normal: THREE.Vector3, openness: number, color: THREE.Color) {
    this.moteAccumulator += dt * openness * CONFIG.particles.moteRate;
    while (this.moteAccumulator > 1) {
      this.moteAccumulator -= 1;
      const r = this.rng;
      const p = this.tmp.set((r() - 0.5) * 0.25 * openness, (r() - 0.5) * 0.35, 0).add(gapCentre);
      const v = normal.clone().multiplyScalar(0.05 + r() * 0.12).add(new THREE.Vector3((r() - 0.5) * 0.06, 0.02 + r() * 0.04, (r() - 0.5) * 0.06));
      this.spawn(p, v, color, 3.5 + r() * 3, 1);
    }

    for (let i = 0; i < this.max; i++) {
      const maxAge = this.life[i * 2 + 1];
      if (maxAge <= 0) continue;
      const age = (this.life[i * 2] += dt);
      if (age >= maxAge) {
        this.life[i * 2 + 1] = 0;
        continue;
      }
      const j = i * 3;
      if (this.kind[i] === 0) {
        this.vel[j + 1] -= 1.6 * dt;
        const drag = Math.exp(-2.5 * dt);
        this.vel[j] *= drag; this.vel[j + 1] *= drag; this.vel[j + 2] *= drag;
      } else {
        this.vel[j] += Math.sin(age * 1.7 + i) * 0.02 * dt;
        this.vel[j + 1] += Math.cos(age * 1.3 + i) * 0.015 * dt;
      }
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.life.needsUpdate = true;
  }
}
