import * as THREE from 'three';
import { createFibreFringeTexture } from '../utils/proceduralTextures.js';

// Torn-fibre look for the curled edge ribbon: a procedurally generated
// alpha fringe (solid near the outer/intact edge, ragged near the
// inner/torn edge) on a standard lit material so it picks up scene
// lighting and the world-two light leak like any other surface.
export class TearEdgeMaterial {
  constructor(baseColor = new THREE.Color(0x7d6b4f)) {
    const fringeTex = createFibreFringeTexture(128);
    fringeTex.repeat.set(10, 1);

    this.material = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.88,
      metalness: 0.0,
      alphaMap: fringeTex,
      transparent: true,
      side: THREE.DoubleSide
    });
  }
}
