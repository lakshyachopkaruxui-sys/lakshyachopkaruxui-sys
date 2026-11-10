import * as THREE from 'three';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { mulberry32 } from '../utils/math';

/** Fixed world-local anchors shared by the visual and spatial sound layers. */
export const HELL_VENTS = Object.freeze([
  Object.freeze([-4, -3] as const),
  Object.freeze([7, -13] as const),
  Object.freeze([-10, -20] as const)
]);

const WISPS_PER_VENT = 8, ASH_COUNT = 140;

/** Local ground breath and falling ash give the basin depth without a screen effect. */
export class HellAtmosphere {
  readonly root = new THREE.Group();
  readonly ready: Promise<void> = Promise.resolve();
  readonly status = 'ready' as const;
  private readonly time = { value: 0 };
  private readonly noise = createNoise();
  private disposed = false;

  constructor(parent: THREE.Group, heightAt: (x: number, z: number) => number, layer: () => number) {
    this.root.name = 'Smouldering vents and slow volcanic ash';
    this.buildVentCracks(heightAt);
    this.buildGroundBreath(heightAt);
    this.buildAsh();
    this.root.userData.budget = { draws: 3, triangles: 192, ashParticles: ASH_COUNT,
      noiseTextureBytes: 64 * 64 * 4, addedLights: 0, addedShadowPasses: 0 };
    parent.add(this.root);
    applyStencilLayer(this.root, layer());
  }

  private uniforms(extra: Record<string, THREE.IUniform> = {}) {
    return { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), hellTime: this.time, ...extra };
  }

  private buildGroundBreath(heightAt: (x: number, z: number) => number) {
    const count = HELL_VENTS.length * WISPS_PER_VENT, random = mulberry32(519307);
    const geometry = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(count * 3);
    const material = new THREE.ShaderMaterial({
      name: 'Thin mineral smoke, stereo view-facing', transparent: true, depthWrite: false, fog: true,
      uniforms: this.uniforms({ noiseMap: { value: this.noise } }),
      vertexShader: `
        uniform float hellTime;
        attribute vec3 ventSeed;
        varying vec2 smokeUv;
        varying float lifeFade;
        varying float noiseOffset;
        #include <fog_pars_vertex>
        void main() {
          float life=fract(hellTime*(.031+ventSeed.z*.009)+ventSeed.x);
          vec3 drift=vec3(life*(.32+ventSeed.y*.28),.08+life*1.9,
            sin(hellTime*.07+ventSeed.y*6.2831853)*.16+life*.12);
          vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(drift,1.);
          float nearFade=smoothstep(.65,2.0,length(mvPosition.xyz));
          float width=.48+life*1.15;
          float height=.26+life*.87;
          mvPosition.xy+=position.xy*vec2(width,height);
          smokeUv=uv;
          lifeFade=pow(max(sin(life*3.14159265),0.),1.2)*nearFade;
          noiseOffset=ventSeed.y;
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D noiseMap;
        uniform float hellTime;
        varying vec2 smokeUv;
        varying float lifeFade;
        varying float noiseOffset;
        #include <fog_pars_fragment>
        void main() {
          vec2 p=(smokeUv-.5)*2.;
          float n=texture2D(noiseMap,smokeUv*vec2(.58,.74)+vec2(noiseOffset,-hellTime*.008)).r;
          float fine=texture2D(noiseMap,smokeUv*1.8+vec2(noiseOffset*.37,hellTime*.003)).r;
          float edge=1.-smoothstep(.13,1.,dot(p*vec2(.92,1.1),p*vec2(.92,1.1)));
          float wisps=smoothstep(.28,.68,n+fine*.17);
          float alpha=edge*wisps*lifeFade*.22;
          if(alpha<.006)discard;
          vec3 mineral=mix(vec3(.11,.085,.073),vec3(.24,.17,.125),n);
          gl_FragColor=vec4(mineral,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count), transform = new THREE.Object3D();
    mesh.name = 'Low drifting vent wisps';
    HELL_VENTS.forEach(([x, z], vent) => {
      for (let i = 0; i < WISPS_PER_VENT; i++) {
        const index = vent * WISPS_PER_VENT + i;
        const px = x + (random() - .5) * .52, pz = z + (random() - .5) * .38;
        transform.position.set(px, heightAt(px, pz) + .025, pz);
        transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix);
        seeds.set([(i + random() * .55) / WISPS_PER_VENT, random(), random()], index * 3);
      }
    });
    geometry.setAttribute('ventSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    // Cover shader-only rise and wind; do not let static plane bounds clip wisps.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(.5, 1, 0), 2.8);
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    this.root.add(mesh);
  }

  private buildAsh() {
    const random = mulberry32(881503), position = new Float32Array(ASH_COUNT * 3);
    const seeds = new Float32Array(ASH_COUNT * 3);
    for (let i = 0; i < ASH_COUNT; i++) {
      position.set([(random() - .5) * 36, .4 + random() * 4.8, -26 + random() * 34], i * 3);
      seeds.set([random(), random(), random()], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('ashSeed', new THREE.BufferAttribute(seeds, 3));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.7, -9), 27);
    const material = new THREE.ShaderMaterial({
      name: 'Sparse dry ash shards', transparent: true, depthWrite: false, fog: true,
      uniforms: this.uniforms(),
      vertexShader: `
        uniform float hellTime;
        attribute vec3 ashSeed;
        varying float opacity;
        varying float shardRotation;
        varying float heat;
        #include <fog_pars_vertex>
        void main(){
          vec3 p=position;
          p.x=mod(position.x+18.+hellTime*(.09+ashSeed.x*.055),36.)-18.;
          p.y=.35+fract((position.y-.35)/4.9-hellTime*(.009+ashSeed.z*.006))*4.9;
          p.z+=sin(hellTime*.11+ashSeed.y*6.2831853)*.45;
          vec4 mvPosition=modelViewMatrix*vec4(p,1.);
          gl_Position=projectionMatrix*mvPosition;
          gl_PointSize=clamp((12.+ashSeed.y*10.)/max(-mvPosition.z,.2),.65,2.5);
          opacity=(.25+ashSeed.z*.3)*smoothstep(.5,1.7,length(mvPosition.xyz));
          shardRotation=hellTime*.16+ashSeed.x*6.2831853;
          heat=step(.94,ashSeed.x);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying float opacity;
        varying float shardRotation;
        varying float heat;
        #include <fog_pars_fragment>
        void main(){
          vec2 p=gl_PointCoord-.5;
          float c=cos(shardRotation),s=sin(shardRotation);
          p=mat2(c,-s,s,c)*p;
          float shape=1.-smoothstep(.19,.49,length(p*vec2(1.65,.75)));
          if(shape<.03)discard;
          vec3 ash=mix(vec3(.33,.25,.20),vec3(.85,.19,.025),heat);
          gl_FragColor=vec4(ash,shape*opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    const ash = new THREE.Points(geometry, material);
    ash.name = 'Slow falling cinder ash';
    this.root.add(ash);
  }

  private buildVentCracks(heightAt: (x: number, z: number) => number) {
    const random = mulberry32(901813), positions: number[] = [], uv: number[] = [], indices: number[] = [];
    for (const [cx, cz] of HELL_VENTS) for (let branch = 0; branch < 3; branch++) {
      let x: number = cx, z: number = cz, angle = branch * 2.1 + random() * .6;
      for (let step = 0; step < 8; step++) {
        const length = .13 + random() * .09, nx = x + Math.cos(angle) * length, nz = z + Math.sin(angle) * length;
        const width = (.045 + random() * .025) * (1 - step / 11);
        const dx = -Math.sin(angle) * width, dz = Math.cos(angle) * width, first = positions.length / 3;
        for (const [px, pz, u, v] of [[x + dx,z + dz,0,step], [x - dx,z - dz,1,step],
          [nx + dx,nz + dz,0,step+1], [nx - dx,nz - dz,1,step+1]]) {
          positions.push(px, heightAt(px, pz) + .012, pz); uv.push(u, v);
        }
        indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3);
        x = nx; z = nz; angle += (random() - .5) * .65;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      name: 'Smouldering mineral fissures', transparent: true, depthWrite: false, fog: true,
      uniforms: this.uniforms(),
      vertexShader: `
        varying vec2 crackUv;
        #include <fog_pars_vertex>
        void main(){crackUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float hellTime;
        varying vec2 crackUv;
        #include <fog_pars_fragment>
        void main(){
          float core=1.-smoothstep(.08,.49,abs(crackUv.x-.5));
          float crust=.72+.28*sin(crackUv.y*7.3+sin(crackUv.y*2.8));
          float breath=.93+.07*sin(hellTime*.32+crackUv.y*.3);
          float fade=1.-smoothstep(5.8,8.,crackUv.y);
          if(core*fade<.015)discard;
          vec3 heat=mix(vec3(.11,.012,.004),vec3(1.05,.15,.012),core*crust)*breath;
          gl_FragColor=vec4(heat,core*fade*.9);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`
    });
    const cracks = new THREE.Mesh(geometry, material);
    cracks.name = 'Three smouldering vent mouths';
    this.root.add(cracks);
  }

  update(time: number) {
    if (!this.disposed && Number.isFinite(time)) this.time.value = Math.max(0, time);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
    this.noise.dispose(); this.root.removeFromParent();
  }
}

/** Small repeatable low-frequency field; no image download or canvas allocation. */
function createNoise() {
  const size = 64, random = mulberry32(710953), data = new Uint8Array(size * size * 4);
  const fields = [4, 8, 16].map(resolution => ({ resolution,
    values: Float32Array.from({ length: resolution * resolution }, () => random()) }));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let value = 0;
    fields.forEach(({ resolution, values }, octave) => {
      const px = x / size * resolution, py = y / size * resolution, ix = Math.floor(px), iy = Math.floor(py);
      const tx = px - ix, ty = py - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = values[iy * resolution + ix], b = values[iy * resolution + (ix + 1) % resolution];
      const c = values[((iy + 1) % resolution) * resolution + ix], d = values[((iy + 1) % resolution) * resolution + (ix + 1) % resolution];
      value += THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, sx), THREE.MathUtils.lerp(c, d, sx), sy) * [.6, .28, .12][octave];
    });
    const shade = Math.round(value * 255); data.set([shade, shade, shade, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
