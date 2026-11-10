import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './shadow-test-fixture.mjs';
const { createHellMountainProfile } = await import('../src/worlds/HellMountainProfile.ts');
const { hellLavaRouteAngle } = await import('../src/worlds/HellLavaRoute.ts');

test('continuous eroded mountain retains its caldera, exact toe and terrain-seated apron', () => {
  const floor=(x,z)=>.035*x-.02*z+.08*Math.sin(x*.2+z*.3);
  const mountain=createHellMountainProfile(4,-46,23,19,0,true,floor,hellLavaRouteAngle);
  assert.deepEqual(mountain.poolCenter.toArray(),[4-23*.115,16.8,-46+23*.045]);
  const toe=mountain.profile(0,Math.PI/2);
  assert.ok(Math.abs(toe.x-4)<1e-8&&Math.abs(toe.z+22.6)<1e-8);
  assert.ok(Math.abs(toe.y-floor(4,-22.6)-.125)<1e-8);
  for(let step=0;step<=128;step++){
    const a=step/128*Math.PI*2;
    if(Math.abs(Math.atan2(Math.sin(a-Math.PI/2),Math.cos(a-Math.PI/2)))<.33)continue;
    const p=mountain.profile(0,a);
    assert.ok(Math.abs(p.y-floor(p.x,p.z)+.12)<1e-8,'ordinary toes stay buried in actual terrain');
  }
  const crest=mountain.profile(1,hellLavaRouteAngle(1));
  assert.ok(Math.abs(crest.y-mountain.poolHeight+.055)<1e-8,'gully drains the actual pool without a high lip');
  assert.ok(mountain.profile(1,Math.PI/2+.25).y>mountain.poolHeight+.3,
    'the notch narrows at the crater lip, retaining rock beside the actual overflow');
});

test('winding channel bed is monotone while terrain remains deterministic, finite and radially ordered', () => {
  const mountain=createHellMountainProfile(4,-46,23,19,0,true,()=>0,hellLavaRouteAngle);
  let previous=-Infinity;
  for(let step=0;step<=200;step++){
    const t=step/200,p=mountain.profile(t,hellLavaRouteAngle(t));
    assert.ok(p.y>=previous-1e-8,`channel would rise downhill at t=${t}`);
    previous=p.y;
  }
  for(let angle=0;angle<72;angle++){
    const a=angle/72*Math.PI*2;
    let previousRadius=Infinity;
    for(let step=0;step<=56;step++){
      const t=step/56,p=mountain.profile(t,a),offset=t**1.35;
      const r=Math.hypot(p.x-(4-23*.115*offset),p.z-(-46+23*.045*offset));
      assert.ok(r<previousRadius+1e-7,'nested rings do not fold into a second top surface');
      assert.ok([...p].every(Number.isFinite)&&p.y>=-.6&&p.y<21.5);
      const cavity=mountain.cavityAt(t,a);assert.ok(Number.isFinite(cavity)&&cavity>=0&&cavity<=1);
      assert.ok(p.distanceTo(mountain.profile(t,a+Math.PI*2))<1e-10,'angular seam stays continuous');
      previousRadius=r;
    }
  }
});

test('mountain shoulders curve through their full height instead of repeating planar slab bands', () => {
  const mountain=createHellMountainProfile(4,-46,23,19,0,false);
  let curved=0,total=0;
  const second=new THREE.Vector3();
  for(let angle=0;angle<32;angle++)for(let step=7;step<49;step++){
    const a=angle/32*Math.PI*2,t=step/56;
    const before=mountain.profile(t-1/56,a),center=mountain.profile(t,a),after=mountain.profile(t+1/56,a);
    second.copy(before).add(after).addScaledVector(center,-2);
    if(second.length()>.002)curved++;
    total++;
  }
  assert.ok(curved/total>.80,'large straight slabs cannot dominate the mountain profile');
  const first=createHellMountainProfile(4,-46,23,19,0,false);
  const distant=createHellMountainProfile(4,-46,23,19,2,false);
  assert.ok(first.profile(.5,1.8).distanceTo(distant.profile(.5,1.8))>.5,'different mountains do not reuse one copied silhouette');
});

test('a winding route has level physical normal cross-sections instead of radial sidewalls', () => {
  const mountain=createHellMountainProfile(4,-46,23,19,0,true,()=>0,hellLavaRouteAngle);
  // Solve only the existing star-shaped XZ chart. The surface height must come
  // from the public profile, independently of its channel-distance diagnostic.
  const surfaceAt=(x,z,startT,startAngle)=>{
    let t=startT,a=startAngle;
    for(let iteration=0;iteration<12;iteration++){
      const p=mountain.profile(t,a),ex=p.x-x,ez=p.z-z;
      if(Math.hypot(ex,ez)<1e-9)return p;
      const epsilon=1e-5;
      const beforeT=mountain.profile(t-epsilon,a),afterT=mountain.profile(t+epsilon,a);
      const beforeA=mountain.profile(t,a-epsilon),afterA=mountain.profile(t,a+epsilon);
      const tx=(afterT.x-beforeT.x)/(2*epsilon),tz=(afterT.z-beforeT.z)/(2*epsilon);
      const ax=(afterA.x-beforeA.x)/(2*epsilon),az=(afterA.z-beforeA.z)/(2*epsilon);
      const determinant=tx*az-tz*ax;
      assert.ok(Math.abs(determinant)>1e-6,'radial chart has an invertible local footprint');
      t=THREE.MathUtils.clamp(t-(ex*az-ez*ax)/determinant,0,1);
      a-=(tx*ez-tz*ex)/determinant;
    }
    const p=mountain.profile(t,a);
    assert.ok(Math.hypot(p.x-x,p.z-z)<1e-6,'physical normal sample lies on requested XZ');
    return p;
  };
  for(const index of [20,38,55,72]){
    const t0=index/96,t1=(index+1)/96,t=(t0+t1)/2;
    const a=mountain.profile(t0,hellLavaRouteAngle(t0)),b=mountain.profile(t1,hellLavaRouteAngle(t1));
    const center=a.clone().add(b).multiplyScalar(.5),length=Math.hypot(b.x-a.x,b.z-a.z);
    const nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
    const bed=mountain.channelAt(center.x,center.z).bedHeight;
    for(const offset of [-1.35,-.9,-.4,0,.4,.9,1.35]){
      const p=surfaceAt(center.x+nx*offset,center.z+nz*offset,t,hellLavaRouteAngle(t));
      const query=mountain.channelAt(p.x,p.z);
      assert.ok(query.distance<1.55,'sample stays inside the complete channel bed');
      assert.ok(Math.abs(p.y-bed)<.005,`offset ${offset} at route section ${index} creates a rising sidewall: ${p.y-bed}`);
    }
  }
  const first=mountain.profile(.5,1.8);first.y=999;first.x=-999;
  assert.ok(mountain.profile(.5,1.8).x!==-999&&mountain.profile(.5,1.8).y!==999,
    'sample cache never exposes a mutable Vector3 shared by callers');
});
