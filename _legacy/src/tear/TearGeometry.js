import * as THREE from 'three';
import { computeTearBoundary } from './organicBoundary.js';

// Builds the veil's front-surface geometry: an outer rectangle (the wall)
// with the irregular tear polygon cut out of it as a literal hole via
// THREE.Shape.holes. Because the hole is REAL geometry (not a stencil mask
// or a texture trick), whatever sits behind the veil is seen through it
// with correct, free depth-tested parallax as the viewer's head moves —
// see the "Portal rendering strategy" note in the README for the full
// stencil-vs-geometric-hole comparison and why this was chosen.
//
// PERFORMANCE NOTE: this rebuilds (triangulates + disposes) the geometry
// every frame the tear is open, rather than mutating a persistent
// BufferGeometry in place. For a ~90-point polygon this is a few KB of
// short-lived typed arrays per frame — cheap on desktop, but NOT verified
// on real Quest 3 hardware (no headset was available to profile against).
// If on-device profiling shows GC/frame-time pressure from this, the fix
// is to preallocate fixed-size typed arrays sized for the max segment
// count and update them in place instead of calling `new ShapeGeometry()`
// here every frame.
export class TearGeometry {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.mesh = new THREE.Mesh(this._buildGeometry(null), null);
    this.mesh.matrixAutoUpdate = true;
    this._lastBoundary = null;
  }

  _buildGeometry(boundaryPoints) {
    const hw = this.width / 2;
    const hh = this.height / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();

    if (boundaryPoints && boundaryPoints.length > 2) {
      const hole = new THREE.Path();
      hole.moveTo(boundaryPoints[0].x, boundaryPoints[0].y);
      for (let i = 1; i < boundaryPoints.length; i++) {
        hole.lineTo(boundaryPoints[i].x, boundaryPoints[i].y);
      }
      hole.closePath();
      shape.holes.push(hole);
    }

    return new THREE.ShapeGeometry(shape, 1);
  }

  /** @returns {{x:number,y:number}[]|null} the boundary used this frame, for reuse by TearEdgeGeometry */
  update(signal, timeSeed) {
    const oldGeometry = this.mesh.geometry;

    if (signal.openAmount > 0.003) {
      const boundary = computeTearBoundary(signal, 44, timeSeed);
      this.mesh.geometry = this._buildGeometry(boundary);
      this._lastBoundary = boundary;
    } else {
      this.mesh.geometry = this._buildGeometry(null);
      this._lastBoundary = null;
    }

    if (oldGeometry) oldGeometry.dispose();
    return this._lastBoundary;
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}
