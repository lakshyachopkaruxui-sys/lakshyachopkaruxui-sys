import * as THREE from 'three';
import { TearVeil } from '../tear/TearVeil.js';
import { SeamHint } from '../tear/SeamHint.js';
import { WORLD_Z } from './worldConstants.js';

// Art-direction assumption: World Three should "break visual expectations"
// (brief) — cold violet/magenta palette (contrasting both One's cool-grey
// and Two's warm-gold), floating disconnected platforms instead of a
// continuous ground (an "impossible gravity" cue), and large slow-rotating
// oversized geometry rather than anything naturalistic. Small debris drifts
// UPWARD rather than falling, reinforcing the inverted-gravity read.
const PLATFORM_Y = 0;

export class WorldThree {
  constructor(scene, { audio = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'WorldThree';
    scene.add(this.group);

    this._buildPlatforms();
    this._buildImpossibleStructures();
    this._buildLighting();
    this._buildDebris();

    this.veilAnchor = new THREE.Object3D();
    this.veilAnchor.position.set(0, 1.6, WORLD_Z.worldThreeWall);
    this.group.add(this.veilAnchor);

    this._buildTearSlab();

    this.leakColor = new THREE.Color(0xfff1d9); // World One (home): warm, familiar — contrast to this cold world

    this.veil = new TearVeil(this.veilAnchor, {
      width: 1.8,
      height: 2.4,
      baseColor: new THREE.Color(0x5a4a6e),
      edgeColor: new THREE.Color(0x3a2f4a)
    });

    this.seedLocal = new THREE.Vector2(0.1, -0.15);
    this.seam = new SeamHint(this.veilAnchor, this.seedLocal, this.leakColor);

    if (audio) {
      this.tearVoice = audio.createTearVoice(this.veilAnchor);
      const ambienceAnchor = new THREE.Object3D();
      ambienceAnchor.position.set(0, 1.5, WORLD_Z.worldThreeSpawn);
      this.group.add(ambienceAnchor);
      this.ambience = audio.createAmbience(ambienceAnchor, { mode: 'drone', refDistance: 10 });
    }
  }

  _buildPlatforms() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x453a5c, roughness: 0.8, metalness: 0.1 });
    const spots = [
      [0, PLATFORM_Y, WORLD_Z.worldThreeSpawn],
      [0.6, PLATFORM_Y - 0.15, WORLD_Z.worldThreeSpawn - 8],
      [-0.4, PLATFORM_Y + 0.1, WORLD_Z.worldThreeSpawn - 16],
      [0.3, PLATFORM_Y - 0.05, WORLD_Z.worldThreeWall + 4]
    ];
    for (const [x, y, z] of spots) {
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.4, 7), mat);
      slab.position.set(x, y, z);
      slab.rotation.y = Math.random() * Math.PI;
      this.group.add(slab);
    }
  }

  _buildImpossibleStructures() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a6bb0, roughness: 0.4, metalness: 0.3 });
    const knotMat = new THREE.MeshStandardMaterial({ color: 0xd18fff, roughness: 0.3, metalness: 0.4, emissive: 0x2a0f3a, emissiveIntensity: 0.4 });

    const invertedPyramid = new THREE.Mesh(new THREE.ConeGeometry(3.2, 5, 4), mat);
    invertedPyramid.position.set(-5, 6, WORLD_Z.worldThreeSpawn - 6);
    invertedPyramid.rotation.set(Math.PI, Math.PI / 4, 0);
    this.group.add(invertedPyramid);

    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.4, 0.4, 120, 16), knotMat);
    knot.position.set(4.5, 4.5, WORLD_Z.worldThreeSpawn - 14);
    this.group.add(knot);

    const giantCube = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), mat);
    giantCube.position.set(-3.5, -3, WORLD_Z.worldThreeWall + 6);
    giantCube.rotation.set(0.4, 0.7, 0.2);
    this.group.add(giantCube);

    this._rotators = [invertedPyramid, knot, giantCube];
  }

  _buildTearSlab() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e2440, roughness: 0.5, metalness: 0.3 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 0.3), mat);
    slab.position.set(0, 1.5, WORLD_Z.worldThreeWall + 0.05);
    this.group.add(slab);
  }

  _buildLighting() {
    const ambient = new THREE.HemisphereLight(0x6a4fae, 0x120a1c, 0.55);
    this.group.add(ambient);

    const glow = new THREE.PointLight(0xc98fff, 1.2, 20, 2);
    glow.position.set(0, 6, WORLD_Z.worldThreeSpawn - 8);
    this.group.add(glow);
  }

  _buildDebris() {
    const count = 40;
    const geo = new THREE.DodecahedronGeometry(0.08, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9a7fc2, roughness: 0.6 });
    this._debris = new THREE.InstancedMesh(geo, mat, count);
    this._debrisData = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 10;
      const z = WORLD_Z.worldThreeSpawn - Math.random() * 28;
      const y0 = -4 - Math.random() * 2;
      const speed = 0.25 + Math.random() * 0.4;
      this._debrisData.push({ x, z, y0, speed, phase: Math.random() * 10 });
      dummy.position.set(x, y0, z);
      dummy.updateMatrix();
      this._debris.setMatrixAt(i, dummy.matrix);
    }
    this.group.add(this._debris);
  }

  setCamera(camera) {
    this._camera = camera;
  }

  update(dt, ownSignal, worldTwoSignal) {
    for (const obj of this._rotators) {
      obj.rotation.y += dt * 0.12;
      obj.rotation.x += dt * 0.05;
    }

    const dummy = new THREE.Object3D();
    for (let i = 0; i < this._debrisData.length; i++) {
      const d = this._debrisData[i];
      d.phase += dt * d.speed;
      const y = d.y0 + (d.phase % 9); // drifts upward, loops
      dummy.position.set(d.x, y, d.z);
      dummy.rotation.set(d.phase, d.phase * 0.7, 0);
      dummy.updateMatrix();
      this._debris.setMatrixAt(i, dummy.matrix);
    }
    this._debris.instanceMatrix.needsUpdate = true;

    const leakStrength = THREE.MathUtils.smoothstep(ownSignal.openAmount, 0.02, 0.5);
    this.veil.update(dt, ownSignal, { camera: this._camera, leakColor: this.leakColor, leakStrength });
    this.seam.update(dt, ownSignal.openAmount);

    if (this.tearVoice) this.tearVoice.update(dt, ownSignal);
    if (this.ambience) this.ambience.update(dt);
  }
}
