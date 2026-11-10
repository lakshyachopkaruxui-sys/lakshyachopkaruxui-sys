import assert from 'node:assert/strict';
import test from 'node:test';
import {THREE,faunaFixture,actualAsset,paths} from './shadow-test-fixture.mjs';

test('actual CC0 creator model has unique skeletal track targets and authored locomotion',async t=>{
 const gltf=await actualAsset(paths[4]),bones=[];let tris=0;
 gltf.scene.traverse(n=>{if(n.isBone)bones.push(n.name);if(n.isMesh)tris+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});
 assert.equal(new Set(bones).size,bones.length);assert.equal(bones.length,58);assert.equal(tris,3584);
 for(const name of ['Idle','Walk','Run']){const clip=THREE.AnimationClip.findByName(gltf.animations,name);assert.ok(clip?.tracks.length>100);for(const track of clip.tracks)assert.ok(gltf.scene.getObjectByName(track.name.split('.')[0]),track.name);}
 const{fauna}=await faunaFixture(t);assert.equal(fauna.status,'ready');assert.equal(fauna.animals.length,2);
 assert.notEqual(fauna.animals[0].head,fauna.animals[1].head);
 for(const a of fauna.animals){assert.ok(a.head);assert.ok(a.height>2&&a.height<2.5);a.model.traverse(n=>{if(n.isMesh)assert.equal(n.material.stencilRef,1)});}
});
test('creator walk animates limbs and actually moves; inactive and invalid input freeze both',async t=>{
 const{fauna,viewer}=await faunaFixture(t),a=fauna.animals[0],start=a.root.position.clone();
 const bones=[];a.model.traverse(n=>{if(n.isBone)bones.push(n)});const pose=bones.map(n=>n.quaternion.clone());
 for(let i=0;i<160;i++)fauna.update(viewer,true,.05);
 assert.ok(a.distance>2);assert.ok(a.root.position.distanceTo(start)>.5);
 assert.ok(bones.some((n,i)=>n.quaternion.angleTo(pose[i])>.1));
 assert.ok(Math.abs(a.head.quaternion.length()-1)<1e-6);assert.equal(a.model.scale.x,a.scale);
 const position=a.root.position.toArray(),clock=a.mixer.time;
 for(const dt of [0,-1,NaN,Infinity])fauna.update(viewer,true,dt);fauna.update(viewer,false,1);
 assert.deepEqual(a.root.position.toArray(),position);assert.equal(a.mixer.time,clock);
});
test('viewer personal space stops locomotion without hiding or teleporting actor',async t=>{
 const{fauna}=await faunaFixture(t),a=fauna.animals[0],viewer=a.root.position.clone().add(new THREE.Vector3(0,1.6,2.7)),start=a.root.position.clone();
 for(let i=0;i<100;i++)fauna.update(viewer,true,.05);
 assert.ok(a.root.position.distanceTo(start)<1e-8);assert.equal(a.root.visible,true);assert.equal(a.moving,false);
});

test('redistributed creature files match their source manifest hashes and CC0 record', async()=>{
 const{readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');
 const folder=new URL('../public/models/shadow/horror-humanoid/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('SOURCE-MANIFEST.json',folder)));
 assert.equal(manifest.license,'CC0-1.0');assert.match(manifest.source,/opengameart\.org\/content\/3d-horror-game-monster$/);
 for(const file of manifest.files){const bytes=readFileSync(new URL(file.file,folder));assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
});
