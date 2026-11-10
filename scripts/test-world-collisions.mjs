import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  }
});
const { WorldCollisions } = await import('../src/worlds/WorldCollisions.ts');
const { DesktopControls } = await import('../src/interaction/DesktopControls.ts');
const { CONFIG } = await import('../src/config/config.ts');
const v = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const body = { radius: .28, height: 1.7 };
const near = (actual, expected, tolerance = .0002) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
const fixture = () => new WorldCollisions(new THREE.Group());

test('continuous movement stops before a thin trunk even across a 100 metre frame', () => {
  const world = fixture(); world.addCircle({ id: 'trunk', x: 0, z: 0, radius: .16 });
  const out = world.moveLocal(v(0, 50), v(0, -50), body);
  near(out.z, .4401); near(out.x, 0);
  assert.equal(world.queryLocal(out.x, out.z, body.radius), false);
});

test('diagonal contact slides along a trunk instead of freezing tangential motion', () => {
  const world = fixture(); world.addCircle({ id: 'trunk', x: 0, z: 0, radius: .5 });
  const out = world.moveLocal(v(-2, .7), v(2, .7), body);
  assert.ok(out.x > .5 && out.z > .78);
  assert.equal(world.queryLocal(out.x, out.z, body.radius), false);
});

test('fallen-trunk capsule blocks its side and rounded ends, preserving a tangential escape', () => {
  const world = fixture(); world.addCapsule({ id: 'log', ax: -1, az: 0, bx: 1, bz: 0, radius: .2 });
  near(world.moveLocal(v(0, 2), v(0, -2), body).z, .4801);
  near(world.moveLocal(v(3, 0), v(-3, 0), body).x, 1.4801);
  const escape = world.moveLocal(v(0, .4801), v(3, .4801), body);
  near(escape.x, 3); near(escape.z, .4801);
});

test('unordered polygon footprint blocks pond interior and rounded corners', () => {
  const world = fixture(); world.addPolygon({ id: 'pond', points: [{x:1,z:1},{x:-1,z:-1},{x:1,z:-1},{x:-1,z:1}] });
  assert.equal(world.queryLocal(0, 0, .1), true);
  near(world.moveLocal(v(0, 5), v(0, -5), body).z, 1.2801);
  const corner = world.moveLocal(v(3, 3), v(0, 0), body);
  near(corner.x, 1 + .2801 / Math.SQRT2); near(corner.z, corner.x);
});

test('two-wall corners stop unresolved movement without tunneling either wall', () => {
  const world = fixture();
  world.addCapsule({id:'east',ax:0,az:-5,bx:0,bz:5,radius:.1});
  world.addCapsule({id:'north',ax:-5,az:0,bx:5,bz:0,radius:.1});
  const out = world.moveLocal(v(-3, -3), v(20, 20), body);
  near(out.x, -.3801); near(out.z, -.3801);
  assert.equal(world.queryLocal(out.x, out.z, body.radius), false);
});

test('overlapping spawn and moving-obstacle contact depenetrate deterministically', () => {
  const world = fixture(); world.addCircle({id:'tree',x:0,z:0,radius:.5});
  const out = world.moveLocal(v(0, 0), v(0, 0), body);
  near(out.x, .7801); near(out.z, 0);
  assert.equal(world.queryLocal(out.x, out.z, body.radius), false);
  world.addPolygon({id:'pool',points:[{x:3,z:3},{x:5,z:3},{x:5,z:5},{x:3,z:5}]});
  const inside = world.moveLocal(v(4, 4), v(4, 4), body);
  assert.equal(world.queryLocal(inside.x, inside.z, body.radius), false);
});

test('height intervals allow walking under overhead limbs and jumping over low rocks', () => {
  const world = fixture(); world.addCircle({id:'overhead',x:0,z:0,radius:1,minY:2.5,maxY:5});
  near(world.moveLocal(v(0,3),v(0,-3),body).z,-3);
  assert.equal(world.queryLocal(0,0,.1,.3,2.6),true);
  world.addCircle({id:'rock',x:0,z:0,radius:.4,minY:0,maxY:.3});
  near(world.moveLocal(v(0,3,.5),v(0,-3,.5),body).z,-3);
  near(world.moveLocal(v(0,3),v(0,-3),body).z,.6801);
});

test('registrations replace dynamic bodies and self-ignore avoids animal self-collision', () => {
  const world = fixture(); world.addCircle({id:'doe',x:0,z:0,radius:.6});
  assert.equal(world.queryLocal(0,0,.5),true);
  const ignoreIds = new Set(['doe']);
  near(world.moveLocal(v(0,0),v(1,0),{...body,ignoreIds}).x,1);
  world.addCircle({id:'doe',x:4,z:4,radius:.6}); assert.equal(world.size,1);
  assert.equal(world.queryLocal(0,0,.5),false);
  world.remove('doe'); assert.equal(world.size,0);
});

test('open-water walking exclusion never fades a head standing above the water', () => {
  const world = fixture(); world.addCircle({ id: 'pond', x: 0, z: 0, radius: 3, headOcclusion: false });
  assert.equal(world.queryLocal(0,0,.28),true);
  assert.equal(world.queryWorld(v(0,0,1.4),.13,.24,undefined,true),false);
  near(world.moveLocal(v(0,5),v(0,-5),body).z,3.2801);
  world.addCircle({ id: 'real-trunk', x: 0, z: 0, radius: .3 });
  assert.equal(world.queryWorld(v(0,0,1.4),.13,.24,undefined,true),true);
});

test('world translation, yaw, parenting and uniform scale preserve metre-sized contact', () => {
  const root = new THREE.Group(), parent = new THREE.Group(); parent.add(root);
  parent.position.set(4,.7,-6); parent.rotation.y=.4;
  root.position.set(-2,.3,1); root.rotation.y=1.1; root.scale.setScalar(2);
  const world = new WorldCollisions(root); world.addCircle({id:'tree',x:0,z:0,radius:.4});
  root.updateWorldMatrix(true,false);
  const start=root.localToWorld(v(0,3)), end=root.localToWorld(v(0,-3));
  const out=world.move(start,end,body), local=root.worldToLocal(out.clone());
  near(local.z,.5401); near(local.x,0); near(out.y,end.y);
  assert.equal(world.queryWorld(root.localToWorld(v(0,0)),.28,1.7),true);
  // Align a portal later: no footprint rebuild is needed.
  parent.rotation.y=-.8; root.position.x=7; root.updateWorldMatrix(true,false);
  const moved=world.move(root.localToWorld(v(0,3)),root.localToWorld(v(0,-3)),body);
  near(root.worldToLocal(moved).z,.5401);
});

test('movement preserves caller-owned terrain Y and supports a reused output vector', () => {
  const world=fixture(); world.addCircle({id:'tree',x:0,z:0,radius:.5});
  const out=new THREE.Vector3(); assert.equal(world.moveLocal(v(0,3,.2),v(0,-3,.6),body,out),out);
  near(out.y,.6); near(out.z,.7801);
});

test('bad geometry and nonfinite movement are rejected at the boundary', () => {
  const world=fixture();
  assert.throws(()=>world.addCircle({id:'bad',x:NaN,z:0,radius:1}));
  assert.throws(()=>world.addPolygon({id:'line',points:[{x:0,z:0},{x:1,z:0},{x:2,z:0}]}));
  assert.throws(()=>world.moveLocal(v(0,0),v(Infinity,0),body));
  assert.throws(()=>world.moveLocal(v(0,0),v(1,0),{radius:-1,height:1}));
});

function desktop() {
  const listeners=new Map();
  globalThis.window={ addEventListener:(type,fn)=>listeners.set(type,fn), setTimeout(){} };
  globalThis.document={ addEventListener(){}, exitPointerLock(){} };
  const camera=new THREE.PerspectiveCamera(), controls=new DesktopControls(camera,{addEventListener(){}});
  const key=(code,down=true)=>listeners.get(down?'keydown':'keyup')({code,preventDefault(){}});
  return {camera,controls,key};
}

test('actual desktop control stops sprint at trunk, then slides; keys still control movement', () => {
  const {camera,controls,key}=desktop(), world=fixture();
  world.addCircle({id:'trunk',x:0,z:-2,radius:.3});
  controls.resolveMovement=(start,end,height,out)=>world.move(start,end,{radius:.28,height},out);
  key('KeyW'); key('ShiftLeft'); controls.update(3);
  near(camera.position.z,-1.4199);
  key('KeyD'); for(let i=0;i<60;i++) controls.update(1/60);
  assert.ok(camera.position.x>1 && camera.position.z < -2);
  assert.equal(world.queryWorld(v(camera.position.x,camera.position.z),.28,1.7),false);
});

test('desktop obstruction keeps ground sample at resolved position and lands after jump', () => {
  const {camera,controls,key}=desktop(), world=fixture();
  world.addCircle({id:'tree',x:0,z:-2,radius:.3});
  controls.groundAt=(x,z)=>-z*.08;
  controls.resolveMovement=(start,end,height,out)=>world.move(start,end,{radius:.28,height},out);
  key('KeyW'); for(let i=0;i<180;i++) controls.update(1/60);
  near(camera.position.z,-1.4199);
  near(camera.position.y,controls.groundAt(camera.position.x,camera.position.z)+CONFIG.desktop.eyeHeight,.0001);
  controls.jump(); for(let i=0;i<180;i++) controls.update(1/60);
  assert.equal(controls.airborne,false);
  near(camera.position.z,-1.4199);
  near(camera.position.y,controls.groundAt(camera.position.x,camera.position.z)+CONFIG.desktop.eyeHeight,.0001);
});

test('desktop radial boundary is applied before collision and disabled controls do not move', () => {
  const {camera,controls,key}=desktop(), world=fixture();
  controls.bounds={centre:v(0,0),radius:3};
  world.addCircle({id:'edge-trunk',x:0,z:-2.8,radius:.3});
  controls.resolveMovement=(start,end,height,out)=>world.move(start,end,{radius:.28,height},out);
  key('KeyW'); controls.update(10); near(camera.position.z,-2.2199);
  const before=camera.position.clone(); controls.enabled=false; controls.update(10); assert.deepEqual(camera.position,before);
  controls.enabled=true; controls.update(NaN); assert.deepEqual(camera.position,before);
});

test('App resolves the current world per move and XR feedback never offsets tracking', () => {
  const source=readFileSync(new URL('../src/app/App.ts',import.meta.url),'utf8');
  assert.match(source,/controls\.resolveMovement = [\s\S]*?this\.outerWorld\.collisions/);
  assert.match(source,/headInsideObstacle = inXR[\s\S]*?queryWorld/);
  const feedback=source.slice(source.indexOf('this.collisionHeadBase.copy(head)'),source.indexOf('this.viewerDirection.set',source.indexOf('this.collisionHeadBase.copy(head)')));
  assert.doesNotMatch(feedback,/camera\.position|head\.set|head\.add|head\.sub|setReferenceSpace/);
});
