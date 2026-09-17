import * as THREE from 'three';
import { TearGeometry } from './TearGeometry.js';
import { TearMaterial } from './TearMaterial.js';
import { TearEdgeGeometry } from './TearEdgeGeometry.js';
import { TearEdgeMaterial } from './TearEdgeMaterial.js';
import { LightLeakSystem } from '../lighting/LightLeakSystem.js';
import { ParticleManager } from '../particles/ParticleManager.js';

// Composes the two visual pieces of the tear (front wall-with-hole, and
// the curled edge ribbon) onto a shared veil anchor Object3D. The anchor
// itself is what TwoHandTearController projects hand positions into (its
// local XY is the tear plane) and what world content sits behind, in -Z.
export class TearVeil {
  constructor(veilAnchor, { width, height, baseColor, edgeColor }) {
    this.veilAnchor = veilAnchor;

    this.geometry = new TearGeometry(width, height);
    this.material = new TearMaterial(baseColor);
    this.geometry.mesh.material = this.material.material;
    this.geometry.mesh.renderOrder = 0;

    this.edgeGeometry = new TearEdgeGeometry(44);
    this.edgeMaterial = new TearEdgeMaterial(edgeColor);
    this.edgeGeometry.mesh.material = this.edgeMaterial.material;
    this.edgeGeometry.mesh.renderOrder = 1;

    veilAnchor.add(this.geometry.mesh, this.edgeGeometry.mesh);

    this.lightLeak = new LightLeakSystem(veilAnchor, edgeColor);
    this.particles = new ParticleManager(veilAnchor, edgeColor.clone(), 70);

    this._timeSeed = Math.random() * 1000;
  }

  update(dt, signal, { camera, leakColor, leakStrength }) {
    this._timeSeed += dt;
    const boundary = this.geometry.update(signal, this._timeSeed);
    this.edgeGeometry.update(boundary, signal, this._timeSeed);
    this.material.update(dt, signal, { camera, leakColor, leakStrength });
    this.lightLeak.update(dt, signal, leakColor);
    if (leakColor) this.particles.setColor(leakColor);
    this.particles.update(dt, signal);
  }

  dispose() {
    this.geometry.dispose();
    this.material.material.dispose();
    this.edgeGeometry.geometry.dispose();
    this.edgeMaterial.material.dispose();
  }
}
