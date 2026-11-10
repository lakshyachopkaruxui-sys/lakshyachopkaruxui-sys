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
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module',
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return nextLoad(url, context);
  }
});
const { loadLayeredForestFloor, canopyLightMap, forestSurfaceAt, forestGrowthAt } = await import('../src/worlds/ForestGround.ts');

test('new forest maps retain verified source provenance and 2K color / 1K data JPEGs', () => {
  const records=JSON.parse(readFileSync(new URL('../public/textures/forest-quality/SOURCE-MANIFEST.json',import.meta.url)));
  assert.equal(records.length,6);
  for(const r of records) {
    assert.equal(r.license,'CC0-1.0');
    const bytes=readFileSync(new URL('../'+r.file.replaceAll('\\','/'),import.meta.url));
    assert.equal(bytes.length,r.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),r.sha256);
    assert.equal(bytes.readUInt16BE(0),0xffd8);
  }
});

test('canopy illumination is deterministic, bounded and varied without a shadow pass',()=>{
  const a=canopyLightMap(),b=canopyLightMap();
  assert.deepEqual(a.image.data,b.image.data);assert.equal(a.image.width,256);
  const values=[];for(let i=0;i<a.image.data.length;i+=4)values.push(a.image.data[i]);
  assert.ok(Math.min(...values)>=132);assert.equal(Math.max(...values),255);
  assert.ok(new Set(values).size>50);a.dispose();b.dispose();
});

test('layered floor replaces all maps together and patches the installed Three shader',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync;
  const paths=[];THREE.TextureLoader.prototype.loadAsync=async path=>{paths.push(path);return new THREE.Texture()};
  try {
    const material=new THREE.MeshStandardMaterial();assert.equal(await loadLayeredForestFloor(material),true);
    assert.equal(paths.length,6);assert.equal(material.map.colorSpace,THREE.SRGBColorSpace);
    assert.equal(material.normalMap.colorSpace,THREE.NoColorSpace);assert.equal(material.map.repeat.x,112/2.1);
    assert.ok(paths[0].endsWith('/textures/refined/ground_color.jpg'));
    assert.ok(material.normalScale.x < .5, 'reduce harsh high-frequency ground relief');
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader,{});
    assert.ok(shader.fragmentShader.includes('vec3 mapN = normalize(mix('),'normal maps must blend in the actual installed shader chunk');
    assert.ok(shader.fragmentShader.indexOf('float forestMix')<shader.fragmentShader.indexOf('vec3 mapN'));
    assert.ok(shader.vertexShader.includes('vForestLocal = position'));
    assert.equal(shader.uniforms.forestCanopy.value.image.width,256);
  }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});

test('forest material coverage follows actual roots, keeps an earthy trail and moss between plants',()=>{
  const trees=[{x:-5,z:-7,scale:1},{x:8,z:-15,scale:.5}];
  assert.ok(forestSurfaceAt(-5,-7,trees).roots > .99);
  assert.ok(forestSurfaceAt(-5,-7,trees).soil >= .85);
  for(const z of [-3,-8,-17]) {
    const x=Math.sin(z*.15)*1.25;
    assert.ok(forestSurfaceAt(x,z,trees).soil >= .85,'walking trail stays earthy');
  }
  assert.ok(forestSurfaceAt(14,-5,trees).soil < .35,'off-trail ground keeps a living moss base');
  assert.ok(forestSurfaceAt(5,-9,trees).moisture >= .65,'pond banks stay damp');
  let maximumStep=0;
  for(let x=-20;x<20;x+=.1)for(let z=-25;z<10;z+=.5){
    const a=forestSurfaceAt(x,z,trees),b=forestSurfaceAt(x+.01,z,trees);
    for(const key of Object.keys(a))assert.ok(Number.isFinite(a[key])&&a[key]>=0&&a[key]<=1,key);
    maximumStep=Math.max(maximumStep,Math.abs(a.soil-b.soil));
    assert.equal(a.growth,forestGrowthAt(x,z));
  }
  assert.ok(maximumStep < .04,'no hard material seam at roots or trail edges');
});

test('measured root positions drive the data texture after asynchronous tree loading',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync=async()=>new THREE.Texture();
  try{
    const roots=[{x:12,z:-12,scale:1.2}];
    const material=new THREE.MeshStandardMaterial();
    await loadLayeredForestFloor(material,Promise.resolve(roots));
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader,{});
    assert.deepEqual(shader.uniforms.forestCanopy.value.image.data,canopyLightMap(roots).image.data);
  }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});

test('partial material download failure preserves every existing floor map',async()=>{
  const original=THREE.TextureLoader.prototype.loadAsync;
  THREE.TextureLoader.prototype.loadAsync=async path=>{if(path.includes('04_nor'))throw Error('controlled missing map');return new THREE.Texture()};
  try{
    const material=new THREE.MeshStandardMaterial({map:new THREE.Texture(),normalMap:new THREE.Texture(),roughnessMap:new THREE.Texture()});
    const previous=[material.map,material.normalMap,material.roughnessMap];
    assert.equal(await loadLayeredForestFloor(material),false);assert.deepEqual([material.map,material.normalMap,material.roughnessMap],previous);
  }finally{THREE.TextureLoader.prototype.loadAsync=original;}
});
