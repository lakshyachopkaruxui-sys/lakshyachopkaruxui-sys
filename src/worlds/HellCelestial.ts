import * as THREE from 'three';
import { assetUrl } from '../utils/assetUrl';

export const HELL_CELESTIAL_MAPS = [
  '/textures/hell/celestial/lroc_color_2k.jpg',
  '/textures/hell/celestial/ldem_3_8bit.jpg'
] as const;

/** The same owning-world direction as the basin's broad warm key light. */
export const HELL_CELESTIAL_SUN = new THREE.Vector3(-14, 24, 15).normalize();

/** Two opaque, cratered bodies. Shared maps, no atmosphere shells or light passes. */
export class HellCelestial {
  readonly root = new THREE.Group();
  readonly ready: Promise<boolean>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';
  private readonly sunWorld = { value: HELL_CELESTIAL_SUN.clone() };
  private readonly loaded = { value: 0 };
  private readonly bodies: THREE.Mesh[] = [];

  constructor(parent: THREE.Group) {
    this.root.name = 'Cratered bodies in the volcanic ash sky';
    parent.add(this.root);
    const pending: Promise<boolean>[] = [];
    const load = (url: string, color: boolean) => {
      let settle!: (ok: boolean) => void;
      pending.push(new Promise(resolve => { settle = resolve; }));
      const texture = new THREE.TextureLoader().load(assetUrl(url), () => settle(true), undefined, () => settle(false));
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 2;
      return texture;
    };
    const albedo = load(HELL_CELESTIAL_MAPS[0], true);
    const relief = load(HELL_CELESTIAL_MAPS[1], false);
    const material = new THREE.ShaderMaterial({
      name: 'Lunar relief in shared volcanic light', fog: false,
      uniforms: { albedo: { value: albedo }, relief: { value: relief }, mapsReady: this.loaded, sunWorld: this.sunWorld },
      vertexShader: `
        varying vec2 surfaceUv;
        varying vec3 worldPosition;
        varying vec3 worldNormal;
        void main() {
          surfaceUv=uv;
          vec4 p=modelMatrix*vec4(position,1.);
          worldPosition=p.xyz;
          // These bodies and their owning world use only uniform scale.
          worldNormal=normalize(mat3(modelMatrix)*normal);
          gl_Position=projectionMatrix*viewMatrix*p;
        }`,
      fragmentShader: `
        uniform sampler2D albedo,relief;
        uniform float mapsReady;
        uniform vec3 sunWorld;
        varying vec2 surfaceUv;
        varying vec3 worldPosition;
        varying vec3 worldNormal;
        vec3 reliefNormal(vec3 n) {
          // Screen-space gradients preserve smooth silhouettes and avoid a dense displaced mesh.
          vec2 du=dFdx(surfaceUv),dv=dFdy(surfaceUv);
          float h=texture2D(relief,surfaceUv).r;
          vec2 dh=vec2(texture2D(relief,surfaceUv+du).r-h,
                       texture2D(relief,surfaceUv+dv).r-h)*.16*mapsReady;
          vec3 sx=dFdx(worldPosition),sy=dFdy(worldPosition);
          vec3 r1=cross(sy,n),r2=cross(n,sx);
          float determinant=dot(sx,r1);
          vec3 gradient=sign(determinant)*(dh.x*r1+dh.y*r2);
          return normalize(max(abs(determinant),.000001)*n-gradient);
        }
        void main() {
          vec3 sphereNormal=normalize(worldNormal);
          vec3 n=reliefNormal(sphereNormal);
          vec3 viewDirection=normalize(cameraPosition-worldPosition);
          vec3 lightDirection=normalize(sunWorld);
          vec3 source=mix(vec3(.35),texture2D(albedo,surfaceUv).rgb,mapsReady);
          float density=dot(source,vec3(.2126,.7152,.0722));
          // Red dust is a fantasy treatment of lunar source data, not a second rock texture.
          vec3 mineral=mix(vec3(.18,.125,.105),vec3(.60,.43,.31),smoothstep(.07,.75,density));
          mineral*=mix(.66,1.24,density);
          float diffuse=max(dot(n,lightDirection),0.);
          float phase=smoothstep(-.055,.085,dot(sphereNormal,lightDirection));
          float limb=pow(1.-max(dot(sphereNormal,viewDirection),0.),3.);
          vec3 night=vec3(.014,.0045,.006)+mineral*.018;
          vec3 day=mineral*(.055+diffuse*1.25)*vec3(1.,.72,.53);
          vec3 color=mix(night,day,phase);
          // Ash-colored limb fill removes the hard black cutout without an alpha shell.
          color+=vec3(.038,.008,.006)*limb*(.35+.65*phase);
          float distanceToViewer=length(cameraPosition-worldPosition);
          float haze=clamp(.045+distanceToViewer*.00035+limb*.025,.05,.15);
          color=mix(color,vec3(.10,.009,.009),haze);
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(13, 80, 48), material);
    planet.name = 'Near eclipsed iron planet';
    planet.position.set(-38, 41, -82);
    planet.rotation.set(.08, -.65, -.16);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4.8, 48, 32), material);
    moon.name = 'Second scorched moon';
    moon.position.set(49, 29, -76);
    moon.rotation.set(-.12, 1.8, .22);
    this.root.add(planet, moon);
    this.bodies.push(planet, moon);
    const updateLight = () => {
      this.sunWorld.value.copy(HELL_CELESTIAL_SUN).transformDirection(parent.matrixWorld);
    };
    for (const body of this.bodies) body.onBeforeRender = updateLight;
    this.root.userData.budget = {
      draws: 2, triangles: 80 * 2 * 47 + 48 * 2 * 31,
      maps: ['2048x1024 sRGB albedo', '1024x512 linear relief'],
      rgba8MipmappedBytes: (2048 * 1024 + 1024 * 512) * 4 * 4 / 3,
      addedLights: 0, addedShadowPasses: 0, transparentShells: 0
    };
    this.ready = Promise.all(pending).then(results => {
      const ok = results.every(Boolean);
      this.loaded.value = ok ? 1 : 0;
      this.status = ok ? 'ready' : 'fallback';
      return ok;
    });
  }
}
