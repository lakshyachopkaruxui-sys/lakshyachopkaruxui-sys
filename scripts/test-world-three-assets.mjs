import assert from 'node:assert/strict';import test from 'node:test';
import{THREE,preload,mockAssets,actualAsset}from'./shadow-test-fixture.mjs';
import{HDRLoader}from'three/addons/loaders/HDRLoader.js';
const{WorldThree}=await import('../src/worlds/WorldThree.ts');await preload();
test('complete hell scene loads volcanic materials and original creator rigs with portal stencil',async t=>{
 mockAssets(t);t.mock.method(THREE.TextureLoader.prototype,'load',(_u,l)=>{const texture=new THREE.Texture();queueMicrotask(()=>l?.(texture));return texture;});t.mock.method(HDRLoader.prototype,'load',(_u,l)=>{const texture=new THREE.Texture();queueMicrotask(()=>l(texture));return texture;});
 const world=new WorldThree(new THREE.Vector3());await world.ready;assert.equal(world.skyStatus,'ready');assert.equal(world.landscape.status,'ready');assert.equal(world.fauna.status,'ready');assert.equal(world.islands.length,1);assert.ok(world.islands[0].terrain.radius>50);assert.ok(world.collisions.size>=18);
 assert.ok(world.root.getObjectByName('Crimson ash sky'));assert.equal(world.root.getObjectByName('photographic misty woodland sky'),undefined);assert.equal(world.watcher,undefined);assert.equal(world.canopy,undefined);assert.equal(world.jellies,undefined);
 world.stencilLayer=0;world.refreshStencil();world.root.traverse(node=>{if(!node.isMesh)return;for(const m of Array.isArray(node.material)?node.material:[node.material])assert.equal(m.stencilRef,0);});
 const anchor=new THREE.Group();anchor.position.set(12,.2,-4);anchor.rotation.y=1.1;world.alignTo(anchor);assert.ok(Math.abs(world.groundAt(12,-4)-.035)<1e-6);
});
