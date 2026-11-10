// The former teleporting watcher is replaced by grounded, continuously moving creator rigs.
import assert from 'node:assert/strict';import test from 'node:test';
import{THREE,faunaFixture}from'./shadow-test-fixture.mjs';
test('actor sweeps collide with obstacles and keep dynamic collision footprints synchronized',async t=>{
 const{fauna,collisions,viewer}=await faunaFixture(t),a=fauna.animals[0];
 const start=a.root.position.clone(),target=a.route[1],middle=start.clone().lerp(target,.5);
 collisions.addCircle({id:'test-stone',x:middle.x,z:middle.z,radius:.8});
 let maxStep=0;
 for(let i=0;i<500;i++){const previous=a.root.position.clone();fauna.update(viewer,true,.05);maxStep=Math.max(maxStep,a.root.position.distanceTo(previous));assert.ok(!collisions.queryLocal(a.root.position.x,a.root.position.z,.59,a.height,a.root.position.y,a.ignore));assert.ok(collisions.queryLocal(a.root.position.x,a.root.position.z,.1));}
 assert.ok(maxStep<.027);assert.ok(a.distance>3);assert.equal(collisions.size,3);
});
test('world translation/yaw preserve route and head tracking without mutating viewer',async t=>{
 const plain=await faunaFixture(t),moved=await faunaFixture(t);moved.parent.position.set(30,.4,-17);moved.parent.rotation.y=.82;moved.parent.updateMatrixWorld(true);
 const viewer=moved.parent.localToWorld(plain.viewer.clone()),original=viewer.clone();
 for(let i=0;i<300;i++){plain.fauna.update(plain.viewer,true,.05);moved.fauna.update(viewer,true,.05);}
 assert.deepEqual(viewer.toArray(),original.toArray());
 plain.fauna.animals.forEach((a,i)=>{const b=moved.fauna.animals[i];assert.ok(a.root.position.distanceTo(b.root.position)<1e-7);assert.ok(Math.abs(a.yaw-b.yaw)<1e-6);assert.ok(a.head.quaternion.angleTo(b.head.quaternion)<1e-6);});
 assert.equal(plain.fauna.consumeReturnHint(),true);assert.equal(plain.fauna.consumeReturnHint(),false);
});
