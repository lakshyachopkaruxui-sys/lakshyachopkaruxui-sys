// Actual world geometry and App transition placement, with a controlled XR pose.
// These checks do not replace stereo rendering or physical headset testing.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return {
      format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true
    };
    return next(url, context);
  }
});

// Browser image/GLB loading is covered separately. The real procedural floors,
// room, island, props and transforms are built here without substitute meshes.
THREE.TextureLoader.prototype.load = (_url, onLoad) => { const texture = new THREE.Texture(); queueMicrotask(() => onLoad?.(texture)); return texture; };
HDRLoader.prototype.load = () => new THREE.DataTexture();
GLTFLoader.prototype.load = () => undefined;
GLTFLoader.prototype.loadAsync = () => new Promise(() => {});
globalThis.document = { createElement(tag) {
  assert.equal(tag, 'canvas');
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: text => ({ width: String(text).length * 8 })
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  return { width: 1, height: 1, getContext: () => context };
} };

const { App, NEXT_WORLD } = await import('../src/app/App.ts');
const { WorldOne } = await import('../src/worlds/WorldOne.ts');
const { WorldTwo } = await import('../src/worlds/WorldTwo.ts');
const { WorldUnderwater } = await import('../src/worlds/WorldUnderwater.ts');
const { WorldThree } = await import('../src/worlds/WorldThree.ts');
const worlds = [new WorldOne(), new WorldTwo(new THREE.Vector3()), new WorldUnderwater(new THREE.Vector3()), new WorldThree(new THREE.Vector3())];
const floors = worlds.map(world => world.islands?.[0].surface ?? world.root.children.find(object =>
  object.name === 'oak plank floor' || object.geometry === world.terrain?.geometry && object.isMesh));
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const close = (actual, expected, message, tolerance = 4e-5) =>
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);

function verifyFloor(world, mesh, point) {
  mesh.updateWorldMatrix(true, false);
  ray.set(new THREE.Vector3(point.x, 100, point.z), down);
  const hit = ray.intersectObject(mesh, false)[0];
  assert.ok(hit, `${world.constructor.name}: arrival has a rendered floor`);
  close(world.groundAt(point.x, point.z), hit.point.y, `${world.constructor.name}: ground sampler matches arrival`);
}

function fixture(inXR) {
  const app = Object.create(App.prototype);
  app.worlds = worlds;
  [app.worldOne, app.worldTwo, app.worldUnderwater, app.worldThree] = worlds;
  app.outerIndex = 0;
  app.nextWorld = NEXT_WORLD;
  app.notesTarget = { place() {} };
  app.narrationTarget = { place() {} };
  app.replayTarget = { place() {} };
  app.helpGesture = { reset() {} };
  app.narrationGesture = { reset() {} };
  app.replayGesture = { reset() {} };
  app.narration = { play() {}, stop() {} };
  app.viewerPosition = new THREE.Vector3(); app.viewerDirection = new THREE.Vector3();
  app.camera = new THREE.PerspectiveCamera();
  const headset = new THREE.PerspectiveCamera();
  app.renderer = { xr: { isPresenting: inXR, getCamera: () => headset } };
  app.xrMode = 'immersive-ar';
  app.anchor = new THREE.Group();
  worlds[0].scene.add(app.anchor);
  app.desktopHands = { forceRelease() {} };
  app.controls = {};
  app.tmpA = new THREE.Vector3(); app.tmpB = new THREE.Vector3(); app.tmpQ = new THREE.Quaternion();
  app.time = 20;
  return { app, viewer: inXR ? headset : app.camera };
}

for (const inXR of [false, true]) test(`${inXR ? 'Quest pose' : 'desktop pose'}: full four-world journey faces the tear and keeps grounded, stationary arrivals`, () => {
  for (const [x, z, yaw] of [[0, 0, 0], [32, -27, 1.3], [-11, 19, -2.4]]) {
    const { app, viewer } = fixture(inXR);
    viewer.position.set(x, 1.63, z);
    viewer.rotation.set(.18, yaw, -.05, 'YXZ');
    viewer.updateMatrixWorld(true);
    const originalPose = viewer.matrixWorld.clone();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewer.quaternion).setY(0).normalize();
    for (const next of [2, 3, 1, 0]) {
      app.placeSeamInFront();
      const destination = worlds[next];
      const destinationForward = new THREE.Vector3(0, 0, -1).transformDirection(destination.root.matrixWorld);
      close(destinationForward.dot(forward), 1, `${destination.constructor.name}: destination follows viewing heading`);
      close(destination.root.rotation.x, 0, 'floor remains level in pitch');
      close(destination.root.rotation.z, 0, 'floor remains level in roll');
      if (destination instanceof WorldTwo) close(destination.scene.environmentRotation.y,
        destination.root.rotation.y + Math.PI / 2, 'forest lighting follows the visible canopy after rotated entry');
      assert.ok(destination.root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-10, 'destination retains life-size scale');
      verifyFloor(destination, floors[next], viewer.position);
      const bounds = destination.walkBounds;
      assert.ok(Math.hypot(viewer.position.x - bounds.center.x, viewer.position.z - bounds.center.z) < bounds.radius, 'arrival remains within walking area');
      app.stepThrough();
      assert.equal(app.outerIndex, next, 'same route in both modes');
      assert.equal(app.anchor.parent, destination.scene, 'seam joins current world');
      assert.deepEqual(viewer.matrixWorld.elements, originalPose.elements, 'transition never moves or tilts participant');
      assert.equal(destination.root.visible, next !== 0 || !inXR, 'only real-room content is hidden during passthrough');
    }
    app.anchor.removeFromParent();
  }
});

test('all virtual destinations use world-space tear yaw while ignoring pitch, roll and swallow scale', () => {
  const parent = new THREE.Group();
  parent.position.set(17, 0, -29); parent.rotation.y = -.63;
  const anchor = new THREE.Group(); parent.add(anchor);
  anchor.position.set(2, 1.35, -4); anchor.rotation.set(.21, 1.1, -.14, 'YXZ'); anchor.scale.setScalar(26);
  parent.updateMatrixWorld(true);
  const expectedOrigin = anchor.getWorldPosition(new THREE.Vector3()).setY(0);
  const expectedForward = new THREE.Vector3(0, 0, -1).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  for (const [index, world] of worlds.entries()) {
    if (!index) continue;
    world.alignTo(anchor);
    assert.ok(world.root.position.distanceTo(expectedOrigin) < 1e-10, 'nested tear world position is used');
    close(new THREE.Vector3(0, 0, -1).transformDirection(world.root.matrixWorld).dot(expectedForward), 1, `${world.constructor.name}: nested tear heading`);
    close(world.root.rotation.x, 0, 'pitch ignored'); close(world.root.rotation.z, 0, 'roll ignored');
    assert.ok(world.root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-10, '26x swallow scale is not inherited');
    for (const [x, z] of [[0, .65], [0, 1.1], [-2, -3], [3, -4]]) {
      verifyFloor(world, floors[index], world.root.localToWorld(new THREE.Vector3(x, 0, z)));
    }
  }
});

test('forest photograph and environment lookup agree in every horizontal direction after yaw alignment',()=>{
  const forest=worlds[1],sky=forest.root.children.find(o=>o.name==='Photographic Forest Slope distant pine canopy');
  const p=sky.geometry.attributes.position,uv=sky.geometry.attributes.uv;
  for(const yaw of [0,.7,-2.1]){
    const anchor=new THREE.Group();anchor.rotation.y=yaw;anchor.updateMatrixWorld(true);forest.alignTo(anchor);
    sky.updateWorldMatrix(true,false);
    const inverseEnvironment=new THREE.Matrix4().makeRotationY(-forest.scene.environmentRotation.y);
    for(let i=49;i<p.count-49;i+=13){
      const direction=new THREE.Vector3().fromBufferAttribute(p,i).transformDirection(sky.matrixWorld).transformDirection(inverseEnvironment);
      const u=Math.atan2(direction.z,direction.x)/(2*Math.PI)+.5;
      const v=Math.asin(THREE.MathUtils.clamp(direction.y,-1,1))/Math.PI+.5;
      const du=Math.abs(u-uv.getX(i));
      assert.ok(Math.min(du,Math.abs(1-du))<1e-5,'sky and lighting sample the same longitude');
      close(v,uv.getY(i),'sky and lighting sample the same latitude');
    }
  }
});
