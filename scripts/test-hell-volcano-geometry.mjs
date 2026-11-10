import assert from 'node:assert/strict';
import test from 'node:test';
import { THREE } from './shadow-test-fixture.mjs';
const { buildHellVolcanoGeometry } = await import('../src/worlds/HellVolcanoGeometry.ts');

test('caldera pool shares the inner wall waterline and stays within the irregular rim', () => {
  for (const [index, [x,z,r,h]] of [[4,-46,23,19],[-43,-36,20,13],[44,-26,18,16],[-31,32,17,11],[38,30,23,15]].entries()) {
    const { cone, crater, rim, poolHeight, poolCenter } = buildHellVolcanoGeometry(x,z,r,h,index);
    const p = crater.getAttribute('position'), normals = crater.getAttribute('normal');
    const uv = crater.getAttribute('uv');
    for(let i=0;i<p.count;i++){
      assert.ok(Math.abs(uv.getX(i)-(p.getX(i)-x)/3)<1e-5,'offset caldera uses the same linear UV chart at center and rim');
      assert.ok(Math.abs(uv.getY(i)-(p.getZ(i)-z)/3)<1e-5,'pool texture does not pinch toward a displaced UV origin');
    }
    for (let i = 1; i < p.count; i++) {
      assert.ok(Math.abs(p.getY(i) - poolHeight) < 1e-5);
      assert.ok(normals.getY(i) > .999);
      assert.ok(Math.hypot(p.getX(i)-poolCenter.x,p.getZ(i)-poolCenter.z) <
        Math.hypot(rim[i-1].x-poolCenter.x,rim[i-1].z-poolCenter.z));
      const wall = cone.getAttribute('position');
      let joins = false;
      for (let j = 0; j < wall.count; j++) if (Math.abs(wall.getX(j)-p.getX(i))+Math.abs(wall.getY(j)-p.getY(i))+Math.abs(wall.getZ(j)-p.getZ(i)) < 1e-5) { joins = true; break; }
      assert.ok(joins, 'pool boundary must touch its actual rock wall');
    }
  }
});

test('overflow seats both banks on rendered cone triangles with no buried or floating strips', t => {
  const {cone, spill, poolHeight} = buildHellVolcanoGeometry(4,-46,23,19);
  assert.ok(spill);
  const material = new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const mesh = new THREE.Mesh(cone,material); mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0,-1,0);
  assert.equal(spill.userData.conforming,true,'overflow must follow individual supporting rock facets');
  const p = spill.getAttribute('position'), index = spill.getIndex();
  const lifts=spill.getAttribute('lavaLift'),joins=spill.getAttribute('flowJoin'),uv=spill.getAttribute('uv');
  assert.equal(lifts.count,p.count);assert.equal(joins.count,p.count);
  const sample = new THREE.Vector3();
  let minimumVertexGap=Infinity,maximumVertexGap=-Infinity,joinedVertices=0,poolVertices=0;
  for (let i=0;i<p.count;i++) {
    sample.fromBufferAttribute(p,i);ray.set(new THREE.Vector3(sample.x,100,sample.z),down);
    const hit=ray.intersectObject(mesh)[0]; assert.ok(hit,`vertex ${i} has supporting rock`);
    const gap=sample.y-hit.point.y;
    assert.ok(Math.abs(gap-lifts.getX(i))<1e-4,`vertex ${i} differs from its authored clearance: ${gap}`);
    if(joins.getX(i)>1-1e-6){
      joinedVertices++;
      minimumVertexGap=Math.min(minimumVertexGap,gap);maximumVertexGap=Math.max(maximumVertexGap,gap);
      assert.ok(Math.abs(gap-.045)<1e-4,`fully joined vertex ${i} has gap ${gap}`);
    }
    if(joins.getX(i)<1e-8&&uv.getY(i)<1e-8){
      poolVertices++;
      assert.ok(Math.abs(p.getY(i)-poolHeight)<1e-5,'overflow starts at the actual pool level');
    }
  }
  assert.ok(joinedVertices>100&&poolVertices>=3,'both pool join and downhill surface must be exercised');
  // All flow triangles face upward; front-side material must remain visible.
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  let minimumInteriorGap=Infinity,maximumInteriorGap=-Infinity,worst,joinedTriangles=0;
  for(let i=0;i<index.count;i+=3){
    const ia=index.getX(i),ib=index.getX(i+1),ic=index.getX(i+2);
    a.fromBufferAttribute(p,ia);b.fromBufferAttribute(p,ib);c.fromBufferAttribute(p,ic);
    sample.copy(a).add(b).add(c).multiplyScalar(1/3);
    const faceNormal=b.sub(a).cross(c.sub(a));
    assert.ok(faceNormal.y>0,`flow triangle ${i/3} faces upward after Float32 conversion`);
    ray.set(new THREE.Vector3(sample.x,100,sample.z),down);
    const hit=ray.intersectObject(mesh)[0];assert.ok(hit,`triangle ${i/3} has supporting rock`);
    const gap=sample.y-hit.point.y,expected=(lifts.getX(ia)+lifts.getX(ib)+lifts.getX(ic))/3;
    assert.ok(Math.abs(gap-expected)<1e-4,`triangle ${i/3} crosses its supporting rock plane: ${gap} versus ${expected}`);
    if([ia,ib,ic].every(vertex=>joins.getX(vertex)>1-1e-6)){
      joinedTriangles++;
      assert.ok(faceNormal.normalize().dot(hit.face.normal)>.999,`flow triangle ${i/3} retains the supporting facet normal`);
      if(gap>maximumInteriorGap){maximumInteriorGap=gap;worst={triangle:i/3,x:sample.x,z:sample.z,gap};}
      minimumInteriorGap=Math.min(minimumInteriorGap,gap);
    }
  }
  t.diagnostic(JSON.stringify({triangles:index.count/3,joinedVertices,joinedTriangles,poolVertices,
    minimumVertexGap,maximumVertexGap,minimumInteriorGap,maximumInteriorGap,worst}));
  assert.ok(joinedTriangles>100,'test covers the downhill flow beyond the crater ramp');
  assert.ok(minimumInteriorGap>0,`overflow interior penetrates rendered rock: ${minimumInteriorGap}`);
  assert.ok(maximumInteriorGap<.085,`overflow interior floats above rendered rock: ${JSON.stringify(worst)}`);
  assert.ok(Math.abs(minimumInteriorGap-.045)<1e-4&&Math.abs(maximumInteriorGap-.045)<1e-4,'full triangles retain the exact 4.5 cm clearance');
  assert.ok(index.count/3<=5000,'conforming overflow keeps its bounded geometry budget');
  material.dispose();
});

test('detailed volcanic geometry is finite, bounded and retains a displaced caldera center', () => {
  for(const [index,[x,z,r,h]] of [[4,-46,23,19],[-43,-36,20,13],[44,-26,18,16],[-31,32,17,11],[38,30,23,15]].entries()){
    const result=buildHellVolcanoGeometry(x,z,r,h,index);
    assert.ok(result.poolCenter.x<x-r*.05,'summit is offset from the foot instead of concentric');
    assert.ok(result.poolCenter.z>z,'caldera keeps a longitudinal offset');
    for(const [label,geometry] of [['cone',result.cone],['crater',result.crater],['spill',result.spill]].filter(([,geometry])=>geometry)){
      for(const attribute of Object.values(geometry.attributes))for(const value of attribute.array)assert.ok(Number.isFinite(value));
      for(const vertex of geometry.index.array)assert.ok(vertex<geometry.attributes.position.count);
      assert.ok(Number.isFinite(geometry.boundingSphere.radius)&&geometry.boundingSphere.radius>0);
      const normals=geometry.attributes.normal;
      for(let i=0;i<normals.count;i++)assert.ok(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)<1e-5,
        `${label} ${index}, vertex ${i} has a finite unit normal`);
      assert.equal(new Set(geometry.index.array).size,geometry.attributes.position.count,`${label} ${index} does not allocate unused vertices`);
    }
    const triangles=result.cone.index.count/3;
    assert.ok(triangles<=(index===0?15000:4300),`cone${index} has ${triangles} triangles`);
    assert.equal(Boolean(result.outlet),index===0);
    if(index)assert.equal(result.spill,null,'distant volcano does not allocate an unseen overflow');
  }
});

test('rendered apron seats on the basin and overflow joins the intended river head', () => {
  const ground=(x,z)=>.035*x-.02*z+.08*Math.sin(x*.2+z*.3);
  const {cone,spill,outlet}=buildHellVolcanoGeometry(4,-46,23,19,0,true,ground);
  assert.ok(outlet&&spill);
  assert.ok(Math.abs(outlet.x-4)<1e-8&&Math.abs(outlet.z+22.6)<1e-8,'outlet aligns with authored river head');
  assert.ok(Math.abs(outlet.y-ground(4,-22.6)-.17)<1e-8,'outlet matches basin lava height');
  const p=cone.attributes.position,sectors=128;
  let buriedToeSamples=0;
  for(let i=0;i<=sectors;i++){
    const a=i/sectors*Math.PI*2,delta=Math.abs(Math.atan2(Math.sin(a-Math.PI/2),Math.cos(a-Math.PI/2)));
    if(delta<.33)continue;
    assert.ok(p.getY(i)<ground(p.getX(i),p.getZ(i))-.10,'ordinary toe does not float above basin');
    buriedToeSamples++;
  }
  assert.ok(buriedToeSamples>100);
  const end=spill.attributes.position;
  let center=0,nearest=Infinity;
  for(let i=0;i<end.count;i++){
    const distance=Math.hypot(end.getX(i)-outlet.x,end.getZ(i)-outlet.z);
    if(distance<nearest){nearest=distance;center=i;}
  }
  assert.ok(Math.hypot(end.getX(center)-outlet.x,end.getZ(center)-outlet.z)<.08,'small apron inset still overlaps the river head');
  assert.ok(Math.abs(end.getY(center)-outlet.y)<.08,'final supported triangle remains near the river level');
});

test('hero cliff anchors sit on actual rock with finite upward orientations', () => {
  const {cone,outcrops}=buildHellVolcanoGeometry(4,-46,23,19);
  assert.equal(outcrops.length,8);
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(cone,material);mesh.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
  for(const anchor of outcrops){
    const {position,normal,height,yaw}=anchor;
    assert.ok([position.x,position.y,position.z,normal.x,normal.y,normal.z,height,yaw].every(Number.isFinite));
    assert.ok(normal.y>0&&Math.abs(normal.length()-1)<1e-8,'rock seating direction points out of the slope');
    assert.ok(height>0&&height<4,'outcrop scale stays bounded');
    ray.set(new THREE.Vector3(position.x,100,position.z),down);
    const hit=ray.intersectObject(mesh)[0];assert.ok(hit);
    assert.ok(Math.abs(position.y-hit.point.y)<1e-5,'cliff anchor sits on rendered rock, not analytical approximation');
  }
  assert.equal(buildHellVolcanoGeometry(-43,-36,20,13,1).outcrops.length,0,'distant silhouettes do not allocate unseen cliff anchors');
  material.dispose();
});

test('natural mountain retains localized rock faces, sheltered cavities and ridges without a slab-dominated mass', t => {
  const {cone,poolHeight}=buildHellVolcanoGeometry(4,-46,23,19);
  const p=cone.attributes.position,n=cone.attributes.normal,cavity=cone.attributes.mountainCavity,index=cone.index;
  assert.equal(cavity.count,p.count,'normal splits must retain their cavity attribute');
  const positions=new Map();let minimumCavity=Infinity,maximumCavity=-Infinity,creasedPositions=0;
  for(let i=0;i<p.count;i++){
    const value=cavity.getX(i);assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
    minimumCavity=Math.min(minimumCavity,value);maximumCavity=Math.max(maximumCavity,value);
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(value=>value.toFixed(4)).join(':');
    if(!positions.has(key))positions.set(key,[]);
    positions.get(key).push(new THREE.Vector3(n.getX(i),n.getY(i),n.getZ(i)));
  }
  assert.ok(minimumCavity<.05&&maximumCavity>.35,'cavity shading distinguishes sheltered fractures from exposed rock');
  for(const normals of positions.values())if(normals.length>1&&normals.some(a=>normals.some(b=>a.dot(b)<.94)))creasedPositions++;
  assert.ok(creasedPositions>50,'coincident ridge vertices retain distinct face normals instead of smoothing every rock edge');
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  let area=0,steepArea=0;
  for(let i=0;i<index.count;i+=3){
    a.fromBufferAttribute(p,index.getX(i));b.fromBufferAttribute(p,index.getX(i+1));c.fromBufferAttribute(p,index.getX(i+2));
    const y=(a.y+b.y+c.y)/3,z=(a.z+b.z+c.z)/3;
    // Inspect visible outer rock, excluding the buried toe and inner caldera wall.
    if(y<2||y>poolHeight-1||z<-46)continue;
    const normal=b.sub(a).cross(c.sub(a)),faceArea=normal.length()*.5;
    area+=faceArea;if(normal.normalize().y<.4)steepArea+=faceArea;
  }
  const steepFraction=steepArea/area;
  // Localized cliffs remain, but mostly vertical faces must not dominate the
  // curved mountain body. The previous cliff-coverage target encouraged slabs.
  assert.ok(area>100&&steepFraction>.03&&steepFraction<.35,
    `localized cliffs coexist with predominantly inclined eroded shoulders: ${steepFraction}`);
  const vertexBytes=Object.values(cone.attributes).reduce((sum,attribute)=>sum+attribute.array.byteLength,0);
  t.diagnostic(JSON.stringify({vertices:p.count,triangles:index.count/3,creasedPositions,minimumCavity,maximumCavity,
    steepFraction,vertexBytes,indexBytes:index.array.byteLength,scope:'Structural geometry checks; visual review remains separate.'}));
});
