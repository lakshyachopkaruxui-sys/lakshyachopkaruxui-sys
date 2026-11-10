import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, options) { this.type = type; Object.assign(this, options); } };
const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  }
});
const { ForestFauna } = await import('../src/worlds/ForestFauna.ts');
const { measureProp } = await import('../src/worlds/props.ts');
const bytes = readFileSync(new URL('../public/models/realistic-deer/doe.glb', import.meta.url));
const jsonSize = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
const bin = bytes.subarray(20 + jsonSize + 8);
async function sourceModel() {
  const data = structuredClone(json);
  data.buffers[0].uri = 'data:application/octet-stream;base64,' + bin.toString('base64');
  delete data.images; delete data.textures; delete data.samplers;
  data.materials = data.materials.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  return new GLTFLoader().parseAsync(JSON.stringify(data), '');
}
async function fixture(callback) {
  const model = await sourceModel(), original = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async url => { assert.equal(url, '/models/realistic-deer/doe.glb'); return model; };
  try { await callback(); } finally { GLTFLoader.prototype.loadAsync = original; }
}
function frames(fauna, seconds, viewer = new THREE.Vector3(0, 1.65, 0), active = true) {
  for (let i = 0; i < Math.round(seconds * 60); i++) { fauna.updateView(viewer, active, 1/60); fauna.update(1/60); }
}


import {mkdirSync,writeFileSync} from 'node:fs';
const out=new URL('../validation/forest-quality-2026-10-16/deer-poses/',import.meta.url);mkdirSync(out,{recursive:true});
const imageFiles=json.images.map((im,i)=>{const v=json.bufferViews[im.bufferView];const name=`texture-${i}.jpg`;writeFileSync(new URL(name,out),bin.subarray(v.byteOffset,v.byteOffset+v.byteLength));return name;});
await fixture(async()=>{
 const parent=new THREE.Group(),fauna=new ForestFauna(parent,()=>0,()=>1);await fauna.ready;
 const a=fauna.animals[0];a.root.rotation.y=0;a.route=[a.root.position.clone(),a.root.position.clone().add(new THREE.Vector3(0,0,100))];a.waypoint=1;
 frames(fauna,2);const meshes=[];
 a.root.traverse(o=>{if(o.isMesh){const prim=json.meshes.find(m=>m.name===o.name)?.primitives?.[0];
 const materialIndex=prim?.material??json.materials.findIndex(m=>m.name===o.material.name);
 const textureIndex=json.materials[materialIndex]?.pbrMetallicRoughness?.baseColorTexture?.index;
 meshes.push({object:o,texture:imageFiles[json.textures[textureIndex]?.source??0]});}});
 const poses=[];
 for(let frame=0;frame<18;frame++){
  frames(fauna,.05);a.root.updateMatrixWorld(true);
  const parts=[];
  for(const [i,{object:o,texture}] of meshes.entries()){
   const verts=new Float32Array(o.geometry.attributes.position.count*3),v=new THREE.Vector3();
   for(let j=0;j<o.geometry.attributes.position.count;j++){o.getVertexPosition(j,v);v.applyMatrix4(o.matrixWorld);a.root.worldToLocal(v);verts.set(v.toArray(),j*3);}
   const name=`pose-${frame}-${i}.bin`;writeFileSync(new URL(name,out),Buffer.from(verts.buffer));
   if(frame===0){writeFileSync(new URL(`uv-${i}.bin`,out),Buffer.from(o.geometry.attributes.uv.array.buffer));writeFileSync(new URL(`indices-${i}.bin`,out),Buffer.from(new Uint32Array(o.geometry.index.array).buffer));}
   parts.push({positions:name,uv:`uv-${i}.bin`,indices:`indices-${i}.bin`,texture});
  }
  poses.push({frame,parts});
 }
 writeFileSync(new URL('poses.json',out),JSON.stringify(poses));console.log('Exported 18 walking poses from the runtime skeleton.');
});
