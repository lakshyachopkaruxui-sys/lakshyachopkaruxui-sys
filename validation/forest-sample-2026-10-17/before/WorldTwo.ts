import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config/config';
import { mulberry32 } from '../utils/math';
import { dotTexture } from '../utils/sprites';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { applyWind } from './props';
import { HeightField } from './terrain';
import { surfaceMaps, fernGeometry, stoneGeometry, leafGeometry, contactTexture } from './nature';
import { EnvironmentalPresence, applyPlantPresence } from './EnvironmentalPresence';
import { ForestDetails } from './ForestDetails';
import { ForestFauna } from './ForestFauna';
import { WorldCollisions } from './WorldCollisions';
import { ForestConifers, type ForestTreeBase } from './ForestConifers';
import { loadLayeredForestFloor, forestGrowthAt } from './ForestGround';

type Planting = { x: number; z: number; scale: number; yaw: number };

/** A quiet, life-size glade: open foreground, planted banks and a layered canopy. */
export class WorldTwo {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly collisions = new WorldCollisions(this.root);
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
  readonly scannedDetails: ForestDetails;
  readonly fauna: ForestFauna;
  conifers!: ForestConifers;
  forestFloorReady = false;
  photographicSkyReady = false;
  stencilLayer = 1;
  private rng = mulberry32(2301);
  private windTime = { value: 0 };
  readonly presence = new EnvironmentalPresence();
  private previousTime: number | undefined;
  private motes: THREE.Points;
  private moteBase: Float32Array;
  private pondMaterial: THREE.MeshStandardMaterial;
  private worldPoint = new THREE.Vector3();
  private alignmentDirection = new THREE.Vector3();
  private alignmentQuaternion = new THREE.Quaternion();
  private proceduralFerns!: THREE.InstancedMesh;

  constructor(origin: THREE.Vector3) {
    this.root.name = 'Forest · grounded glade';
    this.root.position.set(origin.x, 0, origin.z);
    this.scene.add(this.root);
    this.scene.fog = new THREE.FogExp2(0x79836e, 0.012);
    // 32,768 terrain triangles, instead of a single perimeter fan. The same
    // stored triangles are queried for every planting and the walking camera.
    this.terrain = new HeightField(112, 128, (x, z) => {
      const d = Math.hypot(x, z + 4);
      const banks = THREE.MathUtils.smoothstep(d, 5, 18);
      const hills = (1.0 + Math.sin(x * .18) * Math.cos(z * .12) * .85 + Math.sin(z * .10) * .48) * banks;
      const pond = this.pondRadius(x, z);
      const trailDistance = Math.abs(x - Math.sin(z * .15) * 1.25);
      const relief = .11 * Math.sin(x * 1.7 + Math.cos(z * .8)) * Math.sin(z * 1.1)
        * THREE.MathUtils.smoothstep(trailDistance, 1, 2.6) * THREE.MathUtils.smoothstep(Math.hypot(x,z), 1.8, 3.2);
      return hills + relief * THREE.MathUtils.smoothstep(pond, 1.25, 1.65) - (1 - THREE.MathUtils.smoothstep(pond, 0.6, 1.18)) * (hills + 0.23);
    });
    const treesReady = this.buildTrees();
    const floorReady = this.buildGround();
    const skyReady = this.buildSkyAndLight();
    this.pondMaterial = this.buildPond();
    this.buildPlanting();
    this.buildPerch();
    this.buildForestDetails();
    this.scannedDetails = new ForestDetails(this.root, (x, z) => this.groundHeight(x, z),
      () => this.stencilLayer, this.windTime, this.presence, () => { this.proceduralFerns.visible = false; }, this.collisions);
    this.fauna = new ForestFauna(this.root, (x, z) => this.groundHeight(x, z), () => this.stencilLayer, this.collisions);
    this.moteBase = new Float32Array(90 * 3);
    this.motes = this.buildMotes();
    this.refreshStencil();
    this.ready = Promise.all([treesReady, floorReady, skyReady,
      this.scannedDetails.ready, this.fauna.ready]).then(() => undefined).catch(error => {
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
    this.scene.environmentRotation.y = Math.PI / 2 + this.root.rotation.y;
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

  updateView(viewerPosition: THREE.Vector3, active: boolean, dt: number) {
    this.presence.update(viewerPosition, active, dt);
    this.fauna.updateView(viewerPosition, active, dt);
  }

  private pondRadius(x: number, z: number) {
    const nx = (x - 5) / 2.4, nz = (z + 9) / 4.2;
    const angle = Math.atan2(nz, nx);
    return Math.hypot(nx, nz) / (1 + .12 * Math.sin(angle * 3 + .7) + .05 * Math.sin(angle * 7));
  }

  private buildGround() {
    const g = this.terrain.geometry;
    const p = g.attributes.position, color = new Float32Array(p.count * 3);
    const moss = new THREE.Color(0x7b9668), earth = new THREE.Color(0xa49b83), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      // A soft winding trail gives the foreground a legible direction.
      const pathX = Math.sin(z * 0.15) * 1.25;
      const trail = 1 - THREE.MathUtils.smoothstep(Math.abs(x - pathX), 0.8, 2.3);
      c.copy(moss).lerp(earth, trail * 0.76).multiplyScalar(0.87 + 0.13 * Math.sin(x * 0.5 + z * 0.37));
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
    return loadLayeredForestFloor(material, this.conifers.ready.then(() => this.conifers.bases))
      .then(loaded => { this.forestFloorReady = loaded; });
  }

  private buildSkyAndLight() {
    // Photographed distant pine canopy, on a stencil-tested sphere. Scene.background
    // would paint over the passthrough room outside a preview tear.
    const material = new THREE.MeshBasicMaterial({ color: 0xc6d6db, side: THREE.BackSide, depthWrite: false, fog: false });
    // Fade only the low distant treeline toward the same aerial-perspective
    // color as the 3D ground. The overhead photographic canopy stays intact.
    material.onBeforeCompile = shader => {
      shader.uniforms.forestHorizonFog = { value: new THREE.Color(0x79836e) };
      shader.fragmentShader = 'uniform vec3 forestHorizonFog;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n#ifdef USE_MAP\nfloat horizonMist = 1.0 - smoothstep(0.495, 0.555, vMapUv.y);\ndiffuseColor.rgb = mix(diffuseColor.rgb, forestHorizonFog, horizonMist * 0.70);\n#endif');
    };
    material.customProgramCacheKey = () => 'forest-photographic-horizon-mist-v1';
    const skyGeometry = new THREE.SphereGeometry(155, 48, 28);
    // SphereGeometry's longitude runs opposite Three's equirectangular lookup.
    // Match the visible photograph to the same HDR used for environment light.
    const skyUV = skyGeometry.attributes.uv;
    for (let i = 0; i < skyUV.count; i++) skyUV.setX(i, 1 - skyUV.getX(i));
    const sky = new THREE.Mesh(skyGeometry, material);
    sky.name = 'Photographic Forest Slope distant pine canopy';
    // This longitude looks into the photographed distant stand, rather than
    // putting a nearby panoramic trunk at an impossible scale behind the glade.
    sky.rotation.y = Math.PI / 2;
    sky.renderOrder = -10; this.root.add(sky);
    const ready = new HDRLoader().loadAsync(assetUrl('/hdri/forest_slope_2k.hdr')).then(texture => {
      material.map = texture; material.color.setScalar(.78); material.needsUpdate = true;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = texture; this.scene.environmentIntensity = .48;
      this.scene.environmentRotation.y = Math.PI / 2 + this.root.rotation.y;
      applyStencilLayer(sky, this.stencilLayer);
      this.photographicSkyReady = true;
    }).catch(error => console.warn('Photographic forest sky unavailable; retaining local daylight.', error));
    this.root.add(new THREE.HemisphereLight(0xc6dac7, 0x363d27, .65));
    const sun = new THREE.DirectionalLight(0xffedcf, 1.65);
    sun.position.set(-20, 28, 8); sun.target.position.set(0, 0, -10);
    sun.castShadow = CONFIG.render.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 95 });
    sun.shadow.bias = -.00015; sun.shadow.normalBias = .018;
    this.root.add(sun, sun.target);
    return ready;
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
    const uv = new Float32Array(p.length / 3 * 2);
    for (let i = 0; i < p.length / 3; i++) { uv[i * 2] = p[i * 3] * .32; uv[i * 2 + 1] = p[i * 3 + 2] * .32; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const normalData = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const a = x / 128 * Math.PI * 2, b = y / 128 * Math.PI * 2, i = (y * 128 + x) * 4;
      const nx = .055 * Math.cos(a * 3 + b * 2 + .7 * Math.sin(b * 5)) + .028 * Math.cos(a * 7 - b * 5) + .018 * Math.sin(a * 13 + b * 11);
      const ny = .043 * Math.cos(a * 2 - b * 3 + .9 * Math.sin(a * 4)) - .031 * Math.cos(a * 5 + b * 7) + .017 * Math.sin(a * 11 - b * 13);
      const n = new THREE.Vector3(nx, ny, 1).normalize();
      normalData.set([(n.x * .5 + .5) * 255, (n.y * .5 + .5) * 255, (n.z * .5 + .5) * 255, 255], i);
    }
    const normal = new THREE.DataTexture(normalData, 128, 128);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.needsUpdate = true;
    normal.magFilter = normal.minFilter = THREE.LinearFilter;
    const material = new THREE.MeshPhysicalMaterial({ color: 0x19261c, roughness: .12, metalness: 0,
      clearcoat: .75, clearcoatRoughness: .11, ior: 1.333, envMapIntensity: .9,
      normalMap: normal, normalScale: new THREE.Vector2(.12, .12) });
    const water = new THREE.Mesh(g, material); water.name = 'Shallow glade pool'; this.root.add(water);
    this.collisions.addPolygon({ id: 'forest-pond', headOcclusion: false, points: Array.from({ length: 24 }, (_, i) => {
      const angle = i / 24 * Math.PI * 2;
      return { x: 5 + Math.cos(angle) * 2.7, z: -9 + Math.sin(angle) * 4.5 };
    }) });
    // Uneven stones and low bank growth soften the real terrain intersection.
    const shoreline: Planting[] = [];
    for (let i = 0; i < 20; i++) {
      const j = 1 + Math.floor(i / 20 * 96), x = p[j * 3], z = p[j * 3 + 2];
      shoreline.push({ x: 5 + (x - 5) * 1.035, z: -9 + (z + 9) * 1.035,
        yaw: i * 2.399, scale: .10 + (i % 4) * .045 });
    }
    this.instance(stoneGeometry(), new THREE.MeshStandardMaterial({ ...surfaceMaps('rock'),
      color: 0x7b8170, roughness: .77 }), shoreline, 'Small wet stones along irregular waterline', .065);
    return material;
  }

  private candidate(min: number, max: number): Planting {
    // Reject rather than force a final invalid placement into the clearing.
    for (let attempt = 0; attempt < 160; attempt++) {
      const a = this.rng() * Math.PI * 2, d = min + this.rng() * (max - min);
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 4;
      const path = Math.abs(x - Math.sin(z * 0.15) * 1.25);
      if ((path < 1.15 && z < 3 && z > -25) || this.pondRadius(x, z) < 1.3 || Math.hypot(x + 1.7, z + 4.8) < 1.3) continue;
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
    const ferns = Array.from({ length: 84 }, (_, i) => {
      // A few low fronds at the trail's edge make the response discoverable
      // without putting plants inside the clear landing or movement corridor.
      const z = -3.6 - Math.floor(i / 2) * 1.9;
      const p = i < 10 ? { x: Math.sin(z * .15) * 1.25 + (i % 2 ? 1.7 : -1.7), z, yaw: i * 1.7, scale: 1 } : this.candidate(4.2, 19);
      p.scale = 0.65 + this.rng() * 0.5; return p;
    });
    const fernMaterial = new THREE.MeshStandardMaterial({ color: 0x547841, roughness: 0.86, side: THREE.DoubleSide });
    applyWind(fernMaterial, this.windTime, 0.04, 1.2);
    applyPlantPresence(fernMaterial, this.presence, 2.2, 0.24);
    const fernMesh = this.instance(fernGeometry(), fernMaterial, ferns, 'Paired fern fronds');
    this.proceduralFerns = fernMesh;
    fernMesh.customDepthMaterial = this.plantDepthMaterial(.04, 1.2, 2.2, .24);
    if (fernMesh.boundingSphere) fernMesh.boundingSphere.radius += 0.35;
    // Leaves grow as low clumps, 12–26cm high, and never in the landing area.
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const g = leafGeometry(0.19 + (i % 3) * 0.06, 0.012, 2);
      g.rotateX(-0.8 - (i % 2) * 0.3); g.rotateY(i * 2.4); blades.push(g);
    }
    const grassGeometry = mergeGeometries(blades)!; blades.forEach(g => g.dispose());
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x53693b, roughness: 0.95, side: THREE.DoubleSide });
    applyWind(grassMaterial, this.windTime, 0.08, 1.4);
    applyPlantPresence(grassMaterial, this.presence, 1.8, 0.14);
    const grass = Array.from({ length: 1400 }, () => {
      // The same broad cover pattern controls the moss below each clump.
      // Keep the count bounded while leaving natural gaps between colonies.
      let p = this.candidate(1.9, 23);
      for (let attempt = 0; attempt < 12 && this.rng() > .12 + forestGrowthAt(p.x, p.z) * .88; attempt++)
        p = this.candidate(1.9, 23);
      p.scale = 0.55 + this.rng() * 0.9; return p;
    });
    const grassMesh = this.instance(grassGeometry, grassMaterial, grass, 'Low woodland sedges along the trail');
    grassMesh.customDepthMaterial = this.plantDepthMaterial(.08, 1.4, 1.8, .14);
    if (grassMesh.boundingSphere) grassMesh.boundingSphere.radius += .2;
    const rockMaterial = new THREE.MeshStandardMaterial({ ...surfaceMaps('rock'), color: 0x9caa96, roughness: 0.94, normalScale: new THREE.Vector2(0.45, 0.45) });
    const rocks = Array.from({ length: 30 }, () => {
      const p = this.candidate(5.5, 26); p.scale = 0.17 + this.rng() ** 2 * 0.68; return p;
    });
    const stoneMesh = stoneGeometry();
    stoneMesh.computeBoundingBox();
    const stonePoints = stoneMesh.attributes.position;
    let stoneRadius = 0;
    for (let i = 0; i < stonePoints.count; i++) stoneRadius = Math.max(stoneRadius, Math.hypot(stonePoints.getX(i), stonePoints.getZ(i)));
    this.instance(stoneMesh, rockMaterial, rocks, 'Weathered woodland stones', 0.075);
    rocks.forEach((p, i) => this.collisions.addCircle({ id: `forest-stone-${i}`, x: p.x, z: p.z,
      radius: p.scale * stoneRadius, minY: this.groundHeight(p.x, p.z) + stoneMesh.boundingBox!.min.y * p.scale - .075,
      maxY: this.groundHeight(p.x, p.z) + stoneMesh.boundingBox!.max.y * p.scale - .075 }));
  }

  private plantDepthMaterial(wind: number, stiffness: number, radius: number, bend: number) {
    const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    // Desktop shadows must follow the same wind/proximity displacement as the
    // visible fronds. Both passes share clocks and participant-position uniforms.
    applyWind(material, this.windTime, wind, stiffness);
    applyPlantPresence(material, this.presence, radius, bend);
    return material;
  }

  private buildPerch() {
    const stone = new THREE.Mesh(stoneGeometry(), new THREE.MeshStandardMaterial({
      ...surfaceMaps('rock'), color: 0x879882, roughness: 0.9, normalScale: new THREE.Vector2(0.4, 0.4)
    }));
    const base = this.groundHeight(-1.7, -4.8);
    stone.position.set(-1.7, base - 0.08, -4.8); stone.scale.set(0.74, 0.4, 0.64);
    stone.castShadow = true; stone.receiveShadow = true; stone.name = 'Visitor resting stone';
    this.root.add(stone);
    stone.geometry.computeBoundingBox();
    const perimeter = stone.geometry.attributes.position;
    let radius = 0;
    for (let i = 0; i < perimeter.count; i++) radius = Math.max(radius, Math.hypot(perimeter.getX(i) * stone.scale.x, perimeter.getZ(i) * stone.scale.z));
    this.collisions.addCircle({ id: 'forest-perch', x: -1.7, z: -4.8, radius,
      minY: base - .08 + stone.geometry.boundingBox!.min.y * stone.scale.y,
      maxY: base - .08 + stone.geometry.boundingBox!.max.y * stone.scale.y });
    this.perchLocal.set(-1.7, base + 0.43, -4.8);
  }

  private buildForestDetails() {
    const barkTexture = new THREE.TextureLoader().load(assetUrl('/textures/refined/oak_color.jpg'));
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
      this.collisions.addCapsule({ id: `forest-log-${x}`, ax: points[0].x, az: points[0].z,
        bx: points[8].x, bz: points[8].z, radius: .2, minY: Math.min(...points.map(p => p.y)) - .18,
        maxY: Math.max(...points.map(p => p.y)) + .18 });
      for (const index of [0, points.length - 1]) {
        const end = new THREE.Mesh(new THREE.CircleGeometry(0.177, 20), new THREE.MeshStandardMaterial({ color: 0xb5976d, roughness: 1, side: THREE.DoubleSide }));
        end.name = 'Weathered cut wood'; end.position.copy(points[index]);
        end.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)));
        this.root.add(end);
      }
    }

  }

  private buildTrees() {
    this.conifers = new ForestConifers(this.root, (x, z) => this.groundHeight(x, z),
      () => this.stencilLayer, this.windTime, this.collisions);
    return this.conifers.ready.then(() => this.buildContactShade(this.conifers.bases));
  }

  private buildContactShade(spots: readonly ForestTreeBase[]) {
    if (!spots.length) return;
    const patches: THREE.BufferGeometry[] = [];
    for (const p of spots) {
      const g = new THREE.PlaneGeometry(3.2 * p.scale, 3.2 * p.scale, 5, 5);
      g.rotateX(-Math.PI / 2); g.translate(p.x, 0, p.z);
      const a = g.attributes.position;
      for (let i = 0; i < a.count; i++) a.setY(i, this.groundHeight(a.getX(i), a.getZ(i)) + 0.012);
      patches.push(g);
    }
    const geometry = mergeGeometries(patches)!; patches.forEach(g => g.dispose());
    const shade = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: contactTexture(), color: 0x202719, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    shade.name = 'Contact shade at measured forest trunk bases';
    this.root.add(shade);
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
    const dt = this.previousTime === undefined ? 0 : THREE.MathUtils.clamp(time - this.previousTime, 0, 0.1);
    this.previousTime = time;
    this.fauna.update(dt);
    const p = this.motes.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, this.moteBase[i * 3] + Math.sin(time * 0.23 + i) * 0.15,
        this.moteBase[i * 3 + 1] + Math.sin(time * 0.35 + i * 2) * 0.08, this.moteBase[i * 3 + 2]);
    }
    p.needsUpdate = true;
    if (this.pondMaterial.normalMap) this.pondMaterial.normalMap.offset.set(time * .008, time * .005);
  }
}
