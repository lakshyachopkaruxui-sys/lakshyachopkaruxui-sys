import { readFileSync, existsSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.startsWith(sourceRoot)){
 const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return{url:url.href,shortCircuit:true};}return next(specifier,context);},
 load(url,context,next){if(url.startsWith(sourceRoot)&&url.endsWith('.ts'))return{format:'module',shortCircuit:true,source:stripTypeScriptTypes(readFileSync(new URL(url),'utf8'),{mode:'transform'})};return next(url,context);}});
globalThis.ProgressEvent??=class{constructor(type,data){Object.assign(this,{type},data)}};
export { THREE, GLTFLoader };
export const assets=new Map();
export async function actualAsset(path){
 if(assets.has(path))return assets.get(path);
 const file=new URL('../public'+path,import.meta.url),data=readFileSync(file);let json;
 if(path.endsWith('.glb')){const n=data.readUInt32LE(12);json=JSON.parse(data.subarray(20,20+n));const offset=20+n;const bin=data.subarray(offset+8,offset+8+data.readUInt32LE(offset));json.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');}
 else{json=JSON.parse(data);for(const buffer of json.buffers??[])if(!buffer.uri?.startsWith('data:'))buffer.uri='data:application/octet-stream;base64,'+readFileSync(new URL(buffer.uri,file)).toString('base64');}
 for(const material of json.materials??[]){delete material.pbrMetallicRoughness?.baseColorTexture;delete material.pbrMetallicRoughness?.metallicRoughnessTexture;delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;}
 const gltf=await new GLTFLoader().parseAsync(JSON.stringify(json),'');assets.set(path,gltf);return gltf;
}
export const paths=['/models/forest/conifers/fir_tree_01_bare.glb','/models/shadow/organic/dead_quiver_trunk/dead_quiver_trunk_1k.gltf','/models/shadow/organic/dry_branches_medium_01/dry_branches_medium_01_1k.gltf','/models/shadow/boulder_01/boulder-webxr.glb','/models/shadow/horror-humanoid/horror-humanoid.gltf','/models/hell/rock-face-01/rock_face_01_1k.gltf'];
export async function preload(){await Promise.all(paths.map(actualAsset));}
export function mockAssets(t){t.mock.method(GLTFLoader.prototype,'load',(url,onLoad,_p,onError)=>queueMicrotask(()=>assets.has(url)?onLoad(assets.get(url)):onError?.(new Error('Unknown '+url))));}
export async function faunaFixture(t,terrain=()=>0){await actualAsset(paths[4]);mockAssets(t);const{ShadowFauna}=await import('../src/worlds/ShadowFauna.ts');const{WorldCollisions}=await import('../src/worlds/WorldCollisions.ts');const parent=new THREE.Group(),collisions=new WorldCollisions(parent);const fauna=new ShadowFauna(parent,terrain,()=>1,collisions);await fauna.ready;return{parent,collisions,fauna,viewer:new THREE.Vector3(0,1.7,2)};}
