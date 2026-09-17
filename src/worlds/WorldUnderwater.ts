import * as THREE from 'three';
import { mulberry32 } from '../utils/math';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { HeightField } from './terrain';
import { MarineLife } from './MarineLife';
import { surfaceMaps, stoneGeometry, contactTexture } from './nature';
import { coralBranches, plateCoral, tubeSponges, seaFan, ribbonPlant, scallopShell, seaStar, anemone } from './underwaterNature';

export interface ReefAttachment { object: THREE.Object3D; instance: number }
type Planting = { x: number; z: number; scale: number; yaw: number };

/** A fully virtual, sunlit reef shelf. Every planted base is tied to a rendered terrain triangle. */
export class WorldUnderwater {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  readonly leakColor = new THREE.Color(0x54cad2);
  readonly leanDetails: THREE.MeshBasicMaterial[] = [];
  readonly terrain: HeightField;
  readonly groundAttachments: ReefAttachment[] = [];
  readonly soundSpots = { water: new THREE.Vector3(0, 5, -8), bubbles: new THREE.Vector3(-4, 2, -5), whale: new THREE.Vector3(8, 14, -20), near: new THREE.Vector3(0, 1, -1) };
  readonly ready: Promise<void>;
  readonly marineLife: MarineLife;
  private previousTime: number | undefined;
  stencilLayer = 1;
  private readonly rng = mulberry32(83479);
  private readonly time = { value: 0 };
  private readonly worldPoint = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly particles: THREE.Points;
  private readonly particleBase = new Float32Array(280 * 3);
  private readonly bubbles: THREE.InstancedMesh;
  private readonly bubbleBase = new Float32Array(72 * 4);
  private readonly transform = new THREE.Object3D();
  private readonly reefCenters = [new THREE.Vector2(-7, -7), new THREE.Vector2(8, -12), new THREE.Vector2(-11, -22), new THREE.Vector2(14, -27), new THREE.Vector2(-18, 4), new THREE.Vector2(21, -4)];

  constructor(origin: THREE.Vector3) {
    this.root.name = 'Underwater · the sunlit reef';
    this.root.position.set(origin.x, 0, origin.z);
    this.scene.add(this.root);
    this.scene.fog = new THREE.FogExp2(0x237d91, .023);
    this.terrain = new HeightField(126, 128, (x, z) => {
      const route = THREE.MathUtils.smoothstep(Math.abs(x - Math.sin(z * .12) * 1.1), 2.6, 6.2);
      const landing = THREE.MathUtils.smoothstep(Math.hypot(x, z), 2.8, 6);
      let shelf = 0;
      for (const p of this.reefCenters) shelf += 1.25 * Math.exp(-((x - p.x) ** 2 / 29 + (z - p.y) ** 2 / 38));
      const wave = .035 * Math.sin(x * 1.7 + Math.sin(z * .32)) + .028 * Math.sin(z * 1.2 + x * .28);
      return (shelf * route + wave + .075 * Math.sin(z * .17) * Math.cos(x * .22)) * landing;
    });
    this.buildSeabed();
    this.buildWaterAndLight();
    this.buildReef();
    this.buildPlanting();
    this.buildMicroLife();
    this.particles = this.buildMarineSnow();
    this.bubbles = this.buildBubbles();
    this.animateBubbles(0);
    this.refreshStencil();
    this.marineLife = new MarineLife(this.root, () => this.stencilLayer);
    this.ready = this.marineLife.ready.then(() => this.refreshStencil());
  }

  alignTo(anchor: THREE.Object3D) {
    anchor.getWorldPosition(this.worldPoint);
    anchor.getWorldQuaternion(this.quaternion);
    this.direction.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.root.position.set(this.worldPoint.x, 0, this.worldPoint.z);
    // Only yaw rotates the floor; headset lean/pitch must never tip the seabed.
    this.root.rotation.set(0, Math.atan2(this.direction.x, this.direction.z), 0);
    this.root.updateMatrixWorld(true);
  }
  get walkBounds() { return { center: this.root.localToWorld(new THREE.Vector3(0, 0, -5)), radius: 21 }; }
  get nextSeamHint() { return this.root.localToWorld(new THREE.Vector3(0, 0, -3)); }
  refreshStencil() { applyStencilLayer(this.scene, this.stencilLayer); }
  groundHeight(x: number, z: number) { return this.terrain.heightAt(x, z); }
  groundHeightWorld(x: number, z: number) { return this.groundAt(x, z); }
  groundAt(x: number, z: number) {
    this.root.updateWorldMatrix(true, false);
    this.worldPoint.set(x, 0, z); this.root.worldToLocal(this.worldPoint);
    return this.groundHeight(this.worldPoint.x, this.worldPoint.z) + this.root.position.y;
  }

  /** The same low-frequency caustic pattern lights sand, stone and coral. */
  private underwaterMaterial(parameters: THREE.MeshStandardMaterialParameters, current = 0, sand = false) {
    const material = new THREE.MeshStandardMaterial(parameters);
    material.onBeforeCompile = shader => {
      shader.uniforms.uReefTime = this.time;
      shader.vertexShader = `uniform float uReefTime; varying vec3 vReefPosition; varying float vReefUp;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        ${current > 0 ? `float reefPin=clamp(position.y,0.,1.); transformed.x += sin(uReefTime*.55+position.y*1.5+position.z*2.)*reefPin*${current.toFixed(3)}; transformed.z += cos(uReefTime*.37+position.y*1.7)*reefPin*${(current * .43).toFixed(3)};` : ''}
        vec4 reefPosition=vec4(transformed,1.);
        #ifdef USE_INSTANCING
          reefPosition=instanceMatrix*reefPosition;
        #endif
        vReefPosition=(modelMatrix*reefPosition).xyz; vReefUp=clamp(normal.y*.6+.4,0.,1.);`);
      shader.fragmentShader = `uniform float uReefTime; varying vec3 vReefPosition; varying float vReefUp;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 reefUV=vReefPosition.xz;
        ${sand ? `float ripple=sin(reefUV.x*17.+sin(reefUV.y*2.2)*1.8); float fine=sin(reefUV.x*109.+reefUV.y*147.)*sin(reefUV.y*87.-reefUV.x*93.); diffuseColor.rgb*=.91+.075*ripple+.024*fine;` : ''}
        float netA=sin(reefUV.x*.91+sin(reefUV.y*.71+uReefTime*.27)*1.35+uReefTime*.24);
        float netB=cos(reefUV.y*1.03+sin(reefUV.x*.59-uReefTime*.21)*1.3-uReefTime*.18);
        float reefLight=pow(clamp(1.-abs(netA+netB)*2.8,0.,1.),4.);
        diffuseColor.rgb += vec3(.27,.48,.43)*reefLight*.24*vReefUp;`);
    };
    material.customProgramCacheKey = () => `reef-caustics-${current}-${sand}`;
    return material;
  }

  private buildSeabed() {
    const g = this.terrain.geometry, p = g.attributes.position;
    const colors = new Float32Array(p.count * 3), color = new THREE.Color();
    const sand = new THREE.Color(0xd5d2b4), lagoon = new THREE.Color(0x879f8e);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const side = THREE.MathUtils.smoothstep(Math.abs(x), 3, 16);
      color.copy(sand).lerp(lagoon, side * .45).multiplyScalar(.96 + Math.sin(x * .48 + z * .38) * .04);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const seabed = new THREE.Mesh(g, this.underwaterMaterial({ vertexColors: true, roughness: .97 }, 0, true));
    seabed.name = 'Continuous rippled sand · precise contact surface'; seabed.receiveShadow = true; this.root.add(seabed);
  }

  private buildWaterAndLight() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(145, 32, 20), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vDirection;
        void main(){vec3 d=normalize(vDirection); vec3 c=mix(vec3(.018,.125,.23),vec3(.11,.45,.53),smoothstep(-.3,.7,d.y));
          float sun=pow(max(0.,dot(d,normalize(vec3(-.3,.91,-.28)))),12.); c+=vec3(.17,.37,.36)*sun;
          c=mix(vec3(.016807,.205079,.283149),c,smoothstep(.15,.65,d.y));
          gl_FragColor=vec4(c,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    sky.name = 'Opaque ocean depth · fully virtual water'; sky.renderOrder = -10; this.root.add(sky);
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(360, 360, 32, 32), new THREE.ShaderMaterial({
      side: THREE.DoubleSide, uniforms: { uTime: this.time },
      vertexShader: `varying vec2 vWater; uniform float uTime; void main(){vWater=position.xy;vec3 p=position;p.z+=sin(position.x*.21+uTime*.28)*.16+cos(position.y*.18-uTime*.22)*.12;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `varying vec2 vWater; uniform float uTime;
        void main(){vec2 p=vWater;float a=sin(p.x*.48+sin(p.y*.39+uTime*.14)*1.6+uTime*.19);float b=sin(p.y*.51+sin(p.x*.34-uTime*.17)*1.7-uTime*.16);
          float filigree=pow(clamp(1.-abs(a+b)*2.1,0.,1.),3.);float sun=exp(-dot(p-vec2(-8.,9.),p-vec2(-8.,9.))*.014);
          float haze=exp(-length(p)*.014);vec3 c=mix(vec3(.065,.31,.41),vec3(.25,.61,.64),haze);
          c+=vec3(.14,.27,.24)*filigree*haze+vec3(.45,.60,.47)*sun;
          c=mix(c,vec3(.016807,.205079,.283149),smoothstep(36.,125.,length(p)));
          gl_FragColor=vec4(c,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }));
    surface.rotateX(-Math.PI / 2); surface.position.y = 22;
    surface.name = 'Rippling water ceiling · sunlit surface above'; this.root.add(surface);
    this.root.add(new THREE.HemisphereLight(0xb2ebef, 0x52776c, 2.1));
    const sun = new THREE.DirectionalLight(0xcefff0, 2.65);
    sun.position.set(-10, 24, -8); sun.target.position.set(0, 0, -12); this.root.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0x387894, .7); fill.position.set(18, 5, 10); this.root.add(fill);
    // Thin, broad-edged volumes are placed beyond the arrival area, never on the camera.
    const rayMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec2 vUv;uniform float uTime;void main(){float edge=pow(sin(vUv.x*3.14159265),3.);float taper=sin(vUv.y*3.14159265);float motion=.85+.15*sin(uTime*.22+vUv.y*4.);gl_FragColor=vec4(.32,.66,.65,edge*taper*motion*.027);}`
    });
    const rayGeometry = new THREE.CylinderGeometry(.45, 2.8, 20, 24, 1, true);
    for (const [x, z, lean] of [[-10, -14, .19], [-17, -23, .23], [9, -22, .13], [17, -32, .17]]) {
      const ray = new THREE.Mesh(rayGeometry, rayMaterial); ray.position.set(x, 11, z); ray.rotation.z = -lean;
      ray.name = 'Soft submerged sun shaft'; this.root.add(ray);
    }
  }

  private candidate(min = 4, max = 29): Planting {
    for (let attempt = 0; attempt < 240; attempt++) {
      const center = this.reefCenters[Math.floor(this.rng() * this.reefCenters.length)];
      const a = this.rng() * Math.PI * 2, d = this.rng() ** .6 * 5.2;
      const x = center.x + Math.cos(a) * d, z = center.y + Math.sin(a) * d;
      const routeDistance = Math.abs(x - Math.sin(z * .12) * 1.1);
      const radial = Math.hypot(x, z + 4);
      if (routeDistance < 3 || radial < min || radial > max || Math.hypot(x, z) < 4.5) continue;
      return { x, z, yaw: this.rng() * Math.PI * 2, scale: .7 + this.rng() * .65 };
    }
    return { x: 8, z: 6, yaw: 0, scale: 1 };
  }

  private instances(g: THREE.BufferGeometry, material: THREE.Material, spots: Planting[], name: string, colors?: number[]) {
    const mesh = new THREE.InstancedMesh(g, material, spots.length);
    mesh.name = name;
    const transform = this.transform;
    spots.forEach((p, i) => {
      transform.position.set(p.x, this.groundHeight(p.x, p.z), p.z);
      transform.rotation.set(0, p.yaw, 0); transform.scale.setScalar(p.scale); transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      const color = new THREE.Color(colors ? colors[i % colors.length] : 0xffffff);
      color.multiplyScalar(.89 + this.rng() * .15); mesh.setColorAt(i, color);
      this.groundAttachments.push({ object: mesh, instance: i });
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    this.root.add(mesh); applyStencilLayer(mesh, this.stencilLayer); return mesh;
  }

  private buildReef() {
    const stone = stoneGeometry();
    stone.computeBoundingBox(); stone.translate(0, -stone.boundingBox!.min.y, 0);
    const rockMaterial = this.underwaterMaterial({ ...surfaceMaps('rock', 1.8), color: 0xa6aa8b, normalScale: new THREE.Vector2(.42, .42), roughness: 1 });
    const stones = Array.from({ length: 44 }, () => { const p = this.candidate(); p.scale = .42 + this.rng() * 1.17; return p; });
    this.instances(stone, rockMaterial, stones, 'Weathered limestone reef boulders');
    const big = this.reefCenters.filter(p => Math.abs(p.x) > 10).map(p => ({ x: p.x, z: p.y, scale: 1.75 + this.rng() * .5, yaw: this.rng() * 6.28 }));
    this.instances(stone, rockMaterial, big, 'Distant reef outcrops');
    const make = (count: number, minScale: number, range: number) => Array.from({ length: count }, () => { const p = this.candidate(); p.scale = minScale + this.rng() * range; return p; });
    const coralMaterial = this.underwaterMaterial({ color: 0xffffff, roughness: .82, side: THREE.DoubleSide });
    this.instances(coralBranches(), coralMaterial, make(24, .65, .8), 'Branching staghorn coral colonies', [0xc78b77, 0xe0cba3, 0xba919d, 0x96b5b0]);
    this.instances(plateCoral(), coralMaterial, make(20, .8, .9), 'Layered lettuce and table corals', [0xc3a286, 0x9bb5a1, 0xa49abb, 0xbb8e79]);
    this.instances(tubeSponges(), coralMaterial, make(26, .75, .85), 'Open tube sponge gardens', [0xbba579, 0x9b8daa, 0xb28f80]);
    const brain = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = brain.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const ridge = 1 + .032 * Math.sin(x * 26 + Math.sin(z * 15) * 2) * Math.sin(z * 21 + y * 11); p.setXYZ(i, x * ridge, y * .5 * ridge, z * ridge); }
    brain.computeVertexNormals();
    this.instances(brain, coralMaterial, make(15, .45, .52), 'Ridged brain coral mounds', [0xb0b28a, 0xb89b82, 0x99aca3]);
    const shade = new THREE.MeshBasicMaterial({ map: contactTexture(), color: 0x244d4d, transparent: true, opacity: .19, depthWrite: false });
    const shadeGeometry = new THREE.PlaneGeometry(2, 2); shadeGeometry.rotateX(-Math.PI / 2); shadeGeometry.translate(0, .016, 0);
    this.instances(shadeGeometry, shade, stones.map(p => ({ ...p, scale: p.scale * 1.4 })), 'Soft contact shade beneath reef stones');
  }

  private buildPlanting() {
    const fans = Array.from({ length: 18 }, () => { const p = this.candidate(); p.scale *= 1.13; return p; });
    this.instances(seaFan(), this.underwaterMaterial({ color: 0xffffff, roughness: .78, side: THREE.DoubleSide }, .055), fans, 'Swaying lace sea fans', [0xae7991, 0xd6ac8f, 0x9d83a7]);
    const kelp = Array.from({ length: 28 }, (_, i) => ({ x: (i % 2 ? 1 : -1) * (14 + this.rng() * 10), z: -8 - this.rng() * 27, yaw: this.rng() * 6.28, scale: .7 + this.rng() * .55 }));
    this.instances(ribbonPlant(true), this.underwaterMaterial({ color: 0x668779, roughness: .82, side: THREE.DoubleSide }, .18), kelp, 'Long current-swept reef seaweed');
    const grass = Array.from({ length: 190 }, () => { const p = this.candidate(3.5, 32); p.scale = .75 + this.rng() * .95; return p; });
    this.instances(ribbonPlant(false), this.underwaterMaterial({ color: 0x719b85, roughness: .9, side: THREE.DoubleSide }, .06), grass, 'Rooted seagrass meadows');
  }

  private buildMicroLife() {
    const near = (count: number) => Array.from({ length: count }, () => {
      const a = this.rng() * Math.PI * 2, d = 2.8 + this.rng() * 8;
      return { x: Math.cos(a) * d, z: Math.sin(a) * d - 3, scale: .8 + this.rng() * .6, yaw: this.rng() * 6.28 };
    });
    this.instances(scallopShell(), this.underwaterMaterial({ color: 0xe0d4be, roughness: .7, side: THREE.DoubleSide }), near(30), 'Tiny ribbed scallop shells on sand');
    this.instances(seaStar(), this.underwaterMaterial({ color: 0xc58d74, roughness: .92 }), near(12), 'Small sand-resting sea stars');
    this.instances(anemone(), this.underwaterMaterial({ color: 0xa1b8b8, roughness: .7 }, .012), near(14), 'Soft current-touched anemone tentacles');
  }

  private buildMarineSnow() {
    const position = new Float32Array(this.particleBase.length);
    for (let i = 0; i < position.length; i += 3) {
      position[i] = (this.rng() - .5) * 67;
      position[i + 1] = .9 + this.rng() * 20;
      position[i + 2] = (this.rng() - .5) * 67 - 8;
    }
    this.particleBase.set(position);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    const material = new THREE.PointsMaterial({ color: 0xbad9d6, size: .032, sizeAttenuation: true, map: contactTexture(), transparent: true, opacity: .27, depthWrite: false });
    const particles = new THREE.Points(g, material); particles.name = 'Slow marine snow · fine suspended particles'; this.root.add(particles); return particles;
  }

  private buildBubbles() {
    const material = new THREE.MeshStandardMaterial({ color: 0xb9e2e0, metalness: .18, roughness: .13, transparent: true, opacity: .19, depthWrite: false });
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), material, 72);
    mesh.name = 'Small ascending reef bubbles';
    const sources = [[-4.7, -8.1], [6.2, -13.8], [-10.5, -20]];
    for (let i = 0; i < 72; i++) { const source = sources[i % sources.length]; this.bubbleBase.set([source[0] + (this.rng() - .5) * .5, this.rng() * 20, source[1] + (this.rng() - .5) * .5, .018 + this.rng() * .047], i * 4); }
    this.root.add(mesh); return mesh;
  }

  private animateBubbles(time: number) {
    // Called after construction in update; initial matrices are set there too.
    if (!this.bubbles) return;
    for (let i = 0; i < 72; i++) {
      const k = i * 4, h = (this.bubbleBase[k + 1] + time * (.21 + (i % 5) * .023)) % 20;
      this.transform.position.set(this.bubbleBase[k] + Math.sin(h * .4 + i) * .17, this.groundHeight(this.bubbleBase[k], this.bubbleBase[k + 2]) + .12 + h, this.bubbleBase[k + 2] + Math.cos(h * .3 + i) * .11);
      this.transform.rotation.set(0, 0, 0); this.transform.scale.setScalar(this.bubbleBase[k + 3] * (1 + h * .023)); this.transform.updateMatrix(); this.bubbles.setMatrixAt(i, this.transform.matrix);
    }
    this.bubbles.instanceMatrix.needsUpdate = true; this.bubbles.computeBoundingSphere();
  }

  update(time: number, _lean: number) {
    this.time.value = time;
    const dt = this.previousTime === undefined ? 0 : THREE.MathUtils.clamp(time - this.previousTime, 0, .05);
    this.previousTime = time;
    this.marineLife.update(time, dt);
    const positions = this.particles.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const k = i * 3;
      positions.setXYZ(i, this.particleBase[k] + Math.sin(time * .075 + i * 1.7) * .45, .7 + ((this.particleBase[k + 1] - time * .018 + 200) % 20), this.particleBase[k + 2] + Math.cos(time * .053 + i) * .23);
    }
    positions.needsUpdate = true; this.animateBubbles(time);
  }
}
