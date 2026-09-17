// Run with Node 22.15+ (or Node 24): node scripts/test-interaction.mjs
// Exercises the real simulation with deterministic tracked-hand samples.
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
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
        shortCircuit: true
      };
    }
    return nextLoad(url, context);
  }
});

const { TearSimulation } = await import('../src/tear/TearSimulation.ts');
const { CONFIG } = await import('../src/config/config.ts');
const gain = CONFIG.tear.xrPullGain;
const dt = 1 / 90;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} != ${expected}`);

function scenario(pullGain) {
  const sim = new TearSimulation(new THREE.Object3D());
  const hands = [-1, 1].map(side => ({
    tracked: true, pinching: true, pinchStarted: true,
    position: new THREE.Vector3(side * 0.02, 0, 0),
    speed: 0, acceleration: new THREE.Vector3()
  }));
  const events = [];
  sim.on(event => events.push(event.type));
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      sim.update(hands, dt, pullGain);
      hands.forEach(hand => { hand.pinchStarted = false; });
    }
  };
  const move = (outward, y = 0, z = 0) => {
    hands[0].position.set(-0.02 - outward, y, z);
    hands[1].position.set(0.02 + outward, y, z);
  };
  step();
  return { sim, hands, events, step, move };
}

test('desktop default remains a one-to-one displacement; XR amplifies XY only', () => {
  const desktop = scenario();
  const explicit = scenario(1);
  const xr = scenario(gain);
  for (const s of [desktop, explicit, xr]) { s.move(0.12, 0.03, 0.06); s.step(180); }
  close(desktop.sim.grips[1].target.x, 0.12, 'desktop X');
  close(desktop.sim.grips[1].target.y, 0.03, 'desktop Y');
  close(xr.sim.grips[1].target.x, 0.12 * gain, 'XR X');
  close(xr.sim.grips[1].target.y, 0.03 * gain, 'XR Y');
  close(xr.sim.grips[1].target.z, 0.06, 'depth stays natural');
  close(xr.sim.gap, desktop.sim.gap * gain, 'same physical motion gives 1.22x gap');
  assert.deepEqual(desktop.sim.grips, explicit.sim.grips);
  assert.deepEqual(desktop.events, explicit.events);
});

test('18% less physical travel reproduces the same tear progression', () => {
  const desktop = scenario();
  const xr = scenario(gain);
  for (let frame = 1; frame <= 180; frame++) {
    const travel = frame / 180 * 0.32;
    desktop.move(travel);
    xr.move(travel / gain);
    desktop.step();
    xr.step();
    close(xr.sim.gap, desktop.sim.gap, 'gap');
    close(xr.sim.tornLength, desktop.sim.tornLength, 'tear length');
    close(xr.sim.openness, desktop.sim.openness, 'opening');
  }
  assert.ok(xr.events.includes('breakthrough'));
  assert.deepEqual(xr.events, desktop.events);
});

test('pinching still needs outward movement and two grips', () => {
  const stationary = scenario(gain);
  stationary.step(180);
  assert.equal(stationary.sim.tornLength, 0);
  assert.equal(stationary.sim.gap, 0);
  assert.ok(!stationary.events.includes('breakthrough'));

  const single = scenario(gain);
  single.hands[1].pinching = false;
  single.step();
  single.move(0.25);
  single.step(180);
  assert.equal(single.sim.gripsHolding, 1);
  assert.equal(single.sim.tornLength, 0);
});

test('comfort gain lowers actual travel to first rip without removing yield', () => {
  const desktop = scenario();
  const xr = scenario(gain);
  desktop.move(0.029);
  xr.move(0.029);
  desktop.step(180);
  xr.step(180);
  assert.equal(desktop.sim.tornLength, 0);
  assert.ok(xr.sim.tornLength > 0);
});

test('XR reaches the unchanged full-opening threshold at 23cm per hand', () => {
  const xr = scenario(gain);
  // A small margin above the exact 22.54cm target accommodates smoothing.
  xr.move(0.23);
  xr.step(180);
  assert.equal(xr.sim.gripsHolding, 2);
  assert.ok(xr.sim.gap >= CONFIG.tear.fullyOpenGap);
  assert.ok(xr.sim.tornLength > 0);
  // Sustain the threshold for the application's unchanged crossing hold time.
  for (let frame = 0; frame <= CONFIG.worlds.fullyOpenHoldSeconds / dt; frame++) {
    xr.step();
    assert.ok(xr.sim.gap >= CONFIG.tear.fullyOpenGap);
  }
});

test('release still heals; tracking loss releases a held grip', () => {
  const s = scenario(gain);
  s.move(0.20);
  s.step(180);
  assert.ok(s.sim.tornLength > 0);
  s.hands[0].tracked = false;
  s.hands[1].pinching = false;
  s.step();
  assert.equal(s.sim.gripsHolding, 0);
  assert.ok(s.events.includes('release'));
  s.step(90 * 12);
  assert.equal(s.sim.tornLength, 0);
  assert.equal(s.sim.openness, 0);
  assert.ok(s.sim.grips.every(grip => grip.weight === 0));
  assert.ok(s.events.includes('healed'));
});

test('regrabbing a displaced edge has no jump, then gains only new motion', () => {
  const s = scenario(gain);
  s.move(0.11, 0.02, 0.04);
  s.step(180);
  s.hands.forEach(hand => { hand.pinching = false; });
  s.step();
  const before = s.sim.grips.map(grip => grip.disp.clone());
  s.hands.forEach(hand => { hand.pinching = true; hand.pinchStarted = true; });
  s.step();
  assert.equal(s.sim.gripsHolding, 2);
  s.sim.grips.forEach((grip, i) => {
    close(grip.disp.distanceTo(before[i]), 0, 'regrip displacement');
    close(grip.target.distanceTo(before[i]), 0, 'regrip target');
  });
  s.move(0.13, 0.03, 0.05);
  s.step();
  s.sim.grips.forEach((grip, i) => {
    close(grip.target.x, before[i].x + (i === 0 ? -1 : 1) * 0.02 * gain, 'new X motion');
    close(grip.target.y, before[i].y + 0.01 * gain, 'new Y motion');
    close(grip.target.z, before[i].z + 0.01, 'new Z motion');
    assert.ok(grip.disp.toArray().every(Number.isFinite));
  });
});

test('capture distance remains physical, and gain is bounded and finite', () => {
  for (const position of [new THREE.Vector3(0, 0, CONFIG.tear.captureRadius + 0.001), new THREE.Vector3(0.5, 0, 0)]) {
    const s = scenario(gain);
    s.sim.reset();
    s.hands.forEach(hand => { hand.position.copy(position); hand.pinchStarted = true; });
    s.step();
    assert.equal(s.sim.gripsHolding, 0);
  }
  for (const [input, expectedGain] of [[NaN, 1], [Infinity, 1], [-1, 1], [100, 1.5]]) {
    const s = scenario(input);
    s.move(0.10);
    s.step();
    close(s.sim.grips[1].target.x, 0.10 * expectedGain, 'sanitized gain');
    assert.ok(s.sim.grips.every(grip => grip.disp.toArray().every(Number.isFinite)));
  }
});
