import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './shadow-test-fixture.mjs';
const { createHellMountainMaterial } = await import('../src/worlds/HellMountainMaterial.ts');

function fixture() {
  const map=new THREE.Texture(),normalMap=new THREE.Texture(),roughnessMap=new THREE.Texture();
  map.colorSpace=THREE.SRGBColorSpace;
  for(const texture of [map,normalMap,roughnessMap])texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  return {map,normalMap,roughnessMap};
}
function patched(material){
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader,{});return shader;
}

test('mountain material shares source maps without altering their transforms or lifetime',()=>{
  const maps=fixture(),initial=Object.values(maps).map(texture=>({uuid:texture.uuid,matrix:texture.matrix.toArray(),space:texture.colorSpace}));
  let disposed=0;Object.values(maps).forEach(texture=>texture.addEventListener('dispose',()=>disposed++));
  const material=createHellMountainMaterial(maps);
  assert.equal(material.map,maps.map);assert.equal(material.normalMap,maps.normalMap);assert.equal(material.roughnessMap,maps.roughnessMap);
  assert.equal(material.normalMapType,THREE.ObjectSpaceNormalMap);
  assert.equal(material.emissiveIntensity,1);assert.equal(material.emissive.getHex(),0);
  assert.equal(material.transparent,false);assert.equal(material.metalness,0);
  assert.deepEqual(material.defaultAttributeValues.mountainCavity,[0],
    'supporting meshes without authored crevices receive an unoccluded constant attribute');
  assert.deepEqual(Object.values(maps).map(texture=>({uuid:texture.uuid,matrix:texture.matrix.toArray(),space:texture.colorSpace})),initial);
  material.dispose();assert.equal(disposed,0,'source textures belong to the caller');
});

test('projected mountain detail uses owning-local metres and retains Standard lighting, fog and portal material state',()=>{
  const material=createHellMountainMaterial(fixture(),{tileMetres:3.5,normalStrength:.7});
  material.stencilWrite=true;material.stencilRef=2;material.stencilFunc=THREE.EqualStencilFunc;
  const shader=patched(material);
  assert.ok(Math.abs(shader.uniforms.mountainTileScale.value-1/3.5)<1e-12);
  assert.equal(material.normalScale.x,.7);
  assert.match(shader.vertexShader,/vMountainLocal=position/);
  assert.match(shader.vertexShader,/vMountainNormal=normal/);
  assert.match(shader.vertexShader,/attribute float mountainCavity/);
  assert.match(shader.vertexShader,/vMountainCavity=clamp\(mountainCavity,0\.,1\.\)/);
  assert.match(shader.fragmentShader,/normalMatrix\*mountainMapped/,'normal reorientation follows each view and world alignment');
  for(const chunk of ['lights_fragment_begin','lights_fragment_end','fog_fragment','tonemapping_fragment','colorspace_fragment'])
    assert.ok(shader.fragmentShader.includes(`#include <${chunk}>`),chunk);
  assert.equal(material.stencilRef,2);assert.equal(material.stencilFunc,THREE.EqualStencilFunc);
  assert.ok(!shader.fragmentShader.includes('texture2D(map,vMapUv)'),'generated cone UVs cannot stretch the rock grain');
  assert.deepEqual(material.userData.mountainBudget,{textureSamples:6,extraTextures:0,extraLights:0,extraRenderPasses:0,coordinates:'owning-local metres'});
  assert.match(shader.fragmentShader,/reflectedLight\.indirectDiffuse\*=1\.-mountainCavityAmount/);
  assert.ok(!shader.fragmentShader.includes('reflectedLight.directDiffuse*='),
    'cavity occlusion preserves light striking exposed faces');
});

test('default fracture scale reads as metre-sized rock plates without a new texture or silhouette effect',()=>{
  const material=createHellMountainMaterial(fixture()),shader=patched(material);
  assert.ok(Math.abs(shader.uniforms.mountainTileScale.value-1/6.2)<1e-12);
  assert.ok(material.normalScale.x>=1&&material.normalScale.x<=1.1);
  assert.equal(material.displacementMap,null);assert.equal(material.bumpMap,null);assert.equal(material.aoMap,null);
  assert.ok(!shader.fragmentShader.includes('mountainStrata'),'periodic thin stripes do not replace real fracture relief');
  assert.equal((shader.fragmentShader.match(/texture2D\(map,/g)??[]).length,3);
  assert.equal((shader.fragmentShader.match(/texture2D\(roughnessMap,/g)??[]).length,1);
  assert.equal((shader.fragmentShader.match(/texture2D\(normalMap,/g)??[]).length,1);
  assert.equal((shader.fragmentShader.match(/=mountainPerturb\(/g)??[]).length,2,
    'one normal sampler is invoked for the two strongest projections, preserving the six-fetch ceiling');
});

test('scalar tuning reuses the program and map-free fallback keeps finite rock parameters',()=>{
  const maps=fixture(),a=createHellMountainMaterial(maps,{tileMetres:.01}),b=createHellMountainMaterial(maps,{tileMetres:200});
  assert.equal(a.customProgramCacheKey(),b.customProgramCacheKey(),'uniform tuning does not compile another shader');
  assert.equal(patched(a).uniforms.mountainTileScale.value,2.5);
  assert.equal(patched(b).uniforms.mountainTileScale.value,1/16);
  const fallback=createHellMountainMaterial({map:null,normalMap:null,roughnessMap:null});
  assert.equal(fallback.map,null);assert.ok(Number.isFinite(fallback.roughness));
  assert.match(patched(fallback).fragmentShader,/#ifdef USE_NORMALMAP/);
});
