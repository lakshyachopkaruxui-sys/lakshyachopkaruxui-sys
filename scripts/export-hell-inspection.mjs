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

import {mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
const require=createRequire(import.meta.url);
const {createCanvas}=require('C:/Users/Lakshya/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const out=new URL('../validation/hell-redesign-2026-10-18/scene-inspection/',import.meta.url);mkdirSync(out,{recursive:true});
globalThis.document={createElement:()=>createCanvas(128,128)};
let sequence=0;
function saveTextureData(bytes,extension){const name=`texture-${sequence++}.${extension}`;writeFileSync(new URL(name,out),bytes);return new URL(name,out).pathname.replace(/^\/([A-Z]:)/,'$1');}
THREE.TextureLoader.prototype.load=function(url,onLoad){const t=new THREE.Texture();t.userData.path=new URL('../public'+url,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');queueMicrotask(()=>onLoad?.(t));return t;};
HDRLoader.prototype.loadAsync=async function(url){const raw=readFileSync(new URL('../public'+url,import.meta.url));const d=this.parse(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));const t=new THREE.DataTexture(d.data,d.width,d.height,THREE.RGBAFormat,d.type);t.flipY=d.flipY;t.colorSpace=d.colorSpace;return t;};
GLTFLoader.prototype.loadAsync=async function(url){
 const file=new URL('../public'+url,import.meta.url),raw=readFileSync(file);let data,bin;
 if(url.endsWith('.glb')){const l=raw.readUInt32LE(12);data=JSON.parse(raw.subarray(20,20+l));bin=raw.subarray(28+l);}else data=JSON.parse(raw);
 const buffers=data.buffers.map(buffer=>buffer.uri?.startsWith('data:')?Buffer.from(buffer.uri.split(',')[1],'base64'):buffer.uri?readFileSync(new URL(buffer.uri,file)):bin);
 data.buffers.forEach((buffer,i)=>{buffer.uri='data:application/octet-stream;base64,'+buffers[i].toString('base64');});
 const loader=new GLTFLoader();loader.register(()=>({name:'NODE_LOCAL_TEXTURES',loadTexture(index){
  const im=data.images[data.textures[index].source],t=new THREE.Texture();t.flipY=false;
  if(im.uri?.startsWith('data:'))t.userData.path=saveTextureData(Buffer.from(im.uri.split(',')[1],'base64'),im.uri.includes('image/png')?'png':'jpg');
  else if(im.uri)t.userData.path=new URL(im.uri,file).pathname.replace(/^\/([A-Z]:)/,'$1');
  else{const v=data.bufferViews[im.bufferView];t.userData.path=saveTextureData(buffers[v.buffer].subarray(v.byteOffset,v.byteOffset+v.byteLength),im.mimeType==='image/png'?'png':'jpg');}
  return Promise.resolve(t);
 }}));return loader.parseAsync(JSON.stringify(data),'');
};
const {WorldThree}=await import('../src/worlds/WorldThree.ts');const world=new WorldThree(new THREE.Vector3());await world.ready;
world.update(8,0);
world.root.updateMatrixWorld(true);
const objects=[],materials=[],matMap=new Map();
function texture(t){if(!t)return null;
 if(t.userData.path)return {path:t.userData.path,flipY:t.flipY,repeat:t.repeat.toArray(),offset:t.offset.toArray(),clamp:t.wrapS===THREE.ClampToEdgeWrapping};
 if(t.image?.toBuffer)return {path:saveTextureData(t.image.toBuffer('image/png'),'png'),flipY:t.flipY,repeat:t.repeat.toArray(),offset:t.offset.toArray()};
 if(t.image?.data){const a=t.image.data;const file=saveTextureData(Buffer.from(a.buffer,a.byteOffset,a.byteLength),'raw');return {path:file,raw:true,width:t.image.width,height:t.image.height,type:a.constructor.name,flipY:t.flipY,repeat:t.repeat.toArray(),offset:t.offset.toArray(),clamp:t.wrapS===THREE.ClampToEdgeWrapping};}
 return null;}
function material(m){if(matMap.has(m.uuid))return matMap.get(m.uuid);const i=materials.length;matMap.set(m.uuid,i);
 const fade=m.userData.forestDetailFade;
 materials.push({color:m.color?.toArray()??[1,1,1],map:texture(m.map),alphaMap:texture(m.alphaMap),alphaTest:m.alphaTest,opacity:m.opacity,transparent:m.transparent,basic:m.isMeshBasicMaterial,side:m.side,layered:m.customProgramCacheKey?.().startsWith('forest-moss-root-soil-v2'),sampleSoil:m.userData.forestSampleSoil,sampleLitter:m.userData.sampleLitter?.map(texture),forestLitter:m.userData.forestLitter?.map(texture),vertexColors:m.vertexColors,emissive:m.emissive?.toArray(),emissiveIntensity:m.emissiveIntensity,emissiveMap:texture(m.emissiveMap),naturalGrass:m.userData.forestNaturalGrass,tawnyFur:m.userData.forestTawnyFur,bladeSurface:m.userData.forestBladeSurface,detailFade:fade?{viewer:fade.viewer.value.toArray(),range:fade.range.value.toArray()}:null});return i;}
let id=0;
world.root.traverseVisible(o=>{
 if(!o.isMesh || o.material?.isShaderMaterial)return;
 const g=o.geometry,mat=Array.isArray(o.material)?o.material[0]:o.material;
 const vertices=new Float32Array(g.attributes.position.count*3),v=new THREE.Vector3();
 for(let i=0;i<g.attributes.position.count;i++){o.getVertexPosition(i,v);vertices.set(v.toArray(),i*3);}
 const key=`mesh-${id++}`;writeFileSync(new URL(key+'-pos.bin',out),Buffer.from(vertices.buffer));
 const indices=new Uint32Array(g.index?.array??Array.from({length:g.attributes.position.count},(_,i)=>i));writeFileSync(new URL(key+'-idx.bin',out),Buffer.from(indices.buffer));
 if(g.attributes.uv)writeFileSync(new URL(key+'-uv.bin',out),Buffer.from(g.attributes.uv.array.buffer));
 if(g.attributes.normal&&mat.userData.forestNaturalGrass)writeFileSync(new URL(key+'-normal.bin',out),Buffer.from(g.attributes.normal.array.buffer));
 if(g.attributes.color){const c=g.attributes.color, values=new Float32Array(c.count*3);for(let i=0;i<c.count;i++)values.set([c.getX(i),c.getY(i),c.getZ(i)],i*3);writeFileSync(new URL(key+'-color.bin',out),Buffer.from(values.buffer));}
 const transforms=[];if(o.isInstancedMesh){for(let i=0;i<o.count;i++){const m=new THREE.Matrix4();o.getMatrixAt(i,m);transforms.push(o.matrixWorld.clone().multiply(m).toArray());}}else transforms.push(o.matrixWorld.toArray());
 objects.push({name:o.name,positions:key+'-pos.bin',indices:key+'-idx.bin',uv:g.attributes.uv?key+'-uv.bin':null,normals:g.attributes.normal&&mat.userData.forestNaturalGrass?key+'-normal.bin':null,colors:g.attributes.color?key+'-color.bin':null,instanceColors:o.instanceColor?Array.from(o.instanceColor.array):null,transforms,material:material(mat)});
});
const lighting={hemisphere:1.05,sun:2.1,environment:0,fog:world.scene.fog.color.toArray()};
writeFileSync(new URL('scene.json',out),JSON.stringify({objects,materials,layers:{},lighting,scope:'Offline composition approximation; excludes shader sky, planets and particles. Not a browser capture.'}));
console.log(JSON.stringify({objects:objects.length,materials:materials.length,status:world.landscape.status,creatures:world.fauna.creatures.length}));
