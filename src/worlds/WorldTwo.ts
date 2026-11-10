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
import { ForestSample } from './ForestSample';
import { inForestSample } from './ForestSampleLayout';
import { applySampleSoil } from './ForestSampleGround';
import { ForestUnderstory } from './ForestUnderstory';
import { forestOrganicRelief } from './ForestHabitat';
import { ForestShadowRefresh } from './ForestShadowRefresh';
import { ForestFrameTiming } from './ForestFrameTiming';
import { forestPondRadius, forestPondBankLift, forestPondGeometry, forestPondShore, forestPondMaterial, applyForestPondBank } from './ForestPond';

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
  readonly groundSample: ForestSample;
  readonly understory: ForestUnderstory;
  conifers!: ForestConifers;
  forestFloorReady = false;
  photographicSkyReady = false;
  stencilLayer = 1;
  private rng = mulberry32(2301);
  private windTime = { value: 0 };
  readonly presence = new EnvironmentalPresence();
  readonly frameTiming = new ForestFrameTiming();
  private previousTime: number | undefined;
  private motes: THREE.Points;
  private moteBase: Float32Array;
  private worldPoint = new THREE.Vector3();
  private alignmentDirection = new THREE.Vector3();
  private alignmentQuaternion = new THREE.Quaternion();
  private proceduralFerns!: THREE.InstancedMesh;
  private shadowRefresh?: ForestShadowRefresh;

  constructor(origin: THREE.Vector3) {
    this.root.name = 'Forest · grounded glade';
    this.root.position.set(origin.x, 0, origin.z);
    this.scene.add(this.root);
    this.scene.fog = new THREE.FogExp2(0x9ba78b, 0.012);
    // 32,768 terrain triangles carry shallow forest-wide organic relief. The same
    // stored triangles are queried for every planting and the walking camera.
    this.terrain = new HeightField(112, 128, (x, z) => {
      const d = Math.hypot(x, z + 4);
      const banks = THREE.MathUtils.smoothstep(d, 5, 18);
      const hills = (1.0 + Math.sin(x * .18) * Math.cos(z * .12) * .85 + Math.sin(z * .10) * .48) * banks;
      const pond = this.pondRadius(x, z);
      const trailDistance = Math.abs(x - Math.sin(z * .15) * 1.25);
      const relief = .11 * Math.sin(x * 1.7 + Math.cos(z * .8)) * Math.sin(z * 1.1)
        * THREE.MathUtils.smoothstep(trailDistance, 1, 2.6) * THREE.MathUtils.smoothstep(Math.hypot(x,z), 1.8, 3.2);
      return hills + relief * THREE.MathUtils.smoothstep(pond, 1.25, 1.65) - (1 - THREE.MathUtils.smoothstep(pond, 0.6, 1.18)) * (hills + 0.23)
        + forestOrganicRelief(x, z) + forestPondBankLift(x, z);
    });
    const treesReady = this.buildTrees();
    const floorReady = this.buildGround();
    const skyReady = this.buildSkyAndLight();
    this.buildPond();
    this.buildPlanting();
    this.buildPerch();
    this.buildForestDetails();
    this.scannedDetails = new ForestDetails(this.root, (x, z) => this.groundHeight(x, z),
      () => this.stencilLayer, this.windTime, this.presence, () => { this.proceduralFerns.visible = false; }, this.collisions);
    this.groundSample = new ForestSample(this.root, (x, z) => this.terrain.heightAt(x, z),
      () => this.stencilLayer, this.windTime, this.presence, this.collisions,
      Promise.all([treesReady, floorReady, this.scannedDetails.ready]), () => this.activateGroundSample());
    this.fauna = new ForestFauna(this.root, (x, z) => this.groundHeight(x, z), () => this.stencilLayer, this.collisions);
    this.understory = new ForestUnderstory(this.root, this.groundSample, (x, z) => this.groundHeight(x, z),
      () => this.stencilLayer, this.windTime, this.presence, this.collisions, this.fauna);
    this.moteBase = new Float32Array(90 * 3);
    this.motes = this.buildMotes();
    this.refreshStencil();
    this.ready = Promise.all([treesReady, floorReady, skyReady,
      this.scannedDetails.ready, this.fauna.ready, this.groundSample.ready, this.understory.ready]).then(() => {
      if (this.forestFloorReady) {
        const floor = this.root.getObjectByName('Continuous forest floor') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
        applyForestPondBank(floor.material);
      }
      // The canopy shadow is cached. Moving animals must not leave frozen
      // silhouettes in it; their existing contact shading remains available.
      this.fauna.root.traverse(object => {
        if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).castShadow = false;
      });
      this.shadowRefresh?.invalidate();
    }).catch(error => {
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
    this.shadowRefresh?.invalidate();
  }
  get walkBounds() { return { center: this.root.localToWorld(new THREE.Vector3(0, 0, -4)), radius: 20 }; }
  get nextSeamHint() { return this.root.localToWorld(new THREE.Vector3(0, 0, -3)); }
  refreshStencil() { applyStencilLayer(this.scene, this.stencilLayer); }
  groundHeight(x: number, z: number) {
    return this.groundSample?.status === 'ready' && inForestSample(x, z)
      ? this.groundSample.heightAt(x, z) : this.terrain.heightAt(x, z);
  }
  groundHeightWorld(x: number, z: number) { return this.groundAt(x, z); }
  groundAt(x: number, z: number) {
    this.root.updateWorldMatrix(true, false);
    this.worldPoint.set(x, 0, z);
    this.root.worldToLocal(this.worldPoint);
    return this.groundHeight(this.worldPoint.x, this.worldPoint.z) + this.root.position.y;
  }

  updateView(viewerPosition: THREE.Vector3, active: boolean, dt: number) {
    this.frameTiming.sample(performance.now(), active);
    this.presence.update(viewerPosition, active, dt);
    this.fauna.updateView(viewerPosition, active, dt);
    this.understory.updateView(viewerPosition, active, dt);
  }

  private pondRadius(x: number, z: number) { return forestPondRadius(x, z); }

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
    // Grass writes depth first, so the layered soil shader runs only in gaps.
    // This changes opaque submission order, never geometry or visible layers.
    ground.renderOrder = 5;
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
      shader.uniforms.forestHorizonFog = { value: new THREE.Color(0x9ba78b) };
      shader.fragmentShader = 'uniform vec3 forestHorizonFog;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n#ifdef USE_MAP\nfloat horizonMist = 1.0 - smoothstep(0.495, 0.555, vMapUv.y);\ndiffuseColor.rgb = mix(diffuseColor.rgb, forestHorizonFog, horizonMist * 0.70);\n#endif');
    };
    material.customProgramCacheKey = () => 'forest-photographic-horizon-mist-v2-daylight';
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
    // The depth buffer already identifies uncovered sky pixels at this point.
    sky.renderOrder = 10; this.root.add(sky);
    const ready = new HDRLoader().loadAsync(assetUrl('/hdri/forest_slope_2k.hdr')).then(texture => {
      material.map = texture; material.color.setScalar(.98); material.needsUpdate = true;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = texture; this.scene.environmentIntensity = .68;
      this.scene.environmentRotation.y = Math.PI / 2 + this.root.rotation.y;
      applyStencilLayer(sky, this.stencilLayer);
      this.photographicSkyReady = true;
    }).catch(error => console.warn('Photographic forest sky unavailable; retaining local daylight.', error));
    this.root.add(new THREE.HemisphereLight(0xe3efff, 0x87915e, 1.02));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.90);
    sun.position.set(-20, 28, 8); sun.target.position.set(0, 0, -10);
    sun.castShadow = CONFIG.render.shadows;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 95 });
    sun.shadow.bias = -.00015; sun.shadow.normalBias = .018;
    this.shadowRefresh = new ForestShadowRefresh(sun.shadow, 0);
    this.root.add(sun, sun.target);
    return ready;
  }

  private buildPond() {
    const shore = forestPondShore((x, z) => this.groundHeight(x, z));
    const water = new THREE.Mesh(forestPondGeometry(this.terrain.geometry), forestPondMaterial(this.windTime));
    water.name = 'Shallow glade pool'; water.receiveShadow = true;
    water.matrixAutoUpdate = false; water.updateMatrix(); this.root.add(water);
    // Follow the actual clipped shoreline, including its shallow irregular
    // edges on the lighter terrain grid, rather than a fixed ellipse.
    this.collisions.addPolygon({ id: 'forest-pond', headOcclusion: false, points: shore.map(p => {
      const dx = p.x - 5, dz = p.z + 9, scale = 1 + .12 / Math.hypot(dx, dz);
      return { x: 5 + dx * scale, z: -9 + dz * scale };
    }) });
    const shoreRandom = mulberry32(9812), shoreline: Planting[] = [];
    const colonies = [.16, 1.31, 2.83, 4.16, 5.54];
    for (let i = 0; i < 20; i++) {
      const angle = colonies[Math.floor(i / 4)] + (shoreRandom() - .5) * .40;
      const j = Math.round(angle / (Math.PI * 2) * shore.length) % shore.length;
      const at = shore[(j + shore.length) % shore.length];
      const inset = .975 + shoreRandom() * .095;
      shoreline.push({ x: 5 + (at.x - 5) * inset, z: -9 + (at.z + 9) * inset,
        yaw: shoreRandom() * Math.PI * 2, scale: .075 + shoreRandom() ** 1.6 * .20 });
    }
    // Keep twenty calls to instance()'s colour RNG, so later forest planting
    // retains exactly the same horizontal distribution as the approved scene.
    const stones = this.instance(stoneGeometry(), new THREE.MeshStandardMaterial({ ...surfaceMaps('rock'),
      color: 0x9ba38e, roughness: .66, normalScale: new THREE.Vector2(.4, .4) }),
      shoreline, 'Small wet stones along irregular waterline', .075);
    stones.matrixAutoUpdate = false; stones.updateMatrix();
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

  private activateGroundSample() {
    // Compact after the original deterministic forest has been generated.
    // Filtering earlier would consume fewer RNG values and move outside props.
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    for (const name of ['Low woodland sedges along the trail', 'Weathered woodland stones']) {
      const mesh = this.root.getObjectByName(name) as THREE.InstancedMesh;
      let kept = 0;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        if (inForestSample(matrix.elements[12], matrix.elements[14])) {
          if (name === 'Weathered woodland stones') this.collisions.remove(`forest-stone-${i}`);
          continue;
        }
        mesh.setMatrixAt(kept, matrix);
        if (mesh.instanceColor) { mesh.getColorAt(i, color); mesh.setColorAt(kept, color); }
        kept++;
      }
      mesh.count = kept; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere && name.startsWith('Low woodland')) mesh.boundingSphere.radius += .2;
    }
    if (this.forestFloorReady) {
      const ground = this.root.getObjectByName('Continuous forest floor') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      applySampleSoil(ground.material);
    }
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
    this.understory.updateWind(time);
    this.conifers.optimizedWind.update(time);
    this.scannedDetails.optimizedWind.update(time);
    this.shadowRefresh?.update(time);
    const dt = this.previousTime === undefined ? 0 : THREE.MathUtils.clamp(time - this.previousTime, 0, 0.1);
    this.previousTime = time;
    this.fauna.update(dt);
    const p = this.motes.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, this.moteBase[i * 3] + Math.sin(time * 0.23 + i) * 0.15,
        this.moteBase[i * 3 + 1] + Math.sin(time * 0.35 + i * 2) * 0.08, this.moteBase[i * 3 + 2]);
    }
    p.needsUpdate = true;
  }
}
