// Water-spill QA exercises actual geometry and bounded animation pools.
// Does not claim browser, GPU or headset verification.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';

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
const { WaterThreshold } = await import('../src/particles/WaterThreshold.ts');
const { HeightField } = await import('../src/worlds/terrain.ts');
const dt = 1 / 72;
function fixture() {
  const overlay = new THREE.Scene();
  const anchor = new THREE.Group();
  anchor.position.set(0, 1.35, -1.5);
  const water = new WaterThreshold(overlay);
  const options = { active: true, openness: 0.85, gap: 0.5,
    centre: new THREE.Vector2(0.08, -0.04), floorY: 0, crossing: 0 };
  const step = (frames = 1, delta = dt, time = 0) => {
    for (let i = 0; i < frames; i++) water.update(time + i * delta, delta, anchor, options);
    overlay.updateMatrixWorld(true);
  };
  const points = water.root.getObjectByName('Threshold droplets foam and crossing bubbles');
  const sheet = water.root.getObjectByName('Flowing water curtain');
  const impact = water.root.getObjectByName('Fading water impact ripples');
  return { water, anchor, overlay, options, step, points, sheet, impact };
}
function particles(f) {
  return Object.fromEntries(Object.entries(f.points.geometry.attributes).map(([key, value]) => [key, [...value.array]]));
}
function near(actual, expected, tolerance = 1e-6) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`); }

test('closed, wrong route, invalid terrain and completed crossing hide and clear the spill', () => {
  const f = fixture();
  assert.equal(f.water.root.visible, false);
  for (const overrides of [{ active: false }, { openness: 0 }, { gap: 0 }, { floorY: NaN }, { floorY: 6 }, { floorY: -10 }, { crossing: 0.8 }]) {
    f.options = Object.assign(f.options, { active: true, openness: 0.85, gap: 0.5, floorY: 0, crossing: 0 });
    f.step(72);
    assert.equal(f.water.root.visible, true);
    assert.ok(f.water.diagnostics.alive > 0);
    Object.assign(f.options, overrides);
    f.step();
    assert.equal(f.water.root.visible, false);
    assert.equal(f.water.diagnostics.alive, 0);
    assert.equal(f.water.diagnostics.opacity, 0);
  }
});

test('physical spill ignores 27× swallow scale and a scaled parent while copying world position and yaw', () => {
  const f = fixture();
  const parent = new THREE.Group();
  parent.position.set(4, 0.7, -3);
  parent.rotation.set(0, 0.62, 0);
  parent.scale.setScalar(1.2);
  parent.add(f.anchor);
  f.anchor.rotation.set(0.18, -0.42, 0.09);
  f.options.floorY = 0.7;
  f.step(30);
  const before = [...f.sheet.geometry.attributes.position.array];
  const beforeRoot = f.water.root.matrixWorld.clone();
  f.anchor.scale.setScalar(27);
  f.step();
  assert.deepEqual([...f.sheet.geometry.attributes.position.array], before);
  f.water.root.matrixWorld.elements.forEach((value, i) => near(value, beforeRoot.elements[i], 1e-9));
  const position = f.anchor.getWorldPosition(new THREE.Vector3());
  assert.ok(f.water.root.position.distanceTo(position) < 1e-9);
  assert.deepEqual(f.water.root.scale.toArray(), [1, 1, 1]);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(f.water.root.quaternion);
  assert.ok(up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9, 'gravity remains world-down even for a pitched seam');
  const orientation = new THREE.Vector3(0, 0, 1).applyQuaternion(f.anchor.getWorldQuaternion(new THREE.Quaternion()));
  orientation.y = 0; orientation.normalize();
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(f.water.root.quaternion).distanceTo(orientation) < 1e-9);
});

test('the sheet lands on the actual forest floor and emits inside the physical opening', () => {
  const f = fixture();
  f.anchor.position.set(2, 1.9, 3);
  f.anchor.rotation.y = 1.7;
  f.options.floorY = 0.42;
  f.options.openness = 0.35;
  f.options.gap = 1.1; // raw grip gap can exceed the partially torn visual opening
  f.step(100);
  const p = f.sheet.geometry.attributes.position;
  let low = Infinity, high = -Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(f.sheet.matrixWorld);
    low = Math.min(low, v.y); high = Math.max(high, v.y);
  }
  near(low, f.options.floorY + 0.018);
  near(high, f.anchor.position.y + f.options.centre.y);
  near(f.impact.getWorldPosition(v).y, f.options.floorY + 0.021);
  assert.ok(f.water.diagnostics.width <= f.options.openness * 0.55, 'narrow tear cannot emit a wide sheet');
  const positions = f.points.geometry.attributes.position.array;
  const lives = f.points.geometry.attributes.life.array;
  for (let i = 0; i < f.water.diagnostics.capacity; i++) if (lives[i * 2 + 1] > 0) {
    assert.ok(positions[i * 3 + 1] >= f.water.diagnostics.floorLocalY + 0.0249, 'all live droplets are above terrain');
  }
});

test('sustained flow and a bubble surge remain finite, bounded and reuse all buffer storage', () => {
  const f = fixture();
  const allocations = Object.fromEntries(Object.entries(f.points.geometry.attributes).map(([key, value]) => [key, value.array]));
  const sheetArray = f.sheet.geometry.attributes.position.array;
  let sawFoam = false, sawBubbles = false;
  for (let frame = 0; frame < 7200; frame++) {
    f.options.crossing = frame > 6000 ? 0.28 : 0;
    f.step();
    const d = f.water.diagnostics;
    assert.ok(d.capacity <= 200 && d.alive <= d.capacity);
    sawFoam ||= d.foam > 0;
    sawBubbles ||= d.bubbles > 0;
  }
  assert.ok(sawFoam, 'falling water produces a small impact spray');
  assert.ok(sawBubbles, 'crossing starts an ascending bubble surge');
  for (const [key, value] of Object.entries(f.points.geometry.attributes)) {
    assert.equal(value.array, allocations[key]);
    assert.ok(value.array.every(Number.isFinite));
  }
  assert.equal(f.sheet.geometry.attributes.position.array, sheetArray);
  assert.ok(sheetArray.every(Number.isFinite));
  assert.equal(f.water.root.children.length, 3, 'fixed draw-object count');
  for (const child of f.water.root.children) {
    assert.equal(child.material.depthWrite, false);
    assert.equal(child.material.depthTest, true);
    assert.equal(child.material.stencilWrite, false, 'spill intentionally crosses the tear stencil');
  }
});

test('zero dt freezes emission, geometry, particles and shader time even if wall time jumps', () => {
  const f = fixture(); f.step(150);
  const before = particles(f), diagnostics = f.water.diagnostics;
  const matrix = f.water.root.matrixWorld.clone();
  const geometry = [...f.sheet.geometry.attributes.position.array];
  const shaderTime = f.sheet.material.uniforms.uTime.value;
  f.anchor.position.x += 3;
  f.options.centre.x += 0.4;
  f.step(10, 0, 70000);
  assert.deepEqual(particles(f), before);
  assert.deepEqual(f.water.diagnostics, diagnostics);
  assert.ok(f.water.root.matrixWorld.equals(matrix));
  assert.deepEqual([...f.sheet.geometry.attributes.position.array], geometry);
  assert.equal(f.sheet.material.uniforms.uTime.value, shaderTime);
  f.step(1, dt, 80000);
  near(f.sheet.material.uniforms.uTime.value, shaderTime + dt);
});

test('leaving the route and re-entering starts a clean deterministic spill without stale bubbles', () => {
  const a = fixture(), b = fixture();
  a.step(100);
  a.options.crossing = 0.4;
  a.step(30);
  assert.ok(a.water.diagnostics.bubbles > 0);
  a.options.active = false;
  a.step();
  a.options.active = true;
  a.options.crossing = 0;
  a.step(90); b.step(90);
  assert.deepEqual(a.water.diagnostics, b.water.diagnostics);
  assert.deepEqual(particles(a), particles(b));
  assert.equal(a.water.diagnostics.bubbles, 0);
  a.water.reset();
  assert.equal(a.water.root.visible, false);
  assert.equal(a.water.diagnostics.alive, 0);
});


test('sloped terrain contacts follow world coordinates for the impact grid, sheet edge and droplets', () => {
  const f = fixture();
  const terrain = new HeightField(30, 48, (x, z) => 0.06 * x + 0.11 * z + 0.12 * Math.sin(x));
  let samples = 0;
  f.options.groundAt = (x, z) => { samples++; return terrain.heightAt(x, z); };
  f.anchor.position.set(3, 2.6, -1);
  f.anchor.rotation.y = 1.28;
  f.options.floorY = terrain.heightAt(f.anchor.position.x, f.anchor.position.z);
  f.step(200);
  const v = new THREE.Vector3();
  const impact = f.impact.geometry.attributes.position;
  for (let i = 0; i < impact.count; i++) {
    v.fromBufferAttribute(impact, i).applyMatrix4(f.impact.matrixWorld);
    near(v.y, terrain.heightAt(v.x, v.z) + 0.021);
  }
  const sheet = f.sheet.geometry.attributes.position;
  for (let i = sheet.count - 11; i < sheet.count; i++) {
    v.fromBufferAttribute(sheet, i).applyMatrix4(f.sheet.matrixWorld);
    near(v.y, terrain.heightAt(v.x, v.z) + 0.018);
  }
  const points = f.points.geometry.attributes.position;
  const lives = f.points.geometry.attributes.life;
  for (let i = 0; i < points.count; i++) if (lives.getY(i) > 0) {
    v.fromBufferAttribute(points, i).applyMatrix4(f.points.matrixWorld);
    assert.ok(v.y >= terrain.heightAt(v.x, v.z) + 0.0249);
  }
  samples = 0;
  f.step();
  assert.ok(samples <= f.water.diagnostics.capacity + 1, 'held seam reuses its conformed ripple/sheet grid');
  f.options.active = false;
  samples = 0;
  f.step(50);
  assert.equal(samples, 0, 'other worlds perform no terrain sampling for the water effect');
  for (const child of f.water.root.children) assert.ok(child.renderOrder < 0, 'hand cues at order 0 draw after the translucent spill');
});
