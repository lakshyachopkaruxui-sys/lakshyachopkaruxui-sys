import * as THREE from 'three';
import { WORLD_Z } from './worldConstants.js';

// A small, static, non-interactive dressed set glimpsed through World
// Three's final tear: a dim room reminiscent of World One, already showing
// the glowing plant "echo" of World Two — the payoff moment where the
// player realizes the worlds are connected, seen from a distance before
// they ever step through. Deliberately has no tear of its own — it isn't
// meant to be interactive, only recognized.
export class WorldOneEcho {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'WorldOneEcho';
    const z = WORLD_Z.worldOneEchoPreview;
    this.group.position.set(0, 0, z);
    scene.add(this.group);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.9 });

    const size = { w: 4, h: 2.8, d: 4 };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.d), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    const back = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), wallMat);
    back.position.set(0, size.h / 2, -size.d / 2);
    this.group.add(back);

    const ambient = new THREE.HemisphereLight(0x545b66, 0x18191c, 0.4);
    this.group.add(ambient);
    const fixture = new THREE.PointLight(0xcfd6e0, 2.2, 6, 2);
    fixture.position.set(0, size.h - 0.3, 0);
    this.group.add(fixture);

    const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.5, 8);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a7a4a, roughness: 0.7 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(-1.0, 0.25, -0.6);

    const budGeo = new THREE.IcosahedronGeometry(0.09, 1);
    const budMat = new THREE.MeshStandardMaterial({
      color: 0xffd27a,
      emissive: new THREE.Color(0xffb463),
      emissiveIntensity: 1.1,
      roughness: 0.4
    });
    const bud = new THREE.Mesh(budGeo, budMat);
    bud.position.set(-1.0, 0.52, -0.6);

    const glow = new THREE.PointLight(0xffb463, 0.8, 2.4, 2);
    glow.position.copy(bud.position);

    this.group.add(stem, bud, glow);
  }

  update() {
    // static dressing — nothing to animate
  }
}
