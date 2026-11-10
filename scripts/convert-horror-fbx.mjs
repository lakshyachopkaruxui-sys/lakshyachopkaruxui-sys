// Converts creator-supplied CC0 FBX mesh/rig/clips; never executes asset scripts.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
globalThis.window={URL:globalThis.URL};
globalThis.FileReader=class{
 readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}
 readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.();});}
};
THREE.TextureLoader.prototype.load=()=>new THREE.Texture();
// Maya uses duplicate short joint names on opposite limbs. Resolve them by
// hierarchy before Three builds name-bound animation tracks; retain the same
// canonical names across the creator's independently exported FBX clips.
const normalizeNames=tree=>{
 const models=tree.Objects.Model,original=new Map(Object.entries(models).map(([id,m])=>[String(id),m.attrName]));
 const parent=new Map();
 for(const [from,to]of tree.Connections.connections)if(models[from]&&models[to])parent.set(String(from),String(to));
 const path=id=>parent.has(id)?path(parent.get(id))+'__'+original.get(id):original.get(id);
 const used=new Map();
 for(const id of original.keys()){
  const name='fbx__'+path(id),count=used.get(name)||0;used.set(name,count+1);
  models[id].attrName=name+(count?'__sibling'+count:'');
 }
};
let loaderSource=await readFile(new URL('../node_modules/three/examples/jsm/loaders/FBXLoader.js',import.meta.url),'utf8');
loaderSource=loaderSource.replace("'../libs/fflate.module.js'","'three/addons/libs/fflate.module.js'").replace("'../curves/NURBSCurve.js'","'three/addons/curves/NURBSCurve.js'").replace('// console.log( fbxTree );',`(${normalizeNames.toString()})(fbxTree);`);
const normalizedLoader=new URL('../validation/horror-rebuild/FBXLoader-normalized.mjs',import.meta.url);
await writeFile(normalizedLoader,loaderSource);
const {FBXLoader}=await import(normalizedLoader.href);
const source=new URL('../validation/horror-rebuild/monster/Poses/',import.meta.url);
const output=new URL('../public/models/shadow/horror-humanoid/',import.meta.url);await mkdir(output,{recursive:true});
const load=async name=>{const bytes=await readFile(new URL(name+'.fbx',source));return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
const model=await load('Idle'),clips=[],inspection={meshes:[],bones:[],clips:[]};
for(const name of ['Idle','Walk','Run']){
 const object=name==='Idle'?model:await load(name);
 const clip=object.animations[0];if(!clip)throw new Error('Missing creator clip '+name);
 clip.name=name;clips.push(clip);inspection.clips.push({name,duration:clip.duration,tracks:clip.tracks.map(t=>t.name)});
}
model.traverse(node=>{
 if(node.isBone)inspection.bones.push(node.name);
 if(!node.isMesh)return;
 if(node.isSkinnedMesh)node.normalizeSkinWeights();
 inspection.meshes.push({name:node.name,vertices:node.geometry.attributes.position.count,triangles:(node.geometry.index?.count??node.geometry.attributes.position.count)/3,skinned:!!node.isSkinnedMesh});
 node.material=new THREE.MeshStandardMaterial({name:'Creator skin PBR',color:0xffffff,roughness:.82});
});
const gltf=await new GLTFExporter().parseAsync(model,{animations:clips,binary:false,onlyVisible:false});
gltf.images=[{uri:'albedo.jpg'},{uri:'normal.jpg'},{uri:'roughness.png'}];
gltf.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
gltf.textures=gltf.images.map((_,source)=>({source,sampler:0}));
for(const material of gltf.materials){material.pbrMetallicRoughness={baseColorFactor:[1,1,1,1],baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1,metallicRoughnessTexture:{index:2}};material.normalTexture={index:1,scale:.8};}
await writeFile(new URL('horror-humanoid.gltf',output),JSON.stringify(gltf));
await writeFile(new URL('../validation/horror-rebuild/humanoid-inspection.json',import.meta.url),JSON.stringify(inspection,null,2));
console.log(JSON.stringify({meshes:inspection.meshes,bones:inspection.bones.length,clips:inspection.clips.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length}))}));
