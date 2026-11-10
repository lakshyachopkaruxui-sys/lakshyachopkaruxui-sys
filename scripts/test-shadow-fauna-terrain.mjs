import assert from 'node:assert/strict';import test from 'node:test';
import{THREE,faunaFixture}from'./shadow-test-fixture.mjs';
const{IslandSurface}=await import('../src/worlds/WorldThree.ts');
test('animated foot support follows exact rendered terrain throughout a walking route',async t=>{
 const terrain=new IslandSurface(56,8,2.1,96,160),{fauna,parent,viewer}=await faunaFixture(t,(x,z)=>terrain.heightAt(x,z));
 let worst=0;
 for(let frame=0;frame<400;frame++){
  fauna.update(viewer,true,.05);if(frame%10)continue;parent.updateMatrixWorld(true);
  for(const a of fauna.animals){assert.ok(Math.abs(a.root.position.y-terrain.heightAt(a.root.position.x,a.root.position.z))<1e-8);
   let minimum=Infinity;a.model.traverse(mesh=>{if(!mesh.isSkinnedMesh)return;for(let i=0;i<mesh.geometry.attributes.position.count;i++){const p=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);minimum=Math.min(minimum,p.y-terrain.heightAt(p.x,p.z));}});
   worst=Math.max(worst,Math.abs(minimum));assert.ok(Math.abs(minimum)<.025,`support gap ${minimum.toFixed(3)}m`);
  }
 }
 console.log(JSON.stringify({maximumSampledSupportGapMetres:worst}));
});
