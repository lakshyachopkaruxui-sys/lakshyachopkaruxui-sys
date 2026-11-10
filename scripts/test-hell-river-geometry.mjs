import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './shadow-test-fixture.mjs';
const { buildHellRiverGeometry, sampleHellRiverPath } = await import('../src/worlds/HellRiverGeometry.ts');
const { HELL_RIVERS, hellGroundOffset, riverDistance } = await import('../src/worlds/HellLandscape.ts');
const { IslandSurface } = await import('../src/worlds/WorldThree.ts');

test('rounded channel corners preserve actual endpoints and remain inside existing collision corridors', () => {
  for (const river of HELL_RIVERS) {
    const samples=sampleHellRiverPath(river);
    assert.deepEqual(samples[0].toArray(),river.points[0]);
    assert.deepEqual(samples.at(-1).toArray(),river.points.at(-1));
    let maxAngle=0;
    for(let index=1;index<samples.length-1;index++){
      const before=samples[index].clone().sub(samples[index-1]).normalize();
      const after=samples[index+1].clone().sub(samples[index]).normalize();
      maxAngle=Math.max(maxAngle,Math.acos(THREE.MathUtils.clamp(before.dot(after),-1,1)));
    }
    assert.ok(maxAngle<.55,`curve avoids sharp authored joints: ${maxAngle}`);
  }
  const geometry=buildHellRiverGeometry(HELL_RIVERS,()=>0),p=geometry.attributes.position;
  for(let index=0;index<p.count;index++)assert.ok(riverDistance(p.getX(index),p.getZ(index))<.78,
    `visible bank vertex ${index} stays inside existing lava collision capsules`);
});

test('rounded lava rests above the actual triangulated trench, without degenerate or unused geometry', () => {
  const terrain=new IslandSurface(56,8,2.1,96,160,hellGroundOffset);
  const geometry=buildHellRiverGeometry(HELL_RIVERS,(x,z)=>terrain.heightAt(x,z));
  const p=geometry.attributes.position,uv=geometry.attributes.uv,index=geometry.index;
  assert.ok(index.count/3<2100,'all rivers share a bounded static geometry budget');
  assert.equal(new Set(index.array).size,p.count);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),center=new THREE.Vector3();
  for(let vertex=0;vertex<p.count;vertex++){
    const gap=p.getY(vertex)-terrain.heightAt(p.getX(vertex),p.getZ(vertex));
    assert.ok(gap>.015&&gap<.5,`lava ${vertex} retains positive depth inside the half-metre trench: ${gap}`);
    assert.ok(Number.isFinite(uv.getY(vertex)));
    assert.ok(geometry.attributes.normal.getY(vertex)>.85,'banks remain a gently curved liquid surface');
  }
  for(let triangle=0;triangle<index.count;triangle+=3){
    a.fromBufferAttribute(p,index.getX(triangle));b.fromBufferAttribute(p,index.getX(triangle+1));c.fromBufferAttribute(p,index.getX(triangle+2));
    center.copy(a).add(b).add(c).divideScalar(3);
    assert.ok(b.sub(a).cross(c.sub(a)).y>1e-7,'channel triangles face upward');
    assert.ok(center.y>terrain.heightAt(center.x,center.z)+.015,'channel interior does not intersect the trench');
  }
  assert.deepEqual(buildHellRiverGeometry(HELL_RIVERS,()=>0).attributes.position.array,
    buildHellRiverGeometry(HELL_RIVERS,()=>0).attributes.position.array,'bank variation is deterministic');
  terrain.geometry.dispose();geometry.dispose();
});
