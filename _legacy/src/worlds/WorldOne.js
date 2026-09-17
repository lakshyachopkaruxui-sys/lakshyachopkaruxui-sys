import * as THREE from 'three';
import { TearVeil } from '../tear/TearVeil.js';
import { SeamHint } from '../tear/SeamHint.js';
import { WORLD_Z, ROOM } from './worldConstants.js';

// Art-direction assumption (brief leaves exact visual direction open,
// "can evolve"): World One is a plain, dim, cool-toned interior — calm and
// unremarkable on purpose, so the warm light leaking from the tear reads
// as a genuine anomaly rather than blending into an already-vivid scene.
const WALL_COLOR = 0x3a3f47;
const FLOOR_COLOR = 0x2b2e33;

export class WorldOne {
  constructor(scene, { echo = false, audio = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'WorldOne';
    this.group.position.set(0, 0, 0);
    scene.add(this.group);

    this._buildRoom();
    this._buildLighting();

    this.veilAnchor = new THREE.Object3D();
    this.veilAnchor.position.set(0, ROOM.wallHeight / 2 + 0.35, WORLD_Z.worldOneWall);
    this.group.add(this.veilAnchor);

    this.leakColor = new THREE.Color(0xffb463); // World Two: warm, alive, golden-green forest light

    this.veil = new TearVeil(this.veilAnchor, {
      width: ROOM.wallWidth,
      height: ROOM.wallHeight,
      baseColor: new THREE.Color(WALL_COLOR).multiplyScalar(1.15),
      edgeColor: new THREE.Color(0x6b5a3f)
    });

    this.seedLocal = new THREE.Vector2(0.3, 0.1);
    this.seam = new SeamHint(this.veilAnchor, this.seedLocal, this.leakColor);

    this.tearVoice = audio ? audio.createTearVoice(this.veilAnchor) : null;

    if (echo) this.addEchoOfWorldTwo();
  }

  _buildRoom() {
    const wallMat = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.9 });
    const { width, height } = ROOM;
    const backZ = WORLD_Z.worldOneWall;
    const frontZ = WORLD_Z.worldOneFrontWall;
    const depth = frontZ - backZ;
    const centerZ = (frontZ + backZ) / 2;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, centerZ);
    this.group.add(floor);

    const ceiling = floor.clone();
    ceiling.material = wallMat;
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, height, centerZ);
    this.group.add(ceiling);

    const sideGeo = new THREE.PlaneGeometry(depth, height);
    const left = new THREE.Mesh(sideGeo, wallMat);
    left.position.set(-width / 2, height / 2, centerZ);
    left.rotation.y = Math.PI / 2;
    this.group.add(left);

    const right = new THREE.Mesh(sideGeo, wallMat);
    right.position.set(width / 2, height / 2, centerZ);
    right.rotation.y = -Math.PI / 2;
    this.group.add(right);

    const frontGeo = new THREE.PlaneGeometry(width, height);
    const front = new THREE.Mesh(frontGeo, wallMat);
    front.position.set(0, height / 2, frontZ);
    front.rotation.y = Math.PI;
    this.group.add(front);

    this._buildBackWallFrame(wallMat);
  }

  // The back wall's center panel IS the tear veil (added separately); this
  // builds the surrounding solid frame so the veil reads as a distinct
  // feature on the wall rather than the whole wall being made of paper.
  _buildBackWallFrame(wallMat) {
    const { width, height, wallWidth, wallHeight } = ROOM;
    const wallZ = WORLD_Z.worldOneWall;
    const veilCenterY = wallHeight / 2 + 0.35;
    const veilTop = veilCenterY + wallHeight / 2;
    const veilBottom = veilCenterY - wallHeight / 2;

    const addStrip = (w, h, x, y) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
      mesh.position.set(x, y, wallZ);
      this.group.add(mesh);
    };

    addStrip(width, veilBottom, 0, veilBottom / 2); // below the veil
    addStrip(width, height - veilTop, 0, veilTop + (height - veilTop) / 2); // above the veil
    addStrip((width - wallWidth) / 2, wallHeight, -(wallWidth / 2 + (width - wallWidth) / 4), veilCenterY); // left
    addStrip((width - wallWidth) / 2, wallHeight, wallWidth / 2 + (width - wallWidth) / 4, veilCenterY); // right
  }

  _buildLighting() {
    const ambient = new THREE.HemisphereLight(0x545b66, 0x18191c, 0.55);
    this.group.add(ambient);

    const fixture = new THREE.PointLight(0xcfd6e0, 3.5, 8, 2);
    fixture.position.set(0, ROOM.height - 0.2, 1.2);
    this.group.add(fixture);
  }

  /** Called once, on the final World Three -> World One loop, to permanently mark the room as changed. */
  addEchoOfWorldTwo() {
    if (this._echoObject) return;
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.5, 8);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a7a4a, roughness: 0.7 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(-1.6, 0.25, 0.6);

    const budGeo = new THREE.IcosahedronGeometry(0.09, 1);
    const budMat = new THREE.MeshStandardMaterial({
      color: 0xffd27a,
      emissive: new THREE.Color(0xffb463),
      emissiveIntensity: 0.9,
      roughness: 0.4
    });
    const bud = new THREE.Mesh(budGeo, budMat);
    bud.position.set(-1.6, 0.52, 0.6);

    const glow = new THREE.PointLight(0xffb463, 0.6, 2, 2);
    glow.position.copy(bud.position);

    this._echoObject = new THREE.Group();
    this._echoObject.add(stem, bud, glow);
    this.group.add(this._echoObject);
  }

  update(dt, signal) {
    const leakStrength = THREE.MathUtils.smoothstep(signal.openAmount, 0.02, 0.5);
    this.veil.update(dt, signal, {
      camera: this._camera,
      leakColor: this.leakColor,
      leakStrength
    });
    this.seam.update(dt, signal.openAmount);
    if (this.tearVoice) this.tearVoice.update(dt, signal);
  }

  setCamera(camera) {
    this._camera = camera;
  }
}
