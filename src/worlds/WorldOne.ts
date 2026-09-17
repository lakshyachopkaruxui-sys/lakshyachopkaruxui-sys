import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../utils/math';
import { dotTexture } from '../utils/sprites';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { fitProp, standOnOrigin } from './props';

/**
 * A furnished, walkable room for desktop / opaque VR. All visible room content
 * lives under root so the AR beginning can reveal the user's actual room.
 * The central 2.5m walking disk stays free of solid furniture.
 */
export class WorldOne {
  readonly scene = new THREE.Scene();
  readonly root = new THREE.Group();
  /** The final visitor sits on the same desk the player saw at the beginning. */
  readonly revealSpot = new THREE.Vector3(-1.55, 0.79, -4.25);
  readonly leakColor: THREE.Color;
  readonly soundSpots: Record<string, THREE.Vector3> = {
    window: new THREE.Vector3(-3.2, 1.8, -2.55),
    room: new THREE.Vector3(0, 1.2, -1.6)
  };
  private dust: THREE.Points;
  private rng = mulberry32(11);
  private contactMap: THREE.CanvasTexture;
  stencilLayer = 0;

  /** @param echo the same room at dawn, after the journey */
  constructor(echo = false) {
    this.leakColor = new THREE.Color(echo ? 0xffd2a0 : 0xb8c9d7);
    this.scene.add(this.root);
    this.scene.fog = new THREE.Fog(echo ? 0xc4b5a0 : 0xadb9bf, 11, 28);
    this.contactMap = this.softTexture();

    const W = 6.5, D = 7.5, H = 3.1;
    const oakMap = this.oakTexture();
    const furnitureGrain = this.oakTexture(false);
    const floorMap = oakMap.clone();
    floorMap.repeat.set(2, 2.5);
    floorMap.needsUpdate = true;
    const plaster = this.plasterTexture();
    const wall = new THREE.MeshStandardMaterial({ color: 0xd8d4cb, map: plaster, bumpMap: plaster, bumpScale: 0.004, roughness: 0.94 });
    const ceiling = new THREE.MeshStandardMaterial({ color: 0xe1ded7, roughness: 0.97 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xdedbd3, roughness: 0.63 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xbba88f, map: furnitureGrain, bumpMap: furnitureGrain, bumpScale: 0.003, roughness: 0.65 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x403f3b, roughness: 0.42, metalness: 0.55 });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: 0xe0d3bf, map: floorMap, bumpMap: floorMap, bumpScale: 0.006, roughness: 0.72 })
    );
    floor.name = 'oak plank floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -1.2);
    floor.receiveShadow = true;
    this.root.add(floor);
    this.box(this.root, [W, 0.14, D], [0, H + 0.07, -1.2], ceiling, 'ceiling');
    this.box(this.root, [W, H, 0.14], [0, H / 2, -5.02], wall, 'rear plaster wall');
    this.box(this.root, [W, H, 0.14], [0, H / 2, 2.62], wall, 'entry plaster wall');
    this.box(this.root, [0.14, H, D], [3.32, H / 2, -1.2], wall, 'right plaster wall');

    // A real wall opening: the view is recessed behind the frame, not stuck
    // over an unbroken wall. Coordinates match the original room footprint.
    this.box(this.root, [0.14, H, 1.55], [-3.32, H / 2, -4.175], wall, 'window wall rear');
    this.box(this.root, [0.14, H, 4.25], [-3.32, H / 2, 0.425], wall, 'window wall front');
    this.box(this.root, [0.14, 1, 1.7], [-3.32, 0.5, -2.55], wall, 'window wall below');
    this.box(this.root, [0.14, H - 2.58, 1.7], [-3.32, (H + 2.58) / 2, -2.55], wall, 'window wall above');
    for (const [z, len] of [[-4.91, W], [2.51, W]] as const) {
      this.box(this.root, [len, 0.12, 0.04], [0, 0.06, z], trim, 'skirting');
      this.box(this.root, [len, 0.055, 0.05], [0, H - 0.03, z], trim, 'ceiling trim');
    }
    for (const x of [-3.21, 3.21]) {
      this.box(this.root, [0.04, 0.12, D], [x, 0.06, -1.2], trim, 'skirting');
      this.box(this.root, [0.05, 0.055, D], [x, H - 0.03, -1.2], trim, 'ceiling trim');
    }

    this.buildWindow(trim, metal, echo);
    this.buildFurnishings(wood, trim, metal, echo);
    this.buildLighting(echo);
    if (echo) this.buildEchoTraces();

    const count = 80;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (this.rng() - 0.5) * 5;
      pos[i * 3 + 1] = 0.2 + this.rng() * 2.6;
      pos[i * 3 + 2] = -1.2 + (this.rng() - 0.5) * 6;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xd7d1c4, size: 0.009, map: dotTexture(), transparent: true, opacity: 0.17, depthWrite: false }));
    this.dust.name = 'quiet dust';
    this.root.add(this.dust);
  }

  private box(parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], material: THREE.Material, name: string, radius = 0) {
    const geometry = radius > 0
      ? new RoundedBoxGeometry(...size, 2, Math.min(radius, Math.min(...size) / 2))
      : new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...at);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildWindow(trim: THREE.Material, metal: THREE.Material, echo: boolean) {
    const view = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.58), new THREE.MeshBasicMaterial({ map: this.windowTexture(echo), color: echo ? 0xffe4c7 : 0xd7e0e7, fog: false }));
    view.name = 'recessed dusk view';
    view.rotation.y = Math.PI / 2;
    view.position.set(-3.39, 1.79, -2.55);
    this.root.add(view);
    for (const z of [-3.43, -1.67]) this.box(this.root, [0.17, 1.76, 0.055], [-3.235, 1.79, z], trim, 'window jamb');
    for (const y of [0.94, 2.64]) this.box(this.root, [0.17, 0.06, 1.82], [-3.235, y, -2.55], trim, 'window trim');
    this.box(this.root, [0.11, 1.59, 0.04], [-3.265, 1.79, -2.55], trim, 'window centre mullion');
    this.box(this.root, [0.11, 0.035, 1.7], [-3.265, 1.88, -2.55], trim, 'window crossbar');
    this.box(this.root, [0.3, 0.045, 1.91], [-3.13, 0.955, -2.55], trim, 'rounded window sill', 0.009);

    const linen = new THREE.MeshStandardMaterial({ color: echo ? 0xc4b5a0 : 0xacaea7, roughness: 1, side: THREE.DoubleSide });
    for (const z of [-3.61, -1.49]) {
      const geo = new THREE.PlaneGeometry(0.44, 2.45, 22, 10);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        p.setZ(i, Math.sin((x / 0.44) * Math.PI * 8) * 0.032);
        p.setY(i, p.getY(i) + Math.cos((x / 0.44) * Math.PI * 8) * 0.01);
      }
      geo.computeVertexNormals();
      const curtain = new THREE.Mesh(geo, linen);
      curtain.name = 'folded linen curtain';
      curtain.rotation.y = Math.PI / 2;
      curtain.position.set(-3.03, 1.39, z);
      curtain.castShadow = true;
      curtain.receiveShadow = true;
      this.root.add(curtain);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.78, 12), metal);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(-3.015, 2.68, -2.55);
    this.root.add(rod);
  }

  private buildFurnishings(wood: THREE.Material, trim: THREE.Material, metal: THREE.Material, echo: boolean) {
    // Furniture is outside the walker's circular boundary, leaving generous
    // open floor for looking, jumping and opening the tear.
    const desk = new THREE.Group();
    desk.name = 'writing desk';
    desk.position.set(-1.65, 0, -4.25);
    this.box(desk, [1.5, 0.07, 0.64], [0, 0.755, 0], wood, 'desk top', 0.025);
    for (const x of [-0.66, 0.66]) for (const z of [-0.24, 0.24]) {
      this.box(desk, [0.055, 0.72, 0.055], [x, 0.36, z], wood, 'desk leg', 0.007);
    }
    this.root.add(desk);
    this.contact(-1.65, -4.25, 1.9, 1.05, 0.3);
    const ceramic = new THREE.MeshStandardMaterial({ color: 0xc6c1b4, roughness: 0.34 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.09, 28, 1, true), ceramic);
    cup.position.set(-2.14, 0.84, -4.21);
    this.root.add(cup);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.041, 24), new THREE.MeshStandardMaterial({ color: 0x302a21, roughness: 0.32 }));
    coffee.rotation.x = -Math.PI / 2;
    coffee.position.set(-2.14, 0.877, -4.21);
    this.root.add(coffee);
    const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, 8, 20), ceramic);
    cupHandle.position.set(-2.085, 0.842, -4.21);
    this.root.add(cupHandle);
    this.box(this.root, [0.22, 0.025, 0.29], [-1.16, 0.805, -4.3], new THREE.MeshStandardMaterial({ color: 0x56605c, roughness: 0.95 }), 'closed notebook', 0.006);

    const sofa = new THREE.Group();
    sofa.name = 'linen loveseat';
    sofa.position.set(1.36, 0, -4.2);
    const fabric = new THREE.MeshStandardMaterial({ color: echo ? 0xb1a58f : 0x8b938e, bumpMap: this.weaveTexture(), bumpScale: 0.004, roughness: 0.98 });
    for (const x of [-0.72, 0.72]) for (const z of [-0.27, 0.27]) this.box(sofa, [0.06, 0.23, 0.06], [x, 0.115, z], wood, 'sofa foot', 0.012);
    this.box(sofa, [1.7, 0.19, 0.78], [0, 0.305, 0], fabric, 'sofa base', 0.055);
    for (const x of [-0.38, 0.38]) this.box(sofa, [0.74, 0.15, 0.67], [x, 0.455, 0.05], fabric, 'seat cushion', 0.055);
    const back = this.box(sofa, [1.68, 0.52, 0.19], [0, 0.65, -0.31], fabric, 'sofa back', 0.075);
    back.rotation.x = -0.1;
    for (const x of [-0.81, 0.81]) this.box(sofa, [0.15, 0.4, 0.79], [x, 0.5, 0], fabric, 'sofa arm', 0.06);
    const pillow = this.box(sofa, [0.36, 0.33, 0.12], [0.45, 0.66, -0.14], new THREE.MeshStandardMaterial({ color: 0xc3b7a1, roughness: 1 }), 'small linen pillow', 0.07);
    pillow.rotation.z = -0.19;
    this.root.add(sofa);
    this.contact(1.36, -4.2, 2.16, 1.22, 0.38);

    const consoleMat = new THREE.MeshStandardMaterial({ color: 0x727970, roughness: 0.7 });
    this.box(this.root, [0.36, 0.76, 1.54], [2.98, 0.46, 0.2], consoleMat, 'side cabinet', 0.016);
    for (const z of [-0.16, 0.57]) {
      this.box(this.root, [0.018, 0.65, 0.7], [2.791, 0.475, z], consoleMat, 'cabinet door', 0.008);
      this.box(this.root, [0.027, 0.10, 0.013], [2.765, 0.53, z - 0.2], metal, 'cabinet pull', 0.006);
    }
    this.box(this.root, [0.43, 0.045, 1.61], [2.97, 0.864, 0.2], wood, 'cabinet top', 0.012);
    this.contact(2.97, 0.2, 0.78, 1.93, 0.3);
    for (let n = 0; n < 3; n++) this.box(this.root, [0.23, 0.033, 0.30 - n * 0.014], [2.97, 0.905 + n * 0.035, 0.54], new THREE.MeshStandardMaterial({ color: [0xb7afa0, 0x6c7772, 0x8c6e57][n], roughness: 0.93 }), 'stacked book', 0.004);

    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.75), new THREE.MeshStandardMaterial({ map: this.rugTexture(), roughness: 1 }));
    rug.name = 'woven centre rug';
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.009, -1.35);
    rug.receiveShadow = true;
    this.root.add(rug);

    // A single quiet landscape print, rather than several empty coloured panels.
    this.box(this.root, [1.28, 0.88, 0.035], [1.3, 1.94, -4.925], wood, 'picture frame', 0.008);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), new THREE.MeshStandardMaterial({ map: this.artTexture(), roughness: 1 }));
    art.name = 'landscape print';
    art.position.set(1.3, 1.94, -4.903);
    this.root.add(art);

    // Door and hardware establish normal human scale when turning around.
    this.box(this.root, [0.95, 2.17, 0.045], [1.73, 1.085, 2.50], trim, 'painted door', 0.012);
    for (const x of [1.21, 2.25]) this.box(this.root, [0.06, 2.25, 0.055], [x, 1.125, 2.48], trim, 'door casing');
    this.box(this.root, [1.1, 0.06, 0.055], [1.73, 2.24, 2.48], trim, 'door lintel');
    this.box(this.root, [0.12, 0.018, 0.025], [2.08, 1.04, 2.443], metal, 'door lever', 0.007);
    this.box(this.root, [0.07, 0.12, 0.018], [0.99, 1.13, 2.535], trim, 'light switch', 0.007);
    this.buildPlant(2.91, -2.65);
    this.buildDeskLamp(metal, echo);
  }

  private buildPlant(x: number, z: number) {
    const plant = new THREE.Group();
    plant.name = 'rubber plant';
    plant.position.set(x, 0, z);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.145, 0.31, 32), new THREE.MeshStandardMaterial({ color: 0xb1a38d, roughness: 0.8 }));
    pot.position.y = 0.155;
    plant.add(pot);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshStandardMaterial({ color: 0x39342b, roughness: 1 }));
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.313;
    plant.add(soil);
    const leafGeo = new THREE.SphereGeometry(1, 18, 10);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4c6140, roughness: 0.59 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x726e4b, roughness: 0.9 });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.399;
      const height = 0.52 + i * 0.074;
      const end = new THREE.Vector3(Math.cos(a) * 0.15, height, Math.sin(a) * 0.15);
      const stem = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.29, 0), new THREE.Vector3(0.025, height - 0.1, 0), end]), 6, 0.006, 5, false), stemMat);
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.copy(end).add(new THREE.Vector3(Math.cos(a) * 0.09, 0.018, Math.sin(a) * 0.09));
      leaf.scale.set(0.17, 0.016, 0.067);
      leaf.rotation.set(0.1, -a, 0.32);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      plant.add(stem, leaf);
    }
    this.root.add(plant);
    this.contact(x, z, 0.74, 0.74, 0.33);
  }

  private buildDeskLamp(metal: THREE.Material, echo: boolean) {
    const x = -2.22, z = -4.43;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.115, 0.025, 24), metal);
    base.position.set(x, 0.805, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.38, 12), metal);
    stem.position.set(x, 1.005, z);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.19, 0.20, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0xc7bda8, roughness: 0.95, side: THREE.DoubleSide, emissive: 0xffd49b, emissiveIntensity: 0.09 }));
    shade.position.set(x, 1.25, z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.033, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffdeb1, toneMapped: false }));
    bulb.position.set(x, 1.18, z);
    const light = new THREE.PointLight(0xffd6a1, echo ? 2.5 : 5, 5, 2);
    light.position.set(x, 1.17, z);
    this.root.add(base, stem, shade, bulb, light);
  }

  private buildLighting(echo: boolean) {
    this.root.add(new THREE.HemisphereLight(echo ? 0xffecd7 : 0xd9e6ed, 0x77715f, echo ? 1.3 : 1.05));
    const daylight = new THREE.DirectionalLight(echo ? 0xffdfb6 : 0xd3e1ef, echo ? 2.0 : 1.65);
    daylight.position.set(-5, 3.0, -3.5);
    daylight.target.position.set(1, 0, -1.6);
    daylight.castShadow = true;
    daylight.shadow.mapSize.set(1024, 1024);
    daylight.shadow.camera.left = -5;
    daylight.shadow.camera.right = 5;
    daylight.shadow.camera.top = 4;
    daylight.shadow.camera.bottom = -4;
    daylight.shadow.camera.near = 0.1;
    daylight.shadow.camera.far = 14;
    daylight.shadow.bias = -0.0004;
    daylight.shadow.normalBias = 0.018;
    daylight.shadow.radius = 3;
    this.root.add(daylight, daylight.target);
    // Low-energy bounced light keeps opposite surfaces readable without a
    // costly real-time GI pass; contact decals remain visible when XR shadows stop.
    const bounce = new THREE.PointLight(echo ? 0xffe3bd : 0xe9e3d4, 8, 9, 2);
    bounce.position.set(-0.9, 2.4, -2.25);
    this.root.add(bounce);
  }

  private contact(x: number, z: number, width: number, depth: number, opacity: number) {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ color: 0x29251d, map: this.contactMap, transparent: true, opacity, depthWrite: false }));
    shadow.name = 'soft furniture contact';
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(x, 0.004, z);
    this.root.add(shadow);
  }

  private canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  private softTexture() {
    return this.canvasTexture(128, (ctx, size) => {
      const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.06, size / 2, size / 2, size * 0.49);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    });
  }

  private plasterTexture() {
    const random = mulberry32(819);
    const texture = this.canvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#eceae5'; ctx.fillRect(0, 0, size, size);
      for (let n = 0; n < 3600; n++) {
        ctx.fillStyle = `rgba(109,105,96,${0.025 + random() * 0.04})`;
        ctx.fillRect(random() * size, random() * size, 1, 1);
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 4);
    return texture;
  }

  private oakTexture(plankJoints = true) {
    const random = mulberry32(601);
    const texture = this.canvasTexture(1024, (ctx, size) => {
      ctx.fillStyle = '#a48c6b'; ctx.fillRect(0, 0, size, size);
      for (let row = 0; row < 8; row++) {
        const y = row * 128;
        ctx.fillStyle = `hsl(${32 + random() * 4}, ${22 + random() * 4}%, ${53 + random() * 8}%)`;
        if (plankJoints) ctx.fillRect(0, y + 1, size, 126);
        for (let n = 0; n < 160; n++) {
          const gy = y + random() * 126;
          ctx.strokeStyle = `rgba(${random() > 0.5 ? '72,54,32' : '228,211,177'},${0.025 + random() * 0.07})`;
          ctx.lineWidth = 0.4 + random();
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.bezierCurveTo(size * 0.3, gy - 2, size * 0.7, gy + 2, size, gy); ctx.stroke();
        }
        const join = ((row % 3) * 317 + 190) % 1024;
        ctx.fillStyle = 'rgba(71,57,40,0.23)';
        if (plankJoints) {
          ctx.fillRect(join, y, 2, 128);
          ctx.fillRect(0, y, size, 2);
        }
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  private weaveTexture() {
    const texture = this.canvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#b4b1a9'; ctx.fillRect(0, 0, size, size);
      for (let p = 0; p < size; p += 4) {
        ctx.fillStyle = 'rgba(240,235,223,0.16)'; ctx.fillRect(p, 0, 1, size);
        ctx.fillStyle = 'rgba(59,54,46,0.10)'; ctx.fillRect(0, p, size, 1);
      }
    });
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 3);
    return texture;
  }

  private rugTexture() {
    const random = mulberry32(507);
    return this.canvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#b1a797'; ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#969082'; ctx.lineWidth = 12; ctx.strokeRect(19, 19, size - 38, size - 38);
      ctx.strokeStyle = '#c0b8a9'; ctx.lineWidth = 3; ctx.strokeRect(34, 34, size - 68, size - 68);
      for (let y = 0; y < size; y += 2) {
        ctx.fillStyle = `rgba(55,48,37,${random() * 0.085})`; ctx.fillRect(0, y, size, 1);
      }
      for (let x = 0; x < size; x += 3) {
        ctx.fillStyle = `rgba(250,245,229,${random() * 0.11})`; ctx.fillRect(x, 0, 1, size);
      }
    });
  }

  private windowTexture(echo: boolean) {
    return this.canvasTexture(512, (ctx, size) => {
      const sky = ctx.createLinearGradient(0, 0, 0, size);
      sky.addColorStop(0, echo ? '#acb7bb' : '#788d9d');
      sky.addColorStop(0.7, echo ? '#eed2aa' : '#bec8c9');
      sky.addColorStop(1, echo ? '#b0afa0' : '#919f9d');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, size, size);
      for (let layer = 0; layer < 3; layer++) {
        ctx.fillStyle = ['#83938e', '#758783', '#687d77'][layer];
        ctx.beginPath(); ctx.moveTo(0, size);
        for (let x = 0; x <= size; x += 8) ctx.lineTo(x, size * (0.79 + layer * 0.07) + Math.sin(x * 0.017 + layer * 2) * 17 + Math.sin(x * 0.041) * 5);
        ctx.lineTo(size, size); ctx.closePath(); ctx.fill();
      }
    });
  }

  private artTexture() {
    return this.canvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#e5ded0'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#b3b5a6'; ctx.fillRect(38, 48, 436, 416);
      ctx.fillStyle = '#d6cbb4'; ctx.beginPath(); ctx.arc(358, 157, 39, 0, Math.PI * 2); ctx.fill();
      for (let n = 0; n < 3; n++) {
        ctx.fillStyle = ['#8e9b91', '#6d8076', '#506a61'][n];
        ctx.beginPath(); ctx.moveTo(38, 464);
        for (let x = 38; x <= 474; x += 4) ctx.lineTo(x, 286 + n * 55 + Math.sin(x * 0.011 + n) * 43);
        ctx.lineTo(474, 464); ctx.closePath(); ctx.fill();
      }
    });
  }

  /**
   * The final reveal: the same room, but the other world has left marks in it —
   * the creature itself is sitting on the table, moss has crept across the floor
   * under where the tear hung, and pollen still drifts in the air.
   */
  private buildEchoTraces() {
    new GLTFLoader().load(
      '/models/minion-c01.glb', // the same (yellow) creature from the forest
      (gltf) => {
        const blob = gltf.scene;
        fitProp(blob, 0.4);
        standOnOrigin(blob);
        blob.position.add(this.revealSpot); // sitting ON the table, not in it
        // Same golden-orange as in the forest, so you recognise it.
        blob.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiply(new THREE.Color(0xffa040));
          mesh.material = mat;
        });
        blob.rotation.y = 2.4;
        this.root.add(blob);
        this.refreshStencil();
      },
      undefined,
      (err) => console.warn('Reveal creature could not load', err)
    );

    const moss = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 24),
      new THREE.MeshStandardMaterial({ color: 0x4e6b32, roughness: 1, transparent: true, opacity: 0.9 })
    );
    moss.rotation.x = -Math.PI / 2;
    moss.position.set(0, 0.012, -1.1);
    moss.scale.set(1, 1, 0.7);
    this.root.add(moss);

    const bladeGeo = new THREE.BufferGeometry();
    bladeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.02, 0, 0, 0.02, 0, 0, 0, 1, 0]), 3));
    bladeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    const grass = new THREE.InstancedMesh(
      bladeGeo,
      new THREE.MeshStandardMaterial({ color: 0x6d8f3c, roughness: 1, side: THREE.DoubleSide }),
      160
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < 160; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = Math.pow(this.rng(), 0.6) * 0.72;
      p.set(Math.cos(a) * r, 0.01, -1.1 + Math.sin(a) * r * 0.7);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.rng() * Math.PI);
      grass.setMatrixAt(i, m.compose(p, q, s.set(1, 0.06 + this.rng() * 0.14, 1)));
    }
    this.root.add(grass);

    const count = 90;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (this.rng() - 0.5) * 3;
      pos[i * 3 + 1] = 0.3 + this.rng() * 2;
      pos[i * 3 + 2] = -1.1 + (this.rng() - 0.5) * 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.root.add(new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffe2a0, size: 0.022, map: dotTexture(), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending
    })));
  }

  refreshStencil() {
    applyStencilLayer(this.scene, this.stencilLayer);
  }

  /** The room has a flat floor. */
  groundAt(_x: number, _z: number) {
    return 0;
  }

  /** Keep the familiar room around the return seam, even far from the origin. */
  alignTo(anchor: THREE.Object3D) {
    const point = anchor.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion()));
    forward.y = 0;
    if (forward.lengthSq() < 1e-5) forward.set(0, 0, -1);
    forward.normalize();
    this.root.rotation.set(0, Math.atan2(-forward.x, -forward.z), 0);
    // The seam is 80cm into the room. The returning viewer remains within the
    // furniture-free walking disk for both desktop and comfortable XR reach.
    this.root.position.set(point.x - forward.x * 0.8, 0, point.z - forward.z * 0.8);
    this.root.updateMatrixWorld(true);
  }

  get walkBounds() {
    this.root.updateWorldMatrix(true, false);
    return { center: this.root.localToWorld(new THREE.Vector3(0, 0, -1.2)), radius: 2.5 };
  }

  update(time: number, _lean = 0) {
    this.dust.rotation.y = Math.sin(time * 0.02) * 0.05;
    this.dust.position.y = Math.sin(time * 0.15) * 0.02;
  }
}
