import assert from 'node:assert/strict';
import test from 'node:test';
import './shadow-test-fixture.mjs';
const { hellLavaRouteAngle, hellLavaRouteWidth, HELL_LAVA_WIDTH_CONTROL_POINTS } = await import('../src/worlds/HellLavaRoute.ts');
const { createHellMountainProfile } = await import('../src/worlds/HellMountainProfile.ts');

test('actual route has two broad opposing bends with visible cross-flank travel and fixed physical joins', t => {
  assert.equal(hellLavaRouteAngle(0),Math.PI/2);
  assert.equal(hellLavaRouteAngle(1),Math.PI/2);
  const {profile}=createHellMountainProfile(4,-46,23,19,0,true,undefined,hellLavaRouteAngle);
  const points=[],deltas=[];
  for(let sample=0;sample<=42;sample++){
    const f=sample/42,angle=hellLavaRouteAngle(f);
    points.push(profile(f,angle));deltas.push(angle-Math.PI/2);
    assert.ok(Number.isFinite(angle));
  }
  const lateralSpan=Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
  assert.ok(lateralSpan>5.9&&lateralSpan<6.5,`visible route spans ${lateralSpan} m on the actual flank`);
  assert.ok(Math.max(...deltas)>.2&&Math.min(...deltas)<-.1,'both broad bends remain visible');
  let minimumTurnRadius=Infinity;
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1];
    const ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z),ac=Math.hypot(c.x-a.x,c.z-a.z);
    const cross=Math.abs((b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x));
    minimumTurnRadius=Math.min(minimumTurnRadius,ab*bc*ac/(2*cross));
  }
  assert.ok(minimumTurnRadius>1.7,`bends retain broad banks: turn radius ${minimumTurnRadius} m`);
  let turns=0,last=0;
  for(let sample=1;sample<deltas.length;sample++){
    const step=Math.sign(deltas[sample]-deltas[sample-1]);
    if(step&&last&&step!==last)turns++;
    if(step)last=step;
  }
  assert.equal(turns,2,'route contains two unequal broad bends, not a repeating zigzag');
  t.diagnostic(JSON.stringify({actualLateralSpanMetres:lateralSpan,minimumTurnRadius,
    toe:points[0].toArray(),top:points.at(-1).toArray(),angularExtrema:[Math.min(...deltas),Math.max(...deltas)]}));
});

test('route and bank width remain continuous at controls without overshoot or sharp joins', () => {
  for(const [points,sample,value] of [[HELL_LAVA_WIDTH_CONTROL_POINTS,hellLavaRouteWidth,point=>point.halfWidth]]){
    for(let index=0;index<points.length-1;index++){
      const a=points[index],b=points[index+1],low=Math.min(value(a),value(b)),high=Math.max(value(a),value(b));
      assert.ok(Math.abs(sample(a.t)-value(a))<1e-12);
      for(let j=0;j<=100;j++){
        const f=a.t+(b.t-a.t)*j/100,result=sample(f);
        assert.ok(result>=low-1e-12&&result<=high+1e-12,'shape-preserving interpolation does not add hidden lobes');
      }
    }
    const epsilon=1e-6;
    for(const point of points.slice(1,-1)){
      const left=(sample(point.t)-sample(point.t-epsilon))/epsilon;
      const right=(sample(point.t+epsilon)-sample(point.t))/epsilon;
      assert.ok(Math.abs(left-right)<.001,'neighboring segments share a tangent');
    }
    assert.ok(Math.abs((sample(epsilon)-sample(0))/epsilon)<.001,'toe joins without an angular kink');
    assert.ok(Math.abs((sample(1)-sample(1-epsilon))/epsilon)<.001,'caldera joins without an angular kink');
  }
  const widths=Array.from({length:1001},(_,index)=>hellLavaRouteWidth(index/1000));
  assert.ok(Math.min(...widths)>=.439999&&Math.max(...widths)<=1.420001);
  assert.ok(Math.max(...widths)-Math.min(...widths)>.9,'constrictions and broader lobes are substantial');
  assert.equal(hellLavaRouteWidth(0),.76);assert.equal(hellLavaRouteWidth(1),.44);
  const epsilon=1e-7;
  assert.ok(Math.abs((hellLavaRouteAngle(epsilon)-hellLavaRouteAngle(0))/epsilon)<.003,'toe angle eases into the basin');
  assert.ok(Math.abs((hellLavaRouteAngle(1)-hellLavaRouteAngle(1-epsilon))/epsilon)<.003,'caldera angle eases out of the notch');
});

test('route clamps endpoint derivative probes and has no random or runtime state', () => {
  for(const t of [-.001,0,.18,.37,.69,.87,1,1.001]){
    assert.equal(hellLavaRouteAngle(t),hellLavaRouteAngle(t));
    assert.equal(hellLavaRouteWidth(t),hellLavaRouteWidth(t));
  }
  assert.equal(hellLavaRouteAngle(-.001),hellLavaRouteAngle(0));
  assert.equal(hellLavaRouteAngle(1.001),hellLavaRouteAngle(1));
  assert.throws(()=>hellLavaRouteAngle(NaN),/route parameter/);
});
