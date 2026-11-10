import * as THREE from 'three';
import { assetUrl } from '../utils/assetUrl';
import { mulberry32 } from '../utils/math';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { WorldCollisions } from './WorldCollisions';
import { buildHellVolcanoGeometry } from './HellVolcanoGeometry';
import { createHellSky } from './HellSky';
import { HellScenery } from './HellScenery';
import { SHADOW_PATROL_ROUTES } from './ShadowFauna';
import { HellAtmosphere } from './HellAtmosphere';
import { createHellLavaMaterial, type HellLavaTextures } from './HellLavaMaterial';
import { createHellMountainMaterial } from './HellMountainMaterial';
import { buildHellRiverGeometry } from './HellRiverGeometry';
import { HellCelestial } from './HellCelestial';

/** Rivers deliberately flank the arrival and authored creature patrols. */
export const HELL_RIVERS = [
  { points: [[19,-40],[15,-30],[14,-21],[12,-12],[16,-4],[12,5],[17,19]], width: 2.5 },
  { points: [[-28,-35],[-20,-26],[-17,-17],[-14,-9],[-16,0],[-12,11],[-18,25]], width: 1.9 },
  { points: [[-20,-26],[-10,-29],[0,-27],[8,-30],[15,-30]], width: 2.3 },
  { points: [[4,-22.6],[8,-22.6],[11,-22.5],[14,-21]], width: 1.2 }
];

export function riverDistance(x: number, z: number) {
  let nearest = Infinity;
  for (const river of HELL_RIVERS) for (let i = 1; i < river.points.length; i++) {
    const [ax,az] = river.points[i-1], [bx,bz] = river.points[i];
    const dx = bx-ax, dz = bz-az;
    const t = THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
    nearest = Math.min(nearest, Math.hypot(x-ax-t*dx,z-az-t*dz) / river.width);
  }
  return nearest;
}

/** A shallow, visible incision, sampled by the same triangulated floor as walking. */
export function hellGroundOffset(x: number, z: number) {
  const river = riverDistance(x,z);
  const incision = -.48 * (1-THREE.MathUtils.smoothstep(river,.5,1.3));
  const landing = THREE.MathUtils.smoothstep(Math.hypot(x,z-2),2.5,5.5);
  const shelf = THREE.MathUtils.smoothstep(river,1,1.7);
  // Low folds are part of the same rendered/collidable ground, not floating decals.
  const folds = .08 * Math.sin(x*.77+Math.sin(z*.42)*1.3)
    + .13 * Math.sin(z*.48+x*.18) * Math.sin(x*.31-z*.21);
  return incision + folds * landing * shelf;
}

export class HellLandscape {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  status: 'loading' | 'ready' | 'fallback' = 'loading';
  readonly time = { value: 0 };
  readonly groundMaterial: THREE.MeshStandardMaterial;
  readonly lavaMaterial: THREE.MeshStandardMaterial;
  readonly mountainMaterial: THREE.MeshStandardMaterial;
  readonly scenery: HellScenery;
  readonly atmosphere: HellAtmosphere;
  readonly celestial: HellCelestial;
  private readonly loads: Promise<boolean>[] = [];
  private readonly lavaTextures: HellLavaTextures;
  private readonly eruptionOrigin = new THREE.Vector3(4, 18.5, -46);

  constructor(parent: THREE.Group, private heightAt: (x:number,z:number)=>number,
    layer: ()=>number, collisions: WorldCollisions) {
    this.root.name = 'The Cinder Rift: volcanic horror landscape'; parent.add(this.root);
    const rock = this.texture('Rock030_1K-JPG_Color.jpg',true);
    const normal = this.texture('Rock030_1K-JPG_NormalGL.jpg');
    const rough = this.texture('Rock030_1K-JPG_Roughness.jpg');
    this.groundMaterial = new THREE.MeshStandardMaterial({ color:0x968980, map:rock,
      normalMap:normal, roughnessMap:rough, roughness:1, normalScale:new THREE.Vector2(.95,.95) });
    this.groundMaterial.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 hellLocal;\n'+shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nhellLocal=position;');
      shader.fragmentShader = 'varying vec3 hellLocal;\n'+shader.fragmentShader.replace('#include <map_fragment>',`
        #include <map_fragment>
        float ash=.5+.5*sin(hellLocal.x*.17+sin(hellLocal.z*.13)*2.);
        diffuseColor.rgb*=mix(vec3(.66,.63,.60),vec3(1.,.88,.77),ash*.65);
      `).replace('#include <roughnessmap_fragment>',`
        #include <roughnessmap_fragment>
        roughnessFactor=max(.82,roughnessFactor);
      `);
    };
    this.groundMaterial.customProgramCacheKey=()=> 'hell-folded-basalt-ground-v3';
    this.lavaTextures = { color:this.texture('Lava004_1K-JPG_Color.jpg',true),
      normal:this.texture('Lava004_1K-JPG_NormalGL.jpg'), emission:this.texture('Lava004_1K-JPG_Emission.jpg',true) };
    this.lavaMaterial = createHellLavaMaterial(this.time,this.lavaTextures,'channel');
    this.mountainMaterial = createHellMountainMaterial({map:rock,normalMap:normal,roughnessMap:rough});
    this.buildRivers(collisions);
    this.buildRiverCrust();
    this.buildRocks(collisions);
    this.buildFissures();
    this.buildVolcanoes();
    this.buildSky();
    this.celestial = new HellCelestial(this.root);
    this.loads.push(this.celestial.ready);
    this.buildEruption();
    this.scenery=new HellScenery(this.root,heightAt,layer,collisions,this.groundMaterial,HELL_RIVERS);
    this.atmosphere=new HellAtmosphere(this.root,heightAt,layer);
    this.loads.push(this.scenery.ready.then(()=>this.scenery.status==='ready'));
    this.ready=Promise.all(this.loads).then(results=>{
      this.status=results.every(Boolean)?'ready':'fallback'; applyStencilLayer(this.root,layer());
    });
    applyStencilLayer(this.root,layer());
  }

  private texture(file:string,color=false) {
    let settle!:(ok:boolean)=>void;
    this.loads.push(new Promise(resolve=>settle=resolve));
    const texture=new THREE.TextureLoader().load(assetUrl('/textures/hell/'+file),()=>settle(true),undefined,()=>settle(false));
    texture.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.anisotropy=4;
    return texture;
  }

  private buildRivers(collisions:WorldCollisions) {
    const geometry=buildHellRiverGeometry(HELL_RIVERS,this.heightAt);
    for(const [r,river] of HELL_RIVERS.entries()) {
      for(let segment=1;segment<river.points.length;segment++) {
        const [ax,az]=river.points[segment-1], [bx,bz]=river.points[segment];
        collisions.addCapsule({id:`hell-lava-${r}-${segment}`,ax,az,bx,bz,radius:river.width*.78,
          minY:-2,maxY:.65,headOcclusion:false});
      }
    }
    const mesh=new THREE.Mesh(geometry,this.lavaMaterial);mesh.name='Branching molten rivers with moving black crust';this.root.add(mesh);
  }

  private buildRocks(collisions:WorldCollisions) {
    const random=mulberry32(819003), geometry=new THREE.IcosahedronGeometry(1,1);
    const p=geometry.attributes.position;
    for(let i=0;i<p.count;i++) { const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const f=1+.17*Math.sin(x*11+y*7+z*4)+.09*Math.sin(y*16-z*9);
      p.setXYZ(i,x*f,y*f,z*f); }
    geometry.computeVertexNormals();
    // Spherical UVs give the coarse boulders real rock detail without a model download.
    const uv=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){uv[i*2]=Math.atan2(p.getZ(i),p.getX(i))/Math.PI/2+.5;uv[i*2+1]=p.getY(i)*.5+.5;}
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    const material=this.groundMaterial.clone();material.onBeforeCompile=()=>{};
    material.color.set(0x55453f);material.customProgramCacheKey=()=> 'hell-rock-v1';
    const mesh=new THREE.InstancedMesh(geometry,material,180), transform=new THREE.Object3D();
    mesh.name='Instanced scoria and broken basalt';let count=0;
    for(let attempt=0;count<180&&attempt<2000;attempt++) {
      const a=random()*Math.PI*2,d=3+random()*45,x=Math.cos(a)*d,z=Math.sin(a)*d-5;
      const size=.28+random()**2*1.5;
      if(riverDistance(x,z)<1.25 || Math.hypot(x,z-2)<3.5+size)continue;
      // Reserve the real patrols instead of clearing a conspicuous 18m-wide
      // rectangle through the basin. Scoria can now interrupt the empty floor.
      if(SHADOW_PATROL_ROUTES.some(route=>route.some((p,i)=>{
        const next=route[(i+1)%route.length],dx=next[0]-p[0],dz=next[1]-p[1];
        const t=THREE.MathUtils.clamp(((x-p[0])*dx+(z-p[1])*dz)/(dx*dx+dz*dz),0,1);
        return Math.hypot(x-p[0]-t*dx,z-p[1]-t*dz)<1.4+size;
      })))continue;
      transform.position.set(x,this.heightAt(x,z)+size*.24,z);transform.rotation.set(random()*.3,random()*6.28,random()*.3);
      transform.scale.set(size*(.8+random()),size*(.4+random()*.65),size);transform.updateMatrix();mesh.setMatrixAt(count,transform.matrix);
      mesh.setColorAt(count,new THREE.Color().setScalar(.55+random()*.45));
      if(d<19&&size>.6)collisions.addCircle({id:'hell-rock-'+count,x,z,radius:size*.85,minY:this.heightAt(x,z)-.1,maxY:this.heightAt(x,z)+size*1.5});
      count++;
    }
    mesh.count=count;mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);
  }

  private buildRiverCrust() {
    const random=mulberry32(19237),geometry=new THREE.IcosahedronGeometry(1,1);
    const vertices=geometry.getAttribute('position');
    for(let i=0;i<vertices.count;i++){
      const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i);
      const fracture=1+.26*Math.sin(x*7+z*9)+.17*Math.sin(z*13-y*4);
      vertices.setXYZ(i,x*fracture,y*.09*fracture,z*fracture);
    }
    geometry.computeVertexNormals();
    const material=this.groundMaterial.clone();material.color.set(0x292524);
    material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`
      #include <roughnessmap_fragment>
      roughnessFactor=max(.9,roughnessFactor);
    `);};material.customProgramCacheKey=()=> 'hell-cooled-lava-crust-v1';
    const placements:{x:number;y:number;z:number;size:number;yaw:number}[]=[];
    for(const river of HELL_RIVERS)for(let segment=1;segment<river.points.length;segment++){
      const [ax,az]=river.points[segment-1],[bx,bz]=river.points[segment],length=Math.hypot(bx-ax,bz-az);
      const nx=-(bz-az)/length,nz=(bx-ax)/length;
      for(let i=0;i<3;i++)for(const side of [-1,1]){
        const t=(i+.25+random()*.5)/3,cx=THREE.MathUtils.lerp(ax,bx,t),cz=THREE.MathUtils.lerp(az,bz,t);
        const offset=river.width*(.40+random()*.15)*side;
        placements.push({x:cx+nx*offset,y:this.heightAt(cx,cz)+.17,z:cz+nz*offset,size:.13+random()*.23,yaw:random()*6.28});
      }
    }
    const mesh=new THREE.InstancedMesh(geometry,material,placements.length),transform=new THREE.Object3D();
    placements.forEach((p,i)=>{transform.position.set(p.x,p.y,p.z);transform.scale.set(p.size,1,p.size*(.7+random()*.6));
      transform.rotation.y=p.yaw;transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);});
    mesh.name='Lodged cooled crust along molten banks';mesh.receiveShadow=true;mesh.computeBoundingSphere();this.root.add(mesh);
  }

  private buildVolcanoes() {
    const craterMaterial=createHellLavaMaterial(this.time,this.lavaTextures,'crater');
    const slopeMaterial=createHellLavaMaterial(this.time,this.lavaTextures,'slope');
    for(const [index,[cx,cz,radius,height]] of [[4,-46,23,19],[-43,-36,25,10],[44,-26,18,16],[-31,32,24,8],[38,30,27,11]].entries()) {
      const geometry=buildHellVolcanoGeometry(cx,cz,radius,height,index,index===0,this.heightAt);
      if(index===0){
        this.eruptionOrigin.copy(geometry.poolCenter).add(new THREE.Vector3(0,.35,0));
      }
      const mesh=new THREE.Mesh(geometry.cone,this.mountainMaterial);
      mesh.name=index===0?'Erupting Cinder Rift caldera':'Distant volcanic escarpment '+index;this.root.add(mesh);
      const crater=new THREE.Mesh(geometry.crater,craterMaterial);crater.name='Molten crater '+index;this.root.add(crater);
      if(geometry.spill){const flow=new THREE.Mesh(geometry.spill,slopeMaterial);flow.name='Caldera overflow';this.root.add(flow);}
    }
  }

  private buildSky() {
    const sky=createHellSky(this.time);
    this.root.add(sky.mesh);this.loads.push(sky.ready);
    const rng=mulberry32(991),p:number[]=[];
    for(let i=0;i<230;i++){const a=rng()*Math.PI*2,y=.22+rng()*.75,r=Math.sqrt(1-y*y);p.push(Math.cos(a)*r*119,y*119,Math.sin(a)*r*119);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    const stars=new THREE.Points(g,new THREE.PointsMaterial({color:0x8e5f59,size:.10,sizeAttenuation:true,fog:false,depthWrite:false}));
    // Stars do not write depth, so they must follow the opaque sky. World
    // depth still hides them behind the planets, mountains and nearby actors.
    stars.renderOrder=1001;stars.name='Sparse distant stars';this.root.add(stars);
  }

  private noiseTexture() {
    const random=mulberry32(7193),size=128,data=new Uint8Array(size*size*4);
    const octaves=[4,8,16,32].map(resolution=>({resolution,grid:Float32Array.from({length:resolution*resolution},()=>random())}));
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      let value=0;
      octaves.forEach(({resolution,grid},octave)=>{
        const px=x/size*resolution,py=y/size*resolution,ix=Math.floor(px),iy=Math.floor(py);
        const sx=px-ix,sy=py-iy,fx=sx*sx*(3-2*sx),fy=sy*sy*(3-2*sy);
        const a=grid[iy*resolution+ix],b=grid[iy*resolution+(ix+1)%resolution];
        const c=grid[((iy+1)%resolution)*resolution+ix],d=grid[((iy+1)%resolution)*resolution+(ix+1)%resolution];
        value+=(THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,b,fx),THREE.MathUtils.lerp(c,d,fx),fy))*[.55,.27,.13,.05][octave];
      });
      const v=Math.round(value*255);data.set([v,v,v,255],(y*size+x)*4);
    }
    const texture=new THREE.DataTexture(data,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
  }

  private buildEruption() {
    const random=mulberry32(561),count=280,p=new Float32Array(count*3),seeds=new Float32Array(count*3);
    for(let i=0;i<count;i++)seeds.set([random(),random(),random()],i*3);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(p,3));geometry.setAttribute('seed',new THREE.BufferAttribute(seeds,3));
    const material=new THREE.ShaderMaterial({uniforms:{hellTime:this.time,eruptionOrigin:{value:this.eruptionOrigin}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`uniform float hellTime;uniform vec3 eruptionOrigin;attribute vec3 seed;varying float heat;
        void main(){float life=fract(hellTime*(.13+seed.z*.04)+seed.x);float a=seed.y*6.2831853;
        vec3 p=eruptionOrigin+vec3(cos(a)*life*12.,sin(life*3.1415927)*(12.+seed.z*8.)-life*4.,sin(a)*life*9.);
        heat=1.-life;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(75./-mv.z,1.,5.);}`,
      fragmentShader:`varying float heat;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;
        gl_FragColor=vec4(mix(vec3(1.,.07,.005),vec3(1.,.65,.12),heat),smoothstep(.5,.1,d)*heat);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`
    });
    const sparks=new THREE.Points(geometry,material);sparks.name='GPU volcanic fountain';sparks.frustumCulled=false;this.root.add(sparks);
    // Twelve bounded billboards, one draw call. Each eye uses its own view matrix.
    const smokeMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,
      uniforms:{hellTime:this.time,noiseMap:{value:this.noiseTexture()}},
      vertexShader:`uniform float hellTime;varying vec2 smokeUv;varying float age;
        void main(){smokeUv=uv;vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
        age=instanceMatrix[3].y/50.;float size=length(instanceMatrix[0].xyz);
        center.xy+=position.xy*size;gl_Position=projectionMatrix*center;}`,
      fragmentShader:`uniform sampler2D noiseMap;uniform float hellTime;varying vec2 smokeUv;varying float age;
        void main(){vec2 p=smokeUv-.5;float n=texture2D(noiseMap,smokeUv*.23+vec2(age,hellTime*.002)).r;
        float cloud=1.-smoothstep(.18,.49,length(p)+.09*(n-.5));float alpha=cloud*.32;
        if(alpha<.01)discard;vec3 color=mix(vec3(.12,.026,.014),vec3(.025,.018,.025),clamp(age,0.,1.));
        gl_FragColor=vec4(color,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`
    });
    const smoke=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),smokeMaterial,12),transform=new THREE.Object3D();
    for(let i=0;i<12;i++){transform.position.set(this.eruptionOrigin.x+i*.7,this.eruptionOrigin.y+2.2+i*2.1,this.eruptionOrigin.z-1-i*.2);transform.scale.setScalar(5+i*.75);transform.updateMatrix();smoke.setMatrixAt(i,transform.matrix);}
    smoke.name='Wind-bent volcanic ash column';smoke.frustumCulled=false;this.root.add(smoke);
  }

  private buildFissures() {
    const p:number[]=[],uv:number[]=[],indices:number[]=[],random=mulberry32(8171);
    for(let branch=0;branch<26;branch++){
      let x=(random()-.5)*26,z=(random()-.5)*32-4,angle=random()*6.28;
      for(let step=0;step<7;step++){
        const nx=x+Math.cos(angle)*.5,nz=z+Math.sin(angle)*.5;
        if(riverDistance(x,z)>1.4){
          const width=.009+random()*.012,dx=-Math.sin(angle)*width,dz=Math.cos(angle)*width,first=p.length/3;
          for(const [px,pz,u,v] of [[x-dx,z-dz,0,step],[x+dx,z+dz,1,step],[nx-dx,nz-dz,0,step+1],[nx+dx,nz+dz,1,step+1]]) {
            p.push(px,this.heightAt(px,pz)+.009,pz);uv.push(u,v);
          }
          indices.push(first,first+1,first+2,first+1,first+3,first+2);
        }
        x=nx;z=nz;angle+=(random()-.5)*1.1;
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    const material=createHellLavaMaterial(this.time,this.lavaTextures,'fissure');material.emissiveIntensity=.85;
    const mesh=new THREE.Mesh(geometry,material);mesh.name='Hairline heat fractures in cooled walking shelf';this.root.add(mesh);
  }

  update(time:number) { this.time.value=time; this.atmosphere.update(time); }
}
