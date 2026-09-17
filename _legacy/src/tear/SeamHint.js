import * as THREE from 'three';
import { createCrackHintTexture } from '../utils/proceduralTextures.js';

// The pre-interaction "strange visual seam" (brief's Stage One / "the
// environment should contain a strange visual seam... attract attention
// through subtle movement... tiny amount of light should leak through").
// Lives at the veil's seed point and fades out once the real tear
// geometry (TearVeil) takes over visually.
export class SeamHint {
  constructor(veilAnchor, seedLocal, leakColor) {
    const texture = createCrackHintTexture(256);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      color: leakColor,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), material);
    this.mesh.position.set(seedLocal.x, seedLocal.y + 0.15, 0.002);
    veilAnchor.add(this.mesh);

    this.light = new THREE.PointLight(leakColor, 0, 1.2);
    this.light.position.set(seedLocal.x, seedLocal.y, 0.05);
    veilAnchor.add(this.light);

    this._t = Math.random() * 10;
  }

  update(dt, openAmount) {
    this._t += dt;
    const fade = 1 - THREE.MathUtils.smoothstep(openAmount, 0.0, 0.05);
    const flicker = 0.55 + Math.sin(this._t * 2.3) * 0.25 + Math.sin(this._t * 5.1) * 0.15;
    this.mesh.material.opacity = fade * (0.35 + flicker * 0.25);
    this.light.intensity = fade * flicker * 0.06;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.map.dispose();
    this.mesh.material.dispose();
  }
}
