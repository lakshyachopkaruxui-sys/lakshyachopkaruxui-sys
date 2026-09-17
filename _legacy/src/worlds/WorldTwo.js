import * as THREE from 'three';
import { TearVeil } from '../tear/TearVeil.js';
import { SeamHint } from '../tear/SeamHint.js';
import { CreatureReactionSystem } from './CreatureReactionSystem.js';
import { WORLD_Z } from './worldConstants.js';

// Art-direction assumption: World Two is the "alive" contrast world (brief:
// "should feel richer than World One... forest, water, wind"). Warm dappled
// sunlight, green/brown palette — the opposite of World One's cool, dim
// interior — so stepping through reads as an obvious, immediate escalation.
const GROUND_FRONT_Z = WORLD_Z.worldOneWall - 0.05;
const GROUND_BACK_Z = WORLD_Z.worldTwoWall - 3;
const WALL_Y_CENTER = 1.5;

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export class WorldTwo {
  constructor(scene, { audio = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'WorldTwo';
    scene.add(this.group);

    this._buildGround();
    this._buildTrees();
    this._buildLighting();

    this.veilAnchor = new THREE.Object3D();
    this.veilAnchor.position.set(0, WALL_Y_CENTER, WORLD_Z.worldTwoWall);
    this.group.add(this.veilAnchor);

    this._buildTearTree();

    this.leakColor = new THREE.Color(0xb266ff); // World Three: cold, otherworldly violet

    this.veil = new TearVeil(this.veilAnchor, {
      width: 1.6,
      height: 2.3,
      baseColor: new THREE.Color(0x6b5a44),
      edgeColor: new THREE.Color(0x4a3f2e)
    });

    this.seedLocal = new THREE.Vector2(-0.15, 0.2);
    this.seam = new SeamHint(this.veilAnchor, this.seedLocal, this.leakColor);

    this._buildCreature();

    if (audio) {
      this.tearVoice = audio.createTearVoice(this.veilAnchor);
      const ambienceAnchor = new THREE.Object3D();
      ambienceAnchor.position.set(0, 1.5, WORLD_Z.worldTwoSpawn);
      this.group.add(ambienceAnchor);
      this.ambience = audio.createAmbience(ambienceAnchor, { mode: 'wind', refDistance: 7 });
    }
  }

  _buildGround() {
    const depth = GROUND_FRONT_Z - GROUND_BACK_Z;
    const centerZ = (GROUND_FRONT_Z + GROUND_BACK_Z) / 2;
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x33482a, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, depth), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, centerZ);
    this.group.add(ground);
  }

  _buildTrees() {
    const rand = seededRandom(4242);
    const count = 46;
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 6);
    const foliageGeo = new THREE.IcosahedronGeometry(1, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.95 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3d6b2f, roughness: 0.85 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, count);

    const dummy = new THREE.Object3D();
    const clearRadius = 1.6; // keep the spawn and tear-wall areas open

    for (let i = 0; i < count; i++) {
      let x, z;
      let attempts = 0;
      do {
        x = (rand() - 0.5) * 13;
        z = GROUND_BACK_Z + 1.5 + rand() * (GROUND_FRONT_Z - GROUND_BACK_Z - 3);
        attempts++;
      } while (
        attempts < 8 &&
        (Math.hypot(x, z - WORLD_Z.worldTwoSpawn) < clearRadius ||
          Math.hypot(x, z - WORLD_Z.worldTwoWall) < clearRadius * 1.3)
      );

      const scale = 0.75 + rand() * 0.8;
      dummy.position.set(x, 1.1 * scale, z);
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = rand() * Math.PI * 2;
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, (2.2 + 0.8) * scale, z);
      dummy.scale.set(scale * 1.3, scale * 1.1, scale * 1.3);
      dummy.updateMatrix();
      foliage.setMatrixAt(i, dummy.matrix);
    }

    this.group.add(trunks, foliage);
  }

  _buildTearTree() {
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x3d2f20, roughness: 0.9 });
    const trunkGeo = new THREE.CylinderGeometry(0.55, 0.75, 3.2, 10, 1, true);

    const left = new THREE.Mesh(trunkGeo, barkMat);
    left.position.set(-1.1, 1.6, WORLD_Z.worldTwoWall - 0.1);
    left.rotation.z = 0.06;
    this.group.add(left);

    const right = new THREE.Mesh(trunkGeo, barkMat);
    right.position.set(1.1, 1.6, WORLD_Z.worldTwoWall - 0.1);
    right.rotation.z = -0.06;
    this.group.add(right);
  }

  _buildLighting() {
    const ambient = new THREE.HemisphereLight(0xaebf7a, 0x2a2010, 0.65);
    this.group.add(ambient);

    const sun = new THREE.DirectionalLight(0xffd9a0, 1.4);
    sun.position.set(4, 8, WORLD_Z.worldTwoSpawn + 2);
    sun.target.position.set(0, 0, WORLD_Z.worldTwoSpawn - 6);
    this.group.add(sun, sun.target);
  }

  _buildCreature() {
    const bodyGeo = new THREE.IcosahedronGeometry(0.14, 1);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdfffd0,
      emissive: new THREE.Color(0x8fffb0),
      emissiveIntensity: 0.8,
      roughness: 0.3
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    const glow = new THREE.PointLight(0x9dffb8, 0.5, 3, 2);
    body.add(glow);

    this.group.add(body);

    const restPoint = new THREE.Vector3(2.4, 1.3, WORLD_Z.worldTwoSpawn - 8);
    const curiousPoint = new THREE.Vector3(0.6, 1.5, WORLD_Z.worldOneWall - 1.4);
    body.position.copy(restPoint);

    this.creature = new CreatureReactionSystem(body, { restPoint, curiousPoint });
  }

  setCamera(camera) {
    this._camera = camera;
  }

  /**
   * @param {object} ownSignal - this world's own tear-controller signal (for its own veil)
   * @param {object} worldOneSignal - World One's tear signal, so the creature/forest can react while being peeked at
   */
  update(dt, ownSignal, worldOneSignal) {
    const leakStrength = THREE.MathUtils.smoothstep(ownSignal.openAmount, 0.02, 0.5);
    this.veil.update(dt, ownSignal, { camera: this._camera, leakColor: this.leakColor, leakStrength });
    this.seam.update(dt, ownSignal.openAmount);

    const watched = worldOneSignal ? worldOneSignal.openAmount : 0;
    this.creature.update(dt, watched, new THREE.Vector3(0, 1.4, WORLD_Z.worldOneWall));

    if (this.tearVoice) this.tearVoice.update(dt, ownSignal);
    if (this.ambience) this.ambience.update(dt);
  }
}
