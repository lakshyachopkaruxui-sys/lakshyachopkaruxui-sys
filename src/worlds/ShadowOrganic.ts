import { assetUrl } from '../utils/assetUrl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyStencilLayer } from '../portal/PortalRenderer';
import { WorldCollisions } from './WorldCollisions';

/** Creator-modelled bare firs and photographic deadwood, kept in natural proportions. */
export class ShadowOrganic {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly trunks: { x: number; z: number; radius: number; height: number }[] = [];
  constructor(parent: THREE.Group, heightAt: (x: number, z: number) => number, layer: () => number,
    collisions = new WorldCollisions(parent)) {
    this.root.name = 'bare fir woodland and fallen scanned timber';
    const loader = new GLTFLoader();
    this.ready = Promise.all([
      loader.loadAsync(assetUrl('/models/forest/conifers/fir_tree_01_bare.glb')),
      loader.loadAsync(assetUrl('/models/shadow/organic/dead_quiver_trunk/dead_quiver_trunk_1k.gltf')),
      loader.loadAsync(assetUrl('/models/shadow/organic/dry_branches_medium_01/dry_branches_medium_01_1k.gltf'))
    ]).then(([fir, stump, branches]) => {
      const positions: number[][] = [
        [-5.7,-4.7,17,.2],[7.4,-7.7,19,1.7],[-10.3,-14,18,-.4],[3.7,-13,16,2.4],
        [-9,4.5,16,2],[9.5,6,19,.7],[-3.5,11,15,.3],[6,-25,20,-1],
        [-13,-3,19,.8],[14,-1,17,-.6],[-15,10,18,2],[14,14,20,1]
      ];
      // Irregular outer woodland surrounds the clearing, beyond the playable bounds.
      for (let i=0;i<24;i++) {
        const angle=i*2.399963+0.3, radius=21+(i*7%17);
        positions.push([Math.cos(angle)*radius,Math.sin(angle)*radius-4,14+(i*3%8),i*1.37]);
      }
      const point = new THREE.Vector3(), matrix = new THREE.Matrix4(), local = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion(), scaleVector = new THREE.Vector3();
      for (const [variantIndex, variant] of ['a','b','c'].entries()) {
        const group = new THREE.Group();
        fir.scene.traverse(node => { if ((node as THREE.Mesh).isMesh && node.name.startsWith('fir_tree_01_'+variant+'_LOD2')) {
          const mesh=(node as THREE.Mesh).clone(); mesh.applyMatrix4(node.matrixWorld); group.add(mesh);
        } });
        if (!group.children.length) throw new Error('Missing bare fir variant '+variant);
        group.updateMatrixWorld(true);
        const box=new THREE.Box3().setFromObject(group), center=box.getCenter(new THREE.Vector3());
        const sourceHeight=box.max.y-box.min.y;
        const selected=positions.filter((_,index)=>index%3===variantIndex);
        const lowPoints: THREE.Vector3[]=[];
        group.traverse(node=>{if(!(node as THREE.Mesh).isMesh)return;const mesh=node as THREE.Mesh,p=mesh.geometry.attributes.position;
          for(let i=0;i<p.count;i++){point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
            if(point.y-box.min.y<sourceHeight*.115)lowPoints.push(point.clone());}
        });
        const lowBounds=new THREE.Box3().setFromPoints(lowPoints),axis=lowBounds.getCenter(new THREE.Vector3());
        const lowerRadius=Math.max(...lowPoints.map(p=>Math.hypot(p.x-axis.x,p.z-axis.z)));
        group.traverse(node=>{ if (!(node as THREE.Mesh).isMesh) return;
          const mesh=node as THREE.Mesh;
          // Instance complete source material parts with a shared recenter transform.
          const instanced=new THREE.InstancedMesh(mesh.geometry,mesh.material,selected.length);
          instanced.name='scanned bare fir '+variant+' '+mesh.name; instanced.castShadow=instanced.receiveShadow=true;
          selected.forEach(([x,z,height,yaw],i)=>{
            const s=height/sourceHeight;
            quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
            matrix.compose(new THREE.Vector3(x,heightAt(x,z)-.08,z),quaternion,scaleVector.setScalar(s));
            local.makeTranslation(-center.x,-box.min.y,-center.z).multiply(mesh.matrixWorld);
            matrix.multiply(local); instanced.setMatrixAt(i,matrix);
          });
          instanced.instanceMatrix.needsUpdate=true; instanced.computeBoundingBox(); instanced.computeBoundingSphere(); this.root.add(instanced);
        });
        selected.forEach(([x,z,height,yaw],i)=> {
          // The actual lower woody axis differs from an asymmetric canopy's center.
          const s=height/sourceHeight,dx=(axis.x-center.x)*s,dz=(axis.z-center.z)*s;
          const cx=x+Math.cos(yaw)*dx+Math.sin(yaw)*dz,cz=z-Math.sin(yaw)*dx+Math.cos(yaw)*dz;
          const radius=Math.max(.20,lowerRadius*s);
          this.trunks.push({x:cx,z:cz,radius,height});
          collisions.addCircle({id:'shadow-fir-'+variant+'-'+i,x:cx,z:cz,radius,minY:heightAt(x,z)-.1,maxY:heightAt(x,z)+height});
        });
      }
      const addGrounded=(source:THREE.Object3D,x:number,z:number,height:number,yaw:number,id:string)=> {
        const model=source.clone(true), wrapper=new THREE.Group(); wrapper.add(model);
        model.updateMatrixWorld(true); const box=new THREE.Box3().setFromObject(model), center=box.getCenter(new THREE.Vector3());
        const s=height/(box.max.y-box.min.y); model.position.set(-center.x,-box.min.y,-center.z); wrapper.scale.setScalar(s);
        wrapper.position.set(x,heightAt(x,z)-.06,z); wrapper.rotation.y=yaw; wrapper.name=id;
        wrapper.traverse(node=> {if((node as THREE.Mesh).isMesh){(node as THREE.Mesh).castShadow=true;(node as THREE.Mesh).receiveShadow=true;}});
        this.root.add(wrapper); wrapper.updateWorldMatrix(true,true);
        const points:{x:number;z:number}[]=[];
        wrapper.traverse(node=> {if(!(node as THREE.Mesh).isMesh)return;
          const mesh=node as THREE.Mesh,p=mesh.geometry.attributes.position;
          for(let i=0;i<p.count;i+=4){point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);this.root.worldToLocal(point);
            if(point.y<heightAt(x,z)+1.7)points.push({x:point.x,z:point.z});}
        });
        if(points.length>=3)collisions.addPolygon({id,points,minY:heightAt(x,z)-.1,maxY:heightAt(x,z)+height});
      };
      [[-4.8,3.6,1.6,.7],[10,-12.8,2.1,2.2],[-12,-8,1.8,-.8]].forEach(([x,z,h,yaw],i)=>addGrounded(stump.scene,x,z,h,yaw,'shadow-stump-'+i));
      [[-8,1.3,.38,-.8],[9.5,-4,.35,1.1],[-3,-15.4,.36,2.4]].forEach(([x,z,h,yaw],i)=>addGrounded(branches.scene,x,z,h,yaw,'shadow-fallen-branches-'+i));
      applyStencilLayer(this.root,layer()); parent.add(this.root);
    });
  }
}
