import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {THREE} from './shadow-test-fixture.mjs';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
const {createHellSky,HELL_SKY_ASSET}=await import('../src/worlds/HellSky.ts');
const {applyStencilLayer}=await import('../src/portal/PortalRenderer.ts');

test('photographic hell sky settles asynchronously and retains its portal stencil when loaded',async t=>{
  let complete;
  const requested=[];
  t.mock.method(HDRLoader.prototype,'loadAsync',url=>{
    requested.push(url);
    return new Promise(resolve=>complete=resolve);
  });
  const {mesh,ready}=createHellSky();
  assert.deepEqual(requested,[HELL_SKY_ASSET]);
  assert.equal(mesh.userData.skyStatus,'loading');
  assert.equal(mesh.material.uniforms.panoramaReady.value,0);
  assert.equal(mesh.material.side,THREE.BackSide);
  assert.equal(mesh.material.depthWrite,false);
  assert.equal(mesh.material.fog,false);
  applyStencilLayer(mesh,2);
  const fallback=mesh.material.uniforms.panorama.value;
  let fallbackDisposed=false;
  fallback.addEventListener('dispose',()=>fallbackDisposed=true);
  const panorama=new THREE.DataTexture(new Uint16Array(4),1,1,THREE.RGBAFormat,THREE.HalfFloatType);
  complete(panorama);
  assert.equal(await ready,true);
  assert.equal(mesh.userData.skyStatus,'ready');
  assert.equal(mesh.material.uniforms.panoramaReady.value,1);
  assert.equal(mesh.material.uniforms.panorama.value,panorama);
  assert.equal(fallbackDisposed,true);
  assert.equal(mesh.material.stencilRef,2);
  assert.equal(mesh.material.stencilFunc,THREE.EqualStencilFunc);
  assert.equal(panorama.wrapS,THREE.RepeatWrapping);
  assert.equal(panorama.wrapT,THREE.ClampToEdgeWrapping);
  assert.equal(panorama.minFilter,THREE.LinearFilter);
  assert.equal(panorama.magFilter,THREE.LinearFilter);
  assert.equal(panorama.generateMipmaps,false);
  assert.equal(panorama.anisotropy,1);
  mesh.geometry.dispose();mesh.material.dispose();panorama.dispose();
});

test('unavailable photographic hell sky retains an opaque fallback without rejecting readiness',async t=>{
  t.mock.method(HDRLoader.prototype,'loadAsync',async()=>{throw new Error('Offline');});
  const {mesh,ready}=createHellSky();
  const fallback=mesh.material.uniforms.panorama.value;
  let fallbackDisposed=false;
  fallback.addEventListener('dispose',()=>fallbackDisposed=true);
  applyStencilLayer(mesh,1);
  assert.equal(await ready,false);
  assert.equal(mesh.userData.skyStatus,'fallback');
  assert.equal(mesh.material.uniforms.panoramaReady.value,0);
  assert.equal(mesh.material.uniforms.panorama.value,fallback);
  assert.equal(fallbackDisposed,false);
  assert.equal(mesh.material.transparent,false);
  assert.equal(mesh.material.stencilRef,1);
  mesh.geometry.dispose();mesh.material.dispose();fallback.dispose();
});

test('downloaded Poly Haven sky matches its source hashes and fits the half-float 2K texture budget',()=>{
  const root=new URL('../public/hdri/',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('the_sky_is_on_fire-SOURCE.json',root),'utf8'));
  assert.equal(manifest.file,HELL_SKY_ASSET.split('/').at(-1));
  assert.equal(manifest.license,'CC0-1.0');
  assert.equal(manifest.source,'https://polyhaven.com/a/the_sky_is_on_fire');
  assert.equal(manifest.download,'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/the_sky_is_on_fire_2k.hdr');
  const bytes=readFileSync(new URL(manifest.file,root));
  assert.equal(bytes.length,manifest.bytes);
  assert.ok(bytes.length<8*1024*1024,'compressed sky must remain under 8 MiB');
  for(const algorithm of ['md5','sha256'])assert.equal(createHash(algorithm).update(bytes).digest('hex'),manifest[algorithm]);
  const arrayBuffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
  const decoded=new HDRLoader().parse(arrayBuffer);
  assert.equal(decoded.width,2048);assert.equal(decoded.height,1024);
  assert.equal(decoded.width,manifest.width);assert.equal(decoded.height,manifest.height);
  assert.equal(decoded.type,THREE.HalfFloatType);
  assert.ok(decoded.data instanceof Uint16Array);
  assert.equal(decoded.data.length,2048*1024*4);
  assert.equal(decoded.data.byteLength,16*1024*1024,'one half-float sky allocation without mipmaps');
  let allFinite=true,allOpaque=true,hasHDR=false;
  for(let i=0;i<decoded.data.length;i++){
    const value=decoded.data[i];
    if((value&0x7c00)===0x7c00)allFinite=false;
    if(i%4===3){if(value!==0x3c00)allOpaque=false;}
    else if(value>0x3c00&&value<0x7c00)hasHDR=true;
  }
  assert.equal(allFinite,true,'decoded HDR must not contain Infinity or NaN');
  assert.equal(allOpaque,true,'sky samples must have opaque alpha');
  assert.equal(hasHDR,true,'asset must retain scene values above SDR white');
});
