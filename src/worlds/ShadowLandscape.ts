import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { ShadowOrganic } from './ShadowOrganic';
import { WorldCollisions } from './WorldCollisions';

/** Real scanned boulders and timber in an asymmetric continuous woodland. */
export class ShadowLandscape {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly organic: ShadowOrganic;
  status: 'loading' | 'ready' | 'fallback' = 'loading';
  readonly mistUniforms = { uTime: { value: 0 } };
  constructor(parent:THREE.Group,heightAt:(x:number,z:number)=>number,layer:()=>number,
    collisions=new WorldCollisions(parent)) {
    this.root.name='photographic shadow woodland';parent.add(this.root);
    this.organic=new ShadowOrganic(this.root,heightAt,layer,collisions);
    const rocks=new GLTFLoader().loadAsync(assetUrl('/models/shadow/boulder_01/boulder-webxr.glb')).then(gltf=>{
      const source=gltf.scene;source.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(source),center=box.getCenter(new THREE.Vector3());
      const sourceHeight=box.max.y-box.min.y;
      source.position.set(-center.x,-box.min.y,-center.z);
      source.traverse(node=>{if((node as THREE.Mesh).isMesh){const mesh=node as THREE.Mesh;mesh.castShadow=true;mesh.receiveShadow=true;
        for(const material of (Array.isArray(mesh.material)?mesh.material:[mesh.material]) as THREE.MeshStandardMaterial[]){material.normalScale.set(.45,.45);if(material.map)material.map.anisotropy=4;}
      }});
      const placements=[[-4.7,-10.1,1.3,.4],[10.5,-17,1.7,2.4],[-10.2,1.6,1.5,-.8],[5.1,7.4,1.25,1.8],[-15,-21,2.1,2.8]];
      for(const [index,[x,z,height,yaw]] of placements.entries()){
        const root=new THREE.Group();root.name='scanned woodland boulder '+index;
        root.add(source.clone(true));root.scale.setScalar(height/sourceHeight);
        root.rotation.y=yaw;root.position.set(x,heightAt(x,z)-.10,z);this.root.add(root);
        root.updateWorldMatrix(true,true);
        const points:{x:number;z:number}[]=[],point=new THREE.Vector3();
        root.traverse(node=>{if(!(node as THREE.Mesh).isMesh)return;const mesh=node as THREE.Mesh,p=mesh.geometry.attributes.position;
          for(let i=0;i<p.count;i+=3){point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);parent.worldToLocal(point);points.push({x:point.x,z:point.z});}
        });
        collisions.addPolygon({id:'shadow-boulder-'+index,points,minY:heightAt(x,z)-.1,maxY:heightAt(x,z)+height});
      }
      applyStencilLayer(this.root,layer());
    });
    this.ready=Promise.allSettled([rocks,this.organic.ready]).then(results=>{this.status=results.every(r=>r.status==='fulfilled')?'ready':'fallback';});
    applyStencilLayer(this.root,layer());
  }
  update(time:number){this.mistUniforms.uTime.value=time;}
}

/** Shared local PBR textures; loading is accounted for in world readiness. */
export function shadowGroundMaps(repeat: number) {
  const loader = new THREE.TextureLoader();
  const loads: Promise<void>[] = [];
  const load = (file: string, color = false) => {
    let settle!: () => void;
    loads.push(new Promise(resolve => { settle = resolve; }));
    const texture = loader.load(assetUrl('/textures/refined/') + file, settle, undefined, settle);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.setScalar(repeat);
    texture.anisotropy = 4;
    return texture;
  };
  return { maps: { map: load('ground_color.jpg', true), normalMap: load('ground_normal.jpg'),
    roughnessMap: load('ground_roughness.jpg') }, ready: Promise.all(loads).then(() => {}) };
}
