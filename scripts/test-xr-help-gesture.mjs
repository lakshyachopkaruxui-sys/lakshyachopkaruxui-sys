// Synthetic pointer trajectories, not optical hand tracking or Quest testing.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';

const sourceRoot = new URL('../src/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith(sourceRoot)) {
      const url = new URL(specifier + '.ts', context.parentURL);
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
const { XRHelpGesture, XR_HELP_TARGET } = await import('../src/interaction/XRHelpGesture.ts');
const target = new THREE.Vector3(.18, 1.38, -.36);
const outside = target.clone().add(new THREE.Vector3(.15, 0, 0));
function hand(at = target, tracked = true) {
  const tip = at.clone();
  return { tracked, indexTip: tip, thumbTip: at.clone().add(new THREE.Vector3(.06, 0, 0)),
    joints: [], jointPositions: { 'index-finger-tip': tip } };
}
const left = () => [hand(), hand(outside, false)];
const right = () => [hand(outside, false), hand()];
const away = () => [hand(outside), hand(outside)];
function hold(gesture, samples, seconds, position = target, enabled = true, hz = 100) {
  let events = 0;
  for (let frame = 0; frame < Math.round(seconds * hz); frame++) {
    if (gesture.updateTarget(samples, position, 1 / hz, enabled)) events++;
  }
  return events;
}

test('either index opens once; continued hold cannot immediately dismiss', () => {
  for (const samples of [left(), right()]) {
    const gesture = new XRHelpGesture();
    assert.equal(hold(gesture, samples, .6), 0);
    assert.ok(gesture.progress > .9);
    assert.equal(hold(gesture, samples, .05), 1);
    assert.equal(gesture.latched, true);
    assert.equal(hold(gesture, samples, 5), 0);
  }
});

test('pointer and target translation/rotation together preserve activation', () => {
  const transform = new THREE.Matrix4().makeRotationY(2.3);
  transform.setPosition(12, .3, -31);
  const samples = right();
  samples.forEach(sample => sample.indexTip.applyMatrix4(transform));
  assert.equal(hold(new XRHelpGesture(), samples, .65, target.clone().applyMatrix4(transform)), 1);
});

test('stable release allows dismissal; boundary jitter cannot release the latch', () => {
  const gesture = new XRHelpGesture();
  assert.equal(hold(gesture, left(), .65), 1);
  hold(gesture, away(), .19);
  assert.equal(hold(gesture, left(), 1), 0, 'release debounce');
  const betweenRadii = target.clone().add(new THREE.Vector3(.06, 0, 0));
  hold(gesture, [hand(betweenRadii), hand(outside)], 1);
  assert.equal(hold(gesture, left(), 1), 0, 'release hysteresis');
  hold(gesture, away(), .2);
  assert.equal(gesture.latched, false);
  assert.equal(hold(gesture, left(), .65), 1);
});

test('tracking loss cannot release activation or transfer latch to another hand', () => {
  const gesture = new XRHelpGesture();
  assert.equal(hold(gesture, left(), .65), 1);
  hold(gesture, [hand(outside, false), hand(outside, false)], 1);
  assert.equal(hold(gesture, right(), 1), 0);
  assert.equal(hold(gesture, left(), 1), 0);
  hold(gesture, away(), .2);
  assert.equal(hold(gesture, right(), .65), 1);
});

test('missing named index, tracking loss and invalid joint cancel partial holds', () => {
  for (const change of [
    sample => { sample.tracked = false; },
    sample => { delete sample.jointPositions['index-finger-tip']; },
    sample => { delete sample.jointPositions; },
    sample => { sample.indexTip.x = NaN; }
  ]) {
    const gesture = new XRHelpGesture();
    hold(gesture, left(), .6);
    const lost = left(); change(lost[0]);
    assert.equal(hold(gesture, lost, .1), 0);
    assert.equal(gesture.progress, 0);
    assert.equal(hold(gesture, left(), .6), 0);
    assert.equal(hold(gesture, left(), .05), 1);
  }
});

test('hands cannot combine short dwells, and existing candidate remains stable', () => {
  const gesture = new XRHelpGesture();
  hold(gesture, right(), .4);
  hold(gesture, [hand(), hand()], .2);
  assert.equal(gesture.hoveredHand, 1);
  assert.equal(hold(gesture, left(), .6), 0, 'switching starts again');
  assert.equal(hold(gesture, left(), .05), 1);
});

test('passing through target, leaving or a legacy palm pose cannot trigger', () => {
  const gesture = new XRHelpGesture();
  for (let pass = 0; pass < 10; pass++) {
    assert.equal(hold(gesture, left(), .4), 0);
    hold(gesture, away(), .1);
  }
  const legacy = left(); legacy[0].jointPositions = { wrist: target.clone() };
  assert.equal(hold(gesture, legacy, 2), 0);
  assert.equal(gesture.hoveredHand, null);
});

test('hidden target and disabled tearing/transition/focus cannot advance or rearm', () => {
  const gesture = new XRHelpGesture();
  hold(gesture, left(), .6);
  hold(gesture, left(), .1, null);
  assert.equal(gesture.progress, 0);
  hold(gesture, left(), .6);
  hold(gesture, left(), .1, target, false);
  assert.equal(hold(gesture, left(), .6), 0);
  assert.equal(hold(gesture, left(), .05), 1);
  hold(gesture, away(), 1, target, false);
  assert.equal(hold(gesture, left(), 1), 0);
});

test('between-frame interruption cancels dwell but preserves a completed latch', () => {
  const gesture = new XRHelpGesture();
  hold(gesture, left(), .6); gesture.cancelHold();
  assert.equal(hold(gesture, left(), .6), 0);
  assert.equal(hold(gesture, left(), .05), 1);
  gesture.cancelHold();
  assert.equal(hold(gesture, left(), 1), 0);
  gesture.reset();
  assert.equal(hold(gesture, left(), .65), 1);
});

test('paused time cannot advance and discontinuous frame times cancel a hold', () => {
  const gesture = new XRHelpGesture();
  hold(gesture, left(), .4);
  for (let i = 0; i < 300; i++) assert.equal(gesture.updateTarget(left(), target, 0, true), false);
  assert.equal(hold(gesture, left(), .25), 1);
  for (const dt of [-.01, NaN, Infinity, .2]) {
    gesture.reset(); hold(gesture, left(), .6);
    assert.equal(gesture.updateTarget(left(), target, dt, true), false);
    assert.equal(hold(gesture, left(), .6), 0);
    assert.equal(hold(gesture, left(), .05), 1);
  }
});

test('invalid targets and sample counts fail closed', () => {
  for (const position of [null, new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(0, Infinity, 0)]) {
    assert.equal(hold(new XRHelpGesture(), left(), 2, position), 0);
  }
  assert.equal(new XRHelpGesture().updateTarget([], target, .01, true), false);
});

test('hold duration is consistent across common headset refresh rates', () => {
  for (const hz of [60, 72, 80, 90, 120]) {
    const gesture = new XRHelpGesture();
    let frames = 0;
    while (!gesture.updateTarget(left(), target, 1 / hz, true) && frames < hz * 2) frames++;
    const elapsed = (frames + 1) / hz;
    assert.ok(elapsed >= XR_HELP_TARGET.dwellSeconds - 1e-9);
    assert.ok(elapsed < XR_HELP_TARGET.dwellSeconds + 1 / hz + 1e-9);
  }
});
