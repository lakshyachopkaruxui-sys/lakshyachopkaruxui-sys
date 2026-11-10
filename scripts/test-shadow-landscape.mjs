import assert from 'node:assert/strict';import test from 'node:test';
import{THREE,preload,mockAssets,actualAsset,paths}from'./shadow-test-fixture.mjs';
const{ShadowLandscape}=await import('../src/worlds/ShadowLandscape.ts');const{WorldCollisions}=await import('../src/worlds/WorldCollisions.ts');await preload();
test('real photographic boulders share buffers, contact ground and block passage',async t=>{
 mockAssets(t);const parent=new THREE.Group(),collisions=new WorldCollisions(parent);const scene=new ShadowLandscape(parent,()=>0,()=>1,collisions);await scene.ready;assert.equal(scene.status,'ready');parent.updateMatrixWorld(true);
 const rocks=scene.root.children.filter(n=>n.name.startsWith('scanned woodland boulder'));assert.equal(rocks.length,5);const geometries=new Set();let triangles=0;
 for(const rock of rocks){const box=new THREE.Box3().setFromObject(rock);assert.ok(Math.abs(box.min.y+.10)<.001);assert.ok(box.distanceToPoint(new THREE.Vector3(0,1.6,0))>3);assert.ok(collisions.queryLocal(rock.position.x,rock.position.z,.1));rock.traverse(n=>{if(n.isMesh){assert.ok(n.geometry.attributes.uv?.count>0);geometries.add(n.geometry);triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;}});}
 assert.equal(geometries.size,1);assert.ok(triangles<150000);assert.equal(collisions.size,47);
});
test('unavailable downloaded landscape reports failure without phantom physical props',async t=>{
 const{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');t.mock.method(GLTFLoader.prototype,'load',(_u,_l,_p,e)=>queueMicrotask(()=>e(new Error('offline'))));const parent=new THREE.Group(),collisions=new WorldCollisions(parent),scene=new ShadowLandscape(parent,()=>0,()=>1,collisions);await scene.ready;assert.equal(scene.status,'fallback');assert.equal(collisions.size,0);
});

test('decimated boulder remains connected across UV seams instead of shredded triangle islands',async()=>{
 const asset=await actualAsset(paths[3]);let components=0,triangles=0;
 asset.scene.traverse(mesh=>{if(!mesh.isMesh)return;const p=mesh.geometry.attributes.position,index=mesh.geometry.index,keys=new Map(),vertices=[],parent=[];
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e5)).join(',');if(!keys.has(key)){keys.set(key,parent.length);parent.push(parent.length);}vertices.push(keys.get(key));}
  for(let i=0;i<index.count;i+=3){parent[find(vertices[index.getX(i)])]=find(vertices[index.getX(i+1)]);parent[find(vertices[index.getX(i+1)])]=find(vertices[index.getX(i+2)]);}
  components+=new Set(parent.map((_,i)=>find(i))).size;triangles+=index.count/3;
 });
 assert.equal(components,1,'decimation must preserve the single joined source boulder');assert.equal(triangles,23142);
 const{readFileSync}=await import('node:fs'),{createHash}=await import('node:crypto');const folder=new URL('../public/models/shadow/boulder_01/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('SOURCE-MANIFEST.json',folder)));const bytes=readFileSync(new URL(manifest.runtime.file,folder));assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.runtime.sha256);
});
