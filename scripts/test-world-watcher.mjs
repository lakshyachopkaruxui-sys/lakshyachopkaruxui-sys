// Watcher acceptance tests against real World Three cover geometry.
// No renderer/headset claims: visibility is checked with independent raycasts.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' })
    };
    return nextLoad(url, context);
  }
});
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
GLTFLoader.prototype.load = () => undefined;
globalThis.document = { createElement() { return {
  width: 64, height: 64,
  getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} })
}; } };

const { WorldThree } = await import('../src/worlds/WorldThree.ts');
const { WorldWatcher } = await import('../src/worlds/WorldWatcher.ts');
const dt = 0.05;
function fixture() {
  const world = new WorldThree(new THREE.Vector3(0, 1.35, 0));
  const parent = world.islands[0].root;
  world.watcher.root.visible = false;
  const watcher = new WorldWatcher(parent, [...world.watcher.covers],
    (x, z) => world.islands[0].terrain.heightAt(x, z), () => 0, false);
  const viewer = new THREE.Vector3(0, 1.6, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const step = (seconds, active = true) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) watcher.update(viewer, forward, active, dt);
    world.scene.updateMatrixWorld(true);
  };
  return { world, parent, watcher, viewer, forward, step };
}
function spawn(f) {
  f.step(8.5);
  assert.ok(f.watcher.diagnostics.siteIndex >= 0, 'watcher finds an off-screen covered site from the normal entry');
  assert.equal(f.watcher.root.visible, true);
}
function eyesWorld(watcher) {
  watcher.root.updateWorldMatrix(true, true);
  const eyes = watcher.root.children.filter(child => child.isMesh);
  assert.equal(eyes.length, 2);
  return eyes[0].getWorldPosition(new THREE.Vector3()).add(eyes[1].getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
}
function rayTo(watcher, viewer, target) {
  const delta = target.clone().sub(viewer);
  const length = delta.length();
  const ray = new THREE.Raycaster(viewer.clone(), delta.normalize(), 0.02, length - 0.025);
  return ray.intersectObjects(watcher.covers.map(cover => cover.mesh), false);
}
function lookAtEyes(f) {
  f.forward.copy(eyesWorld(f.watcher).sub(f.viewer).normalize());
}

test('inactive portal previews hide the watcher; entry keeps at least six quiet seconds', () => {
  const f = fixture();
  f.step(15, false);
  assert.equal(f.watcher.root.visible, false);
  assert.equal(f.watcher.diagnostics.siteIndex, -1);
  assert.equal(f.watcher.consumeReturnHint(), false);
  f.step(5.95);
  assert.equal(f.watcher.root.visible, false);
  assert.equal(f.watcher.diagnostics.relocations, 0);
  f.step(1.25);
  assert.ok(f.watcher.diagnostics.siteIndex >= 0);
  assert.equal(f.watcher.root.visible, true);
});

test('turning from entry reveals unobstructed eyes while real basalt hides the torso', () => {
  const f = fixture();
  spawn(f);
  const torso = f.watcher.root.localToWorld(new THREE.Vector3(0, 0.45, 0));
  assert.ok(rayTo(f.watcher, f.viewer, torso).length > 0, 'actual stone triangles hide the torso');
  const eye = eyesWorld(f.watcher);
  assert.equal(rayTo(f.watcher, f.viewer, eye).length, 0, 'the eye line is above or beside actual cover');
  const towardEye = eye.clone().sub(f.viewer).normalize();
  assert.ok(towardEye.angleTo(f.forward) > THREE.MathUtils.degToRad(80), 'initial placement is outside the original viewing direction');
  lookAtEyes(f);
  f.step(0.5);
  assert.equal(f.watcher.diagnostics.phase, 'observed');
  assert.equal(f.watcher.consumeReturnHint(), false, 'brief glance does not emit the cue');
  f.step(0.1);
  assert.equal(f.watcher.consumeReturnHint(), true, 'sustained actual sighting emits the cue');
  assert.equal(f.watcher.consumeReturnHint(), false, 'cue is consumed once');
  f.step(2);
  assert.equal(f.watcher.consumeReturnHint(), false, 'continuing to look does not repeat it');
});

test('looking at the observer for twenty seconds prevents visible teleportation', () => {
  const f = fixture(); spawn(f); lookAtEyes(f);
  const position = f.watcher.root.position.clone();
  const moves = f.watcher.diagnostics.relocations;
  for (let frame = 0; frame < 400; frame++) {
    f.step(dt);
    assert.equal(f.watcher.diagnostics.relocations, moves);
    assert.ok(position.distanceTo(f.watcher.root.position) < 1e-10);
    assert.equal(f.watcher.root.visible, true);
  }
});

test('approach starts only after discovery, advances continuously around cover, and stops outside personal space', () => {
  const f = fixture(); spawn(f);
  const initial = f.watcher.root.position.clone();
  const initialDistance = f.watcher.diagnostics.horizontalDistance;
  assert.ok(initialDistance >= 11 && initialDistance <= 14, `first sighting is distant: ${initialDistance}`);
  f.step(25);
  assert.ok(f.watcher.root.position.distanceTo(initial) < 1e-10, 'looking at scenery cannot consume the distant first encounter');
  lookAtEyes(f); f.step(0.7);
  assert.equal(f.watcher.consumeReturnHint(), true);
  f.forward.negate();
  f.step(0.75);
  assert.ok(f.watcher.root.position.distanceTo(initial) < 1e-10, 'a momentary glance away cannot move the shadow');
  let previous = f.watcher.root.position.clone(), movingFrames = 0, minDistance = Infinity;
  const down = new THREE.Vector3(0, -1, 0);
  for (let frame = 0; frame < 1800; frame++) {
    f.step(dt);
    const current = f.watcher.root.position;
    const stepDistance = Math.hypot(current.x - previous.x, current.z - previous.z);
    assert.ok(stepDistance <= 0.18 * dt + 1e-9, `no position jumps: ${stepDistance}`);
    if (stepDistance > 1e-7) movingFrames++;
    assert.ok(Math.abs(current.y - f.world.islands[0].terrain.heightAt(current.x, current.z)) < 1e-10, 'each movement follows the rendered triangle height');
    assert.equal(f.watcher.diagnostics.relocations, 1, 'after initial placement there are no relocations');
    minDistance = Math.min(minDistance, f.watcher.diagnostics.horizontalDistance);
    if (frame % 20 === 0) {
      const foot = f.watcher.root.getWorldPosition(new THREE.Vector3());
      const grounding = new THREE.Raycaster(foot.clone().add(new THREE.Vector3(0, 3, 0)), down, 0, 4);
      const hit = grounding.intersectObject(f.world.islands[0].surface, false)[0];
      assert.ok(hit && Math.abs(hit.point.y - foot.y) < 1e-5, 'the figure remains on actual island triangles');
      for (let i = 0; i < 8; i++) {
        const offset = new THREE.Vector3(Math.cos(i * Math.PI / 4) * 0.26, 0, Math.sin(i * Math.PI / 4) * 0.26);
        const probe = new THREE.Raycaster(foot.clone().add(offset).add(new THREE.Vector3(0, 2.4, 0)), down, 0, 2.8);
        assert.equal(probe.intersectObjects(f.watcher.covers.map(cover => cover.mesh), false).length, 0, 'body footprint never passes through actual cover triangles');
      }
    }
    previous.copy(current);
  }
  assert.ok(movingFrames > 700, 'the observer genuinely approaches, rather than staying permanently hidden');
  assert.ok(f.watcher.diagnostics.horizontalDistance >= 4.8 - 1e-6 && f.watcher.diagnostics.horizontalDistance < 5.05, 'it reaches a readable closer position then waits');
  assert.ok(minDistance >= 4.8 - 1e-6, 'it never enters personal space under its own movement');
  lookAtEyes(f); f.step(0.6);
  const close = f.watcher.root.position.clone();
  assert.equal(f.watcher.diagnostics.phase, 'observed');
  f.step(15);
  assert.ok(f.watcher.root.position.distanceTo(close) < 1e-10, 'looking back visibly freezes the new position');
  assert.equal(f.watcher.consumeReturnHint(), false, 'a later sighting cannot repeat the return cue');
  console.log(JSON.stringify({ watcherStartDistance: initialDistance, watcherStopDistance: f.watcher.diagnostics.horizontalDistance, continuousApproachMetres: f.watcher.diagnostics.approachDistance }));
});

test('pause and invalid elapsed times freeze the actor and cannot fast-forward the approach', () => {
  const f = fixture(); spawn(f); lookAtEyes(f); f.step(0.7); f.forward.negate(); f.step(8);
  const position = f.watcher.root.position.clone(), elapsed = f.watcher.diagnostics.elapsed;
  const steps = f.watcher.diagnostics.approachSteps, opacity = f.watcher.diagnostics.opacity;
  for (const delta of [0, 0, NaN, Infinity, -2]) f.watcher.update(f.viewer, f.forward, true, delta);
  assert.ok(f.watcher.root.position.distanceTo(position) < 1e-10);
  assert.equal(f.watcher.diagnostics.elapsed, elapsed);
  assert.equal(f.watcher.diagnostics.approachSteps, steps);
  assert.equal(f.watcher.diagnostics.opacity, opacity);
  f.watcher.update(f.viewer, f.forward, true, 60);
  assert.ok(Math.hypot(f.watcher.root.position.x - position.x, f.watcher.root.position.z - position.z) <= 0.018 + 1e-9, 'one late frame is clamped, never a leap');
});

test('approaching within three metres conceals the observer and inactive mode clears pending hints', () => {
  const f = fixture(); spawn(f); lookAtEyes(f); f.step(0.6);
  f.step(dt, false);
  assert.equal(f.watcher.consumeReturnHint(), false, 'portal/transition deactivation clears the undelivered hint');
  assert.equal(f.watcher.root.visible, false);
  spawn(f);
  const at = f.watcher.root.getWorldPosition(new THREE.Vector3());
  f.viewer.copy(at).add(new THREE.Vector3(0, 1.6, 1));
  lookAtEyes(f);
  f.step(dt);
  assert.ok(f.viewer.distanceTo(at) < 3);
  assert.equal(f.watcher.root.visible, false);
  assert.equal(f.watcher.diagnostics.phase, 'concealed');
  f.viewer.set(0, 1.6, 0); f.step(15);
  assert.equal(f.watcher.root.visible, false, 'backing away cannot make a nearby silhouette reappear');
});

test('translated/rotated worlds preserve decisions without mutating viewer inputs', () => {
  const plain = fixture(), moved = fixture();
  moved.world.root.position.set(31, 0, -23);
  moved.world.root.rotation.y = 0.73;
  moved.world.scene.updateMatrixWorld(true);
  moved.viewer.applyMatrix4(moved.world.root.matrixWorld);
  moved.forward.transformDirection(moved.world.root.matrixWorld);
  const originalViewer = moved.viewer.clone(), originalForward = moved.forward.clone();
  for (let frame = 0; frame < 300; frame++) { plain.step(dt); moved.step(dt); }
  assert.equal(moved.watcher.diagnostics.siteIndex, plain.watcher.diagnostics.siteIndex);
  assert.equal(moved.watcher.diagnostics.relocations, plain.watcher.diagnostics.relocations);
  assert.ok(moved.watcher.root.position.distanceTo(plain.watcher.root.position) < 1e-7);
  assert.deepEqual(moved.viewer.toArray(), originalViewer.toArray());
  assert.deepEqual(moved.forward.toArray(), originalForward.toArray());
  for (const f of [plain, moved]) { lookAtEyes(f); f.step(0.7); f.forward.negate(); }
  for (let frame = 0; frame < 600; frame++) { plain.step(dt); moved.step(dt); }
  assert.ok(plain.watcher.diagnostics.approachDistance > 4, 'the invariance check includes actual pursuit');
  assert.ok(moved.watcher.root.position.distanceTo(plain.watcher.root.position) < 1e-7, 'cover routes are identical in the parent frame');
  for (const dt of [NaN, Infinity, -1]) moved.watcher.update(moved.viewer, moved.forward, true, dt);
  assert.ok(moved.watcher.root.position.toArray().every(Number.isFinite));
});

test('the complete shadow is available without an asset request and resets for the next visit', async () => {
  const f = fixture();
  const original = GLTFLoader.prototype.load;
  let modelRequests = 0, watcher;
  GLTFLoader.prototype.load = () => { modelRequests++; };
  try {
    watcher = new WorldWatcher(f.parent, [...f.watcher.covers],
      (x, z) => f.world.islands[0].terrain.heightAt(x, z), () => 1, true);
    await watcher.ready;
  } finally { GLTFLoader.prototype.load = original; }
  assert.equal(modelRequests, 0, 'the new original silhouette has no missing/network model dependency');
  assert.equal(watcher.root.visible, false);
  const silhouette = watcher.root.getObjectByName('unknown shadow creature');
  assert.ok(silhouette?.children.some(child => child.isMesh));
  for (let frame = 0; frame < 170; frame++) watcher.update(f.viewer, f.forward, true, dt);
  assert.equal(watcher.root.visible, true);
  watcher.root.traverse(mesh => { if (mesh.isMesh) assert.equal(mesh.material.stencilRef, 1); });
  watcher.update(f.viewer, f.forward, false, dt);
  assert.equal(watcher.root.visible, false);
  for (let frame = 0; frame < 119; frame++) watcher.update(f.viewer, f.forward, true, dt);
  assert.equal(watcher.root.visible, false, 'each visit gets a fresh settling period');
  assert.equal(watcher.consumeReturnHint(), false);
  assert.equal(watcher.diagnostics.approachDistance, 0);
});
