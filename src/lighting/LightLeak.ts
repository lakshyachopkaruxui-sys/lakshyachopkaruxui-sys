import * as THREE from 'three';
import { CONFIG } from '../config/config';
import { damp } from '../utils/math';

/**
 * Light from the inner world spilling into the outer world through the tear.
 * Intensity, cone width and the soft light shaft all follow the opening size;
 * colour always comes from the inner world.
 */
export class LightLeak {
  private spot: THREE.SpotLight;
  private glow: THREE.PointLight;
  private shaft: THREE.Mesh;
  private shaftMat: THREE.ShaderMaterial;
  private level = 0;

  constructor(anchor: THREE.Object3D, color: THREE.Color) {
    this.spot = new THREE.SpotLight(color, 0, CONFIG.light.spillDistance, 0.6, 0.85, 1.4);
    this.spot.position.set(0, 0, -0.08);
    this.spot.target.position.set(0, -0.9, 3);
    anchor.add(this.spot, this.spot.target);

    this.glow = new THREE.PointLight(color, 0, 2.2, 1.6);
    this.glow.position.set(0, 0, 0.08);
    anchor.add(this.glow);

    const geo = new THREE.ConeGeometry(0.9, 3, 32, 1, true);
    geo.translate(0, -1.5, 0);
    geo.rotateX(-Math.PI / 2);
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: color.clone() }, uLevel: { value: 0 } },
      vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uLevel; varying vec3 vPos;
        void main(){
          float along = clamp(vPos.z / 3.0, 0.0, 1.0);
          float fade = (1.0 - along) * (1.0 - along) * smoothstep(0.0, 0.08, along);
          gl_FragColor = vec4(uColor * fade * uLevel * 0.22, 1.0);
        }`
    });
    this.shaft = new THREE.Mesh(geo, this.shaftMat);
    this.shaft.scale.setScalar(0.001);
    this.shaft.renderOrder = 11;
    anchor.add(this.shaft);
  }

  update(dt: number, openness: number, crackOpenness: number, color: THREE.Color) {
    const target = Math.pow(openness, 0.8) + crackOpenness * 0.08;
    this.level = damp(this.level, target, 6, dt);
    const L = this.level;
    this.spot.color.copy(color);
    this.glow.color.copy(color);
    (this.shaftMat.uniforms.uColor.value as THREE.Color).copy(color);
    this.spot.intensity = CONFIG.light.maxIntensity * L;
    this.spot.angle = 0.45 + 0.6 * L;
    this.glow.intensity = CONFIG.light.idleGlow * 0.6 + 3 * L;
    this.shaftMat.uniforms.uLevel.value = L;
    const w = 0.05 + L * 0.9;
    this.shaft.scale.set(w, w * 0.8, 1);
    this.shaft.visible = L > 0.01;
  }
}
