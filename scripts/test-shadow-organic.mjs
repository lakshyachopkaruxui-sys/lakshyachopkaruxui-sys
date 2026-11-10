import assert from 'node:assert/strict';import test from 'node:test';
import{THREE,preload,mockAssets}from'./shadow-test-fixture.mjs';
const{ShadowOrganic}=await import('../src/worlds/ShadowOrganic.ts');const{WorldCollisions}=await import('../src/worlds/WorldCollisions.ts');
await preload();
test('actual bare fir branches stay above the clearing and ground footprints match instanced trunks',async t=>{
 mockAssets(t);const parent=new THREE.Group(),collisions=new WorldCollisions(parent);let layer=0;const grove=new ShadowOrganic(parent,()=>0,()=>layer,collisions);layer=1;await grove.ready;parent.updateMatrixWorld(true);
 assert.equal(grove.trunks.length,36);assert.equal(collisions.size,42);assert.equal(collisions.queryLocal(0,0,3),false);
 let triangles=0,instances=0;const variantTriangles={a:0,b:0,c:0};grove.root.traverse(mesh=>{if(!mesh.isMesh)return;triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*(mesh.count??1);if(mesh.isInstancedMesh){instances++;const variant=mesh.name.match(/^scanned bare fir ([abc]) /)?.[1];assert.ok(variant);variantTriangles[variant]+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3*mesh.count;}
 assert.ok(mesh.geometry.attributes.uv?.count>0, 'creator PBR surfaces require exported UVs');
 const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];mats.forEach(m=>assert.equal(m.stencilRef,1));});
 assert.equal(instances,9);
 // Approved A/B scan detail: twelve copies each of 17,869/17,221/6,675 triangles.
 // This is an asset-growth regression limit, not a Quest frame-rate budget.
 assert.deepEqual(variantTriangles,{a:214428,b:206652,c:80100});
 assert.equal(triangles-Object.values(variantTriangles).reduce((sum,n)=>sum+n,0),104343,'retained stump and branch scan geometry');
 assert.equal(triangles,605523,'36 fir instances plus unchanged scanned deadwood');
 assert.ok(triangles<=610000,'documented shadow wood geometry ceiling');for(const trunk of grove.trunks){assert.ok(trunk.radius>.1&&trunk.radius<1.9,`trunk radius ${trunk.radius}`);assert.ok(collisions.queryLocal(trunk.x,trunk.z,.05));}
 console.log(JSON.stringify({woodlandTriangles:triangles,largestTrunkRadius:Math.max(...grove.trunks.map(t=>t.radius))}));
});
test('failed tree load never adds invisible woodland colliders',async t=>{
 const{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');t.mock.method(GLTFLoader.prototype,'load',(_u,_l,_p,e)=>queueMicrotask(()=>e(new Error('offline'))));
 const parent=new THREE.Group(),collisions=new WorldCollisions(parent),grove=new ShadowOrganic(parent,()=>0,()=>1,collisions);await assert.rejects(grove.ready,/offline/);assert.equal(collisions.size,0);assert.equal(parent.children.length,0);
});
