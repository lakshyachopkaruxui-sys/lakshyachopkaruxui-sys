import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config/config';
import { mulberry32 } from '../utils/math';
import { dotTexture } from '../utils/sprites';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { applyWind, loadProp } from './props';
import { HeightField } from './terrain';
import { SkyFlock } from './SkyFlock';
import { surfaceMaps, fernGeometry, stoneGeometry, leafGeometry, contactTexture } from './nature';

type Planting = { x: number; z: number; scale: number; yaw: number };

/** A quiet, life-size glade: open foreground, planted banks and a layered canopy. */
export class WorldTwo {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly leakColor = new THREE.Color(0xe9d1a0);
  readonly leanDetails: THREE.MeshBasicMaterial[] = [];
  readonly perchLocal = new THREE.Vector3(-1.7, 0.55, -4.8);
  readonly terrain: HeightField;
  readonly soundSpots = {
    stream: new THREE.Vector3(5, 0, -9),
    canopyLeft: new THREE.Vector3(-8, 5, -9),
    canopyRight: new THREE.Vector3(10, 6, -16),
    insectsNear: new THREE.Vector3(-0.4, 0.6, -1)
  };
  readonly ready: Promise<void>;
  stencilLayer = 1;
  private rng = mulberry32(2301);
  private windTime = { value: 0 };
  private skyTime = { value: 0 };
  private flock: SkyFlock;
  private previousTime: number | undefined;
  private motes: THREE.Points;
  private moteBase: Float32Array;
  private pondMaterial: THREE.MeshStandardMaterial;
  private worldPoint = new THREE.Vector3();
  private alignmentDirection = new THREE.Vector3();
  private alignmentQuaternion = new THREE.Quaternion();

  constructor(origin: THREE.Vector3) {
    this.root.name = 'Forest · grounded glade';
    this.root.position.set(origin.x, 0, origin.z);
    this.scene.add(this.root);
    this.scene.fog = new THREE.FogExp2(0xb6c6b0, 0.017);
    // 32,768 terrain triangles, instead of a single perimeter fan. The same
    // stored triangles are queried for every planting and the walking camera.
    this.terrain = new HeightField(112, 128, (x, z) => {
      const d = Math.hypot(x, z + 4);
      const banks = THREE.MathUtils.smoothstep(d, 5, 18);
      const hills = (0.6 + Math.sin(x * 0.16) * Math.cos(z * 0.13) * 0.55 + Math.sin(z * 0.09) * 0.3) * banks;
      const pond = this.pondRadius(x, z);
      return hills - (1 - THREE.MathUtils.smoothstep(pond, 0.6, 1.18)) * (hills + 0.23);
    });
    this.buildGround();
    this.buildSkyAndLight();
    this.pondMaterial = this.buildPond();
    this.buildPlanting();
    this.buildPerch();
    this.buildForestDetails();
    this.flock = new SkyFlock(this.root, () => this.stencilLayer);
    this.moteBase = new Float32Array(90 * 3);
    this.motes = this.buildMotes();
    this.refreshStencil();
    this.ready = Promise.all([this.buildTrees(), this.flock.ready]).then(() => undefined).catch(error => {
      console.error('Forest tree assets could not load.', error);
    });
  }

  alignTo(anchor: THREE.Object3D) {
    anchor.getWorldPosition(this.worldPoint);
    anchor.getWorldQuaternion(this.alignmentQuaternion);
    this.alignmentDirection.set(0, 0, 1).applyQuaternion(this.alignmentQuaternion);
    this.root.position.set(this.worldPoint.x, 0, this.worldPoint.z);
    // Keep the glade's open arrival facing the tear, including when the user
    // turns before pinching. Follow yaw only: the floor must remain level.
    this.root.rotation.set(0, Math.atan2(this.alignmentDirection.x, this.alignmentDirection.z), 0);
    this.root.updateMatrixWorld(true);
  }
  get walkBounds() { return { center: this.root.localToWorld(new THREE.Vector3(0, 0, -4)), radius: 20 }; }
  get nextSeamHint() { return this.root.localToWorld(new THREE.Vector3(0, 0, -3)); }
  refreshStencil() { applyStencilLayer(this.scene, this.stencilLayer); }
  groundHeight(x: number, z: number) { return this.terrain.heightAt(x, z); }
  groundHeightWorld(x: number, z: number) { return this.groundAt(x, z); }
  groundAt(x: number, z: number) {
    this.root.updateWorldMatrix(true, false);
    this.worldPoint.set(x, 0, z);
    this.root.worldToLocal(this.worldPoint);
    return this.groundHeight(this.worldPoint.x, this.worldPoint.z) + this.root.position.y;
  }

  private pondRadius(x: number, z: number) {
    return Math.hypot((x - 5) / 2.4, (z + 9) / 4.2);
  }

  private buildGround() {
    const g = this.terrain.geometry;
    const p = g.attributes.position, color = new Float32Array(p.count * 3);
    const moss = new THREE.Color(0xb5c29e), earth = new THREE.Color(0xc9b990), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      // A soft winding trail gives the foreground a legible direction.
      const pathX = Math.sin(z * 0.15) * 1.25;
      const trail = 1 - THREE.MathUtils.smoothstep(Math.abs(x - pathX), 0.8, 2.3);
      c.copy(moss).lerp(earth, trail * 0.55).multiplyScalar(0.93 + 0.07 * Math.sin(x * 0.5 + z * 0.37));
      color.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    const material = new THREE.MeshStandardMaterial({
      ...surfaceMaps('ground', 112 / 2.8), vertexColors: true, roughness: 1,
      normalScale: new THREE.Vector2(0.5, 0.5)
    });
    const ground = new THREE.Mesh(g, material);
    ground.name = 'Continuous forest floor'; ground.receiveShadow = true;
    this.root.add(ground);
  }

  private buildSkyAndLight() {
    // A stencil-tested sky mesh: scene.background would cover the real room.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(155, 32, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { uTime: this.skyTime },
      vertexShader: 'varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec3 vDirection; uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
        float cloud(vec2 p){ return noise(p)*.56+noise(p*2.03)*.28+noise(p*4.1)*.11+noise(p*8.2)*.05; }
        void main(){
          vec3 d=normalize(vDirection), sunDir=normalize(vec3(-.52,.67,-.53));
          vec3 c=mix(vec3(.70,.79,.76),vec3(.12,.34,.59),smoothstep(-.03,.82,d.y));
          float sunDistance=distance(d,sunDir);
          float glow=exp(-sunDistance*sunDistance*85.);
          float disc=1.-smoothstep(.011,.014,sunDistance);
          c+=vec3(1.,.78,.42)*glow*.4;
          c=mix(c,vec3(3.4,2.7,1.6),disc);
          // Slow world-space drift: clouds remain above the viewer in both XR eyes.
          vec2 uv=d.xz/(max(d.y,0.)+.24)*1.7+vec2(uTime*.007,uTime*.002);
          float shape=cloud(uv);
          float coverage=smoothstep(.49,.71,shape)*smoothstep(.05,.17,d.y);
          float lining=cloud(uv+vec2(-.08,.07));
          vec3 cloudColor=mix(vec3(.66,.73,.77),vec3(1.05,1.02,.93),smoothstep(.40,.67,lining));
          cloudColor+=vec3(.21,.15,.07)*glow;
          c=mix(c,cloudColor,coverage*.94);
          gl_FragColor=vec4(c,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    sky.name = 'Daylight sky · visible sun and drifting clouds';
    sky.renderOrder = -10; this.root.add(sky);
    new HDRLoader().load('/hdri/sky_sunset_1k.hdr', texture => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = texture; this.scene.environmentIntensity = 0.32;
    }, undefined, () => console.warn('Forest HDR unavailable; local lighting remains active.'));
    this.root.add(new THREE.HemisphereLight(0xd9e8f0, 0x4d6040, 1.5));
    const sun = new THREE.DirectionalLight(0xffe7b9, 2.5);
    sun.position.set(-16, 23, -18); sun.target.position.set(0, 0, -6);
    sun.castShadow = CONFIG.render.shadows;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025;
    this.root.add(sun, sun.target);
  }

  private buildPond() {
    // Solve each shoreline vertex against the actual terrain at water level.
    // This replaces the rectangular ribbon that crossed through the old floor.
    const waterY = -0.045, p: number[] = [5, waterY, -9], indices: number[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = i / 96 * Math.PI * 2;
      let lo = 0.2, hi = 1.3;
      for (let j = 0; j < 22; j++) {
        const t = (lo + hi) / 2;
        const h = this.groundHeight(5 + Math.cos(a) * 2.4 * t, -9 + Math.sin(a) * 4.2 * t);
        if (h < waterY) lo = t; else hi = t;
      }
      p.push(5 + Math.cos(a) * 2.4 * hi, waterY, -9 + Math.sin(a) * 4.2 * hi);
      if (i < 96) indices.push(0, i + 2, i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(indices); g.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0x487d78, roughness: 0.19, metalness: 0.32, transparent: true, opacity: 0.78, depthWrite: false });
    const water = new THREE.Mesh(g, material); water.name = 'Shallow glade pool'; this.root.add(water);
    // Small ripples, clipped well inside the shore, add a readable water cue.
    const ripples: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.RingGeometry(0.22 + i * 0.24, 0.229 + i * 0.24, 64);
      ring.rotateX(-Math.PI / 2); ring.scale(0.8, 1, 1.5); ring.translate(5, waterY + 0.008, -9);
      ripples.push(ring);
    }
    const rippleGeometry = mergeGeometries(ripples)!;
    ripples.forEach(g => g.dispose());
    this.root.add(new THREE.Mesh(rippleGeometry, new THREE.MeshBasicMaterial({ color: 0xd6e8da, transparent: true, opacity: 0.11, depthWrite: false })));
    return material;
  }

  private candidate(min: number, max: number): Planting {
    // Reject rather than force a final invalid placement into the clearing.
    for (let attempt = 0; attempt < 160; attempt++) {
      const a = this.rng() * Math.PI * 2, d = min + this.rng() * (max - min);
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 4;
      const path = Math.abs(x - Math.sin(z * 0.15) * 1.25);
      if ((path < 2.1 && z < 3 && z > -25) || this.pondRadius(x, z) < 1.3 || Math.hypot(x + 1.7, z + 4.8) < 1.3) continue;
      return { x, z, yaw: this.rng() * Math.PI * 2, scale: 1 };
    }
    return { x: min, z: 4, yaw: 0, scale: 1 };
  }

  private instance(geometry: THREE.BufferGeometry, material: THREE.Material, spots: Planting[], name: string, embed = 0) {
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    mesh.name = name;
    const transform = new THREE.Object3D();
    spots.forEach((p, i) => {
      transform.position.set(p.x, this.groundHeight(p.x, p.z) - embed, p.z);
      transform.rotation.set(0, p.yaw, 0); transform.scale.setScalar(p.scale); transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, new THREE.Color().setHSL(0.12, 0.08, 0.84 + this.rng() * 0.13));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    // A loaded mesh must be assigned NOW, not after unrelated async assets.
    applyStencilLayer(mesh, this.stencilLayer);
    return mesh;
  }

  private buildPlanting() {
    const ferns = Array.from({ length: 84 }, () => {
      const p = this.candidate(4.2, 19); p.scale = 0.65 + this.rng() * 0.5; return p;
    });
    const fernMaterial = new THREE.MeshStandardMaterial({ color: 0x547841, roughness: 0.86, side: THREE.DoubleSide });
    applyWind(fernMaterial, this.windTime, 0.04, 1.2);
    this.instance(fernGeometry(), fernMaterial, ferns, 'Paired fern fronds');
    // Leaves grow as low clumps, 12–26cm high, and never in the landing area.
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const g = leafGeometry(0.24 + (i % 3) * 0.04, 0.013);
      g.rotateX(-0.8 - (i % 2) * 0.3); g.rotateY(i * 2.4); blades.push(g);
    }
    const grassGeometry = mergeGeometries(blades)!; blades.forEach(g => g.dispose());
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x71824b, roughness: 0.95, side: THREE.DoubleSide });
    applyWind(grassMaterial, this.windTime, 0.08, 1.4);
    const grass = Array.from({ length: 290 }, () => {
      const p = this.candidate(3.8, 26); p.scale = 0.55 + this.rng() * 0.65; return p;
    });
    this.instance(grassGeometry, grassMaterial, grass, 'Low meadow planting');
    const rockMaterial = new THREE.MeshStandardMaterial({ ...surfaceMaps('rock'), color: 0x9caa96, roughness: 0.94, normalScale: new THREE.Vector2(0.45, 0.45) });
    const rocks = Array.from({ length: 30 }, () => {
      const p = this.candidate(5.5, 26); p.scale = 0.17 + this.rng() ** 2 * 0.68; return p;
    });
    this.instance(stoneGeometry(), rockMaterial, rocks, 'Weathered woodland stones', 0.075);
    this.buildFlowers();
  }

  private buildFlowers() {
    const stem = new THREE.CylinderGeometry(0.004, 0.007, 0.28, 5); stem.translate(0, 0.14, 0);
    const petals: THREE.BufferGeometry[] = [];
    for (let j = 0; j < 5; j++) {
      const petal = leafGeometry(0.062, 0.024);
      petal.rotateX(-0.3); petal.rotateY(j * Math.PI * 2 / 5); petal.translate(0, 0.28, 0); petals.push(petal);
    }
    const petalGeometry = mergeGeometries(petals)!;
    petals.forEach(g => g.dispose());
    const spots = Array.from({ length: 64 }, () => {
      const p = this.candidate(4.7, 12); p.scale = 0.7 + this.rng() * 0.4; return p;
    });
    this.instance(stem, new THREE.MeshStandardMaterial({ color: 0x627343, roughness: 1 }), spots, 'Flower stems');
    this.instance(petalGeometry, new THREE.MeshStandardMaterial({ color: 0xe8dac8, roughness: 0.85, side: THREE.DoubleSide }), spots, 'Woodland blossom');
  }

  private buildPerch() {
    const stone = new THREE.Mesh(stoneGeometry(), new THREE.MeshStandardMaterial({
      ...surfaceMaps('rock'), color: 0x879882, roughness: 0.9, normalScale: new THREE.Vector2(0.4, 0.4)
    }));
    const base = this.groundHeight(-1.7, -4.8);
    stone.position.set(-1.7, base - 0.08, -4.8); stone.scale.set(0.74, 0.4, 0.64);
    stone.castShadow = true; stone.receiveShadow = true; stone.name = 'Visitor resting stone';
    this.root.add(stone);
    this.perchLocal.set(-1.7, base + 0.43, -4.8);
  }

  private buildForestDetails() {
    // Small discoveries sit beside the trail, not in the user's landing space.
    const mushrooms: Planting[] = [];
    for (const [cx, cz] of [[-4.1, -3.5], [-5.7, -8], [3.4, -4.2], [8.1, -12], [-8, 2]]) {
      for (let i = 0; i < 7; i++) {
        const a = i * 2.399, d = 0.12 + this.rng() * 0.48;
        mushrooms.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, scale: 0.65 + this.rng() * 0.75, yaw: a });
      }
    }
    const stalk = new THREE.CylinderGeometry(0.028, 0.042, 0.17, 10);
    stalk.translate(0, 0.085, 0);
    const cap = new THREE.LatheGeometry([
      new THREE.Vector2(0, 0.178), new THREE.Vector2(0.06, 0.174),
      new THREE.Vector2(0.12, 0.165), new THREE.Vector2(0.135, 0.18),
      new THREE.Vector2(0.11, 0.21), new THREE.Vector2(0.075, 0.246),
      new THREE.Vector2(0.032, 0.261), new THREE.Vector2(0, 0.265)
    ], 18);
    this.instance(stalk, new THREE.MeshStandardMaterial({ color: 0xe0d0ac, roughness: 0.93 }), mushrooms, 'Mushroom stems on the forest floor');
    this.instance(cap, new THREE.MeshStandardMaterial({ color: 0xa56b43, roughness: 0.66 }), mushrooms, 'Chestnut mushroom caps');

    const barkTexture = new THREE.TextureLoader().load('/textures/refined/oak_color.jpg');
    barkTexture.colorSpace = THREE.SRGBColorSpace;
    barkTexture.wrapS = barkTexture.wrapT = THREE.RepeatWrapping;
    barkTexture.repeat.set(2, 1);
    const bark = new THREE.MeshStandardMaterial({ map: barkTexture, color: 0x80725b, roughness: 0.96 });
    // Every centreline sample follows the actual floor; the underside settles
    // into the soil by a few centimetres instead of hovering across a slope.
    for (const [x, z, yaw] of [[-5.5, -7, 0.6], [9.6, -14, -0.9]]) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const d = i / 8 * 2.6 - 1.3;
        const px = x + Math.cos(yaw) * d, pz = z + Math.sin(yaw) * d;
        points.push(new THREE.Vector3(px, this.groundHeight(px, pz) + 0.145, pz));
      }
      const log = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.18, 14, false), bark);
      log.name = 'Fallen branch resting on the bank'; log.castShadow = true; log.receiveShadow = true; this.root.add(log);
      for (const index of [0, points.length - 1]) {
        const end = new THREE.Mesh(new THREE.CircleGeometry(0.177, 20), new THREE.MeshStandardMaterial({ color: 0xb5976d, roughness: 1, side: THREE.DoubleSide }));
        end.name = 'Weathered cut wood'; end.position.copy(points[index]);
        end.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)));
        this.root.add(end);
      }
    }

    // Lily pads are intentionally supported by the water surface, not terrain.
    const lilyMaterial = new THREE.MeshStandardMaterial({ color: 0x648a54, roughness: 0.48, side: THREE.DoubleSide });
    const lilyShape = new THREE.Shape();
    lilyShape.moveTo(0, 0);
    for (let i = 0; i <= 40; i++) {
      const angle = 0.18 + i / 40 * (Math.PI * 2 - 0.36);
      lilyShape.lineTo(Math.cos(angle) * 0.23, Math.sin(angle) * 0.2);
    }
    lilyShape.lineTo(0, 0);
    const lilyGeo = new THREE.ShapeGeometry(lilyShape, 20); lilyGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(lilyGeo, lilyMaterial);
      leaf.name = 'Lily pad supported by pool water';
      leaf.position.set(5.2 + Math.sin(i * 2.4) * 0.55, -0.032, -9.6 + Math.cos(i * 2.4) * 0.8);
      leaf.rotation.y = i * 1.7; leaf.scale.setScalar(0.7 + (i % 3) * 0.15); this.root.add(leaf);
    }
  }

  private async buildTrees() {
    const specs: Planting[][] = [[], [], [], []];
    const accepted: Planting[] = [];
    for (let i = 0; i < 72; i++) {
      let p: Planting;
      let attempts = 0;
      do { p = this.candidate(i < 24 ? 7.5 : 22, i < 24 ? 20 : 49); }
      while (accepted.some(s => Math.hypot(s.x - p.x, s.z - p.z) < (i < 24 ? 3.7 : 4.2)) && ++attempts < 100);
      p.scale = i < 24 ? 0.92 + this.rng() * 0.32 : 0.95 + this.rng() * 0.5;
      accepted.push(p); specs[(i < 24 ? 0 : 2) + i % 2].push(p);
    }
    this.buildContactShade(accepted);
    const loader = new THREE.TextureLoader();
    const texture = (file: string, color = false) => {
      const t = loader.load(`/textures/refined/${file}`); t.flipY = false; t.anisotropy = 4;
      if (color) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    // Species load independently; one missing file cannot prevent the other.
    await Promise.all(['oak', 'ash', 'oak_lod', 'ash_lod'].map(async (name, species) => {
      const leafName = name.startsWith('oak') ? 'oak' : 'ash';
      const source = await loadProp(`/models/refined/${name}.glb`);
      source.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const isLeaves = object.name.toLowerCase().includes('leav');
        const material = isLeaves
          ? new THREE.MeshStandardMaterial({ map: texture(`${leafName}_leaves.png`, true), alphaTest: 0.48, side: THREE.DoubleSide, roughness: 0.86, color: species % 2 ? 0xa0b479 : 0xb8c095 })
          : new THREE.MeshStandardMaterial({ map: texture('oak_color.jpg', true), normalMap: texture('oak_normal.jpg'), roughnessMap: texture('oak_roughness.jpg'), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, color: 0xb9b2a2 });
        applyWind(material, this.windTime, isLeaves ? 0.004 : 0.0014, 1.25);
        const instances = this.instance(object.geometry, material, specs[species], `${name} ${isLeaves ? 'canopy' : 'branching trunks'}`, 0.025);
        instances.castShadow = species < 2;
        if (isLeaves && species < 2) instances.customDepthMaterial = new THREE.MeshDepthMaterial({ map: material.map, alphaTest: 0.48, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
      });
    }));
  }

  private buildContactShade(spots: Planting[]) {
    const patches: THREE.BufferGeometry[] = [];
    for (const p of spots) {
      const g = new THREE.PlaneGeometry(3.2 * p.scale, 3.2 * p.scale, 5, 5);
      g.rotateX(-Math.PI / 2); g.translate(p.x, 0, p.z);
      const a = g.attributes.position;
      for (let i = 0; i < a.count; i++) a.setY(i, this.groundHeight(a.getX(i), a.getZ(i)) + 0.012);
      patches.push(g);
    }
    const geometry = mergeGeometries(patches)!; patches.forEach(g => g.dispose());
    this.root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: contactTexture(), color: 0x263927, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })));
    this.refreshStencil();
  }

  private buildMotes() {
    for (let i = 0; i < this.moteBase.length; i += 3) {
      this.moteBase.set([(this.rng() - 0.5) * 22, 0.8 + this.rng() * 4, -this.rng() * 24], i);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.moteBase.slice(), 3));
    const points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe9b7, size: 0.023, map: dotTexture(), transparent: true, opacity: 0.5, depthWrite: false }));
    this.root.add(points); return points;
  }

  update(time: number, _lean: number) {
    this.windTime.value = time;
    this.skyTime.value = time;
    const dt = this.previousTime === undefined ? 0 : THREE.MathUtils.clamp(time - this.previousTime, 0, 0.1);
    this.previousTime = time;
    this.flock.update(time, dt);
    const p = this.motes.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, this.moteBase[i * 3] + Math.sin(time * 0.23 + i) * 0.15,
        this.moteBase[i * 3 + 1] + Math.sin(time * 0.35 + i * 2) * 0.08, this.moteBase[i * 3 + 2]);
    }
    p.needsUpdate = true;
    this.pondMaterial.roughness = 0.18 + Math.sin(time * 0.4) * 0.012;
  }
}
