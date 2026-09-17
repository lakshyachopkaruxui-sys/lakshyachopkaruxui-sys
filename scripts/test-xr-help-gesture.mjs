// Anatomical gesture tests; these do not simulate the Quest's optical tracking.
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
const { XRHelpGesture } = await import('../src/interaction/XRHelpGesture.ts');

const head = new THREE.Vector3(0, 1.65, 0);
const forward = new THREE.Vector3(0, 0, -1);
const fingerNames = ['index', 'middle', 'ring', 'pinky'];

function openHand(side) {
  const sign = side === 'left' ? 1 : -1;
  const wrist = new THREE.Vector3(-sign * 0.18, 1.20, -0.38);
  const pose = { wrist };
  const point = (x, y, z = 0) => wrist.clone().add(new THREE.Vector3(sign * x, y, z));
  const xs = [0.028, 0, -0.019, -0.032];
  const ys = [0.077, 0.085, 0.077, 0.058];
  fingerNames.forEach((finger, i) => {
    const name = `${finger}-finger-`;
    pose[`${name}metacarpal`] = point(xs[i] * 0.6, 0.022);
    pose[`${name}phalanx-proximal`] = point(xs[i], ys[i]);
    pose[`${name}phalanx-intermediate`] = point(xs[i], ys[i] + 0.035);
    pose[`${name}phalanx-distal`] = point(xs[i], ys[i] + 0.057);
    pose[`${name}tip`] = point(xs[i], ys[i] + 0.075);
  });
  pose['thumb-metacarpal'] = point(0.025, 0.022);
  pose['thumb-phalanx-proximal'] = point(0.052, 0.038);
  pose['thumb-phalanx-distal'] = point(0.078, 0.046);
  pose['thumb-tip'] = point(0.102, 0.050);
  return {
    tracked: true, thumbTip: pose['thumb-tip'], indexTip: pose['index-finger-tip'],
    joints: Object.values(pose), jointPositions: pose
  };
}

const hands = () => [openHand('left'), openHand('right')];
function hold(gesture, samples, seconds, viewer = head, direction = forward, enabled = true) {
  let events = 0;
  for (let frame = 0; frame < Math.round(seconds * 90); frame++) {
    if (gesture.update(samples, viewer, direction, 1 / 90, enabled)) events++;
  }
  return events;
}
function transformHand(hand, matrix) {
  Object.values(hand.jointPositions).forEach(point => point.applyMatrix4(matrix));
}
function curled(hand, finger = 'middle') {
  const pose = hand.jointPositions;
  const base = pose[`${finger}-finger-phalanx-proximal`];
  pose[`${finger}-finger-phalanx-intermediate`].copy(base).add(new THREE.Vector3(0, 0.030, 0));
  pose[`${finger}-finger-phalanx-distal`].copy(base).add(new THREE.Vector3(0, 0.030, 0.022));
  pose[`${finger}-finger-tip`].copy(base).add(new THREE.Vector3(0, 0.012, 0.022));
}

test('two relaxed open palms emit once after a continuous 1.5-second hold', () => {
  const gesture = new XRHelpGesture();
  const samples = hands();
  assert.equal(hold(gesture, samples, 1.4), 0);
  assert.equal(hold(gesture, samples, 0.1), 1);
  assert.equal(hold(gesture, samples, 10), 0, 'held palms cannot close the newly opened help');
});

test('gesture follows a translated, yaw-rotated and pitched viewer', () => {
  const gesture = new XRHelpGesture();
  const samples = hands();
  const turn = new THREE.Matrix4().makeRotationY(1.9);
  turn.setPosition(3.1, 0.3, -4.2);
  samples.forEach(hand => transformHand(hand, turn));
  const viewer = head.clone().applyMatrix4(turn);
  const direction = forward.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.22)
    .transformDirection(turn);
  assert.equal(hold(gesture, samples, 1.5, viewer, direction), 1);
});

test('naturally spread thumbs can bend at the first knuckle without needing a rigid hand pose', () => {
  const samples = hands();
  samples.forEach((hand, i) => {
    const pose = hand.jointPositions;
    const sign = i === 0 ? 1 : -1;
    pose['thumb-phalanx-proximal'].copy(pose['thumb-metacarpal']).add(new THREE.Vector3(sign * 0.018, 0.029, 0));
    pose['thumb-phalanx-distal'].copy(pose['thumb-phalanx-proximal']).add(new THREE.Vector3(sign * 0.027, 0.003, 0));
    pose['thumb-tip'].copy(pose['thumb-phalanx-distal']).add(new THREE.Vector3(sign * 0.020, -0.004, 0));
  });
  assert.equal(hold(new XRHelpGesture(), samples, 1.5), 1);
  const pose = samples[0].jointPositions;
  pose['thumb-tip'].copy(pose['thumb-phalanx-distal']).add(new THREE.Vector3(0, 0, 0.020));
  assert.equal(hold(new XRHelpGesture(), samples, 2), 0, 'a sharply curled distal thumb is not an open palm');
});

test('one palm, turned-away palms, curled fingers and pinching cannot trigger help', () => {
  for (const mutate of [
    s => { s[1].tracked = false; },
    s => curled(s[0], 'index'),
    s => curled(s[1], 'middle'),
    s => curled(s[0], 'ring'),
    s => curled(s[1], 'pinky'),
    s => { s[1].thumbTip.copy(s[1].indexTip).add(new THREE.Vector3(0.01, 0, 0)); },
    s => {
      s.forEach(hand => {
        const wrist = hand.jointPositions.wrist.clone();
        Object.values(hand.jointPositions).forEach(p => p.sub(wrist).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).add(wrist));
      });
    }
  ]) {
    const samples = hands(); mutate(samples);
    assert.equal(hold(new XRHelpGesture(), samples, 3), 0);
  }
});

test('behind-head, extended-arm and out-of-view poses are rejected', () => {
  for (const delta of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -0.9), new THREE.Vector3(0, -0.55, 0)]) {
    const samples = hands();
    samples.forEach(hand => transformHand(hand, new THREE.Matrix4().makeTranslation(...delta.toArray())));
    assert.equal(hold(new XRHelpGesture(), samples, 2), 0);
  }
  assert.equal(hold(new XRHelpGesture(), hands(), 2, head, new THREE.Vector3(0, 0, 1)), 0);
});

test('lost tracking and a missing joint restart the entire dwell without reusing old poses', () => {
  for (const lose of [
    samples => { samples[0].tracked = false; },
    samples => { delete samples[1].jointPositions['ring-finger-phalanx-distal']; },
    samples => { samples[0].jointPositions['wrist'].x = NaN; }
  ]) {
    const gesture = new XRHelpGesture();
    const samples = hands();
    assert.equal(hold(gesture, samples, 1.4), 0);
    lose(samples);
    assert.equal(hold(gesture, samples, 0.2), 0);
    assert.equal(hold(gesture, hands(), 1.4), 0);
    assert.equal(hold(gesture, hands(), 0.1), 1);
  }
});

test('release then a new deliberate hold re-arms, but lost tracking does not count as release', () => {
  const gesture = new XRHelpGesture();
  assert.equal(hold(gesture, hands(), 1.5), 1);
  const lost = hands(); lost[0].tracked = false;
  hold(gesture, lost, 0.3);
  assert.equal(hold(gesture, hands(), 2), 0);
  const released = hands(); curled(released[0]);
  hold(gesture, released, 0.1);
  assert.equal(hold(gesture, hands(), 1.5), 1);
});

test('disabled phases cancel partial dwell and retain a completed-gesture latch', () => {
  const gesture = new XRHelpGesture();
  hold(gesture, hands(), 1.4);
  hold(gesture, hands(), 0.1, head, forward, false);
  assert.equal(hold(gesture, hands(), 1.4), 0);
  assert.equal(hold(gesture, hands(), 0.1), 1);
  hold(gesture, hands(), 1, head, forward, false);
  assert.equal(hold(gesture, hands(), 2), 0);
  gesture.reset();
  assert.equal(hold(gesture, hands(), 1.5), 1, 'a new session can deliberately request help again');
});

test('an out-of-frame focus event cancels pending dwell without releasing a held gesture', () => {
  const gesture = new XRHelpGesture();
  hold(gesture, hands(), 1.4);
  gesture.cancelHold();
  assert.equal(hold(gesture, hands(), 1.4), 0);
  assert.equal(hold(gesture, hands(), 0.1), 1);
  gesture.cancelHold();
  assert.equal(hold(gesture, hands(), 2), 0);
  const released = hands(); curled(released[0]);
  hold(gesture, released, 0.1);
  assert.equal(hold(gesture, hands(), 1.4), 0);
  assert.equal(hold(gesture, hands(), 0.1), 1);
});

test('paused time never advances; invalid or discontinuous time restarts a partial hold', () => {
  const gesture = new XRHelpGesture();
  hold(gesture, hands(), 1);
  for (let frame = 0; frame < 300; frame++) assert.equal(gesture.update(hands(), head, forward, 0, true), false);
  assert.equal(hold(gesture, hands(), 0.5), 1);
  for (const dt of [0.4, Infinity, NaN, -0.01]) {
    gesture.reset(); hold(gesture, hands(), 1.4);
    assert.equal(gesture.update(hands(), head, forward, dt, true), false);
    assert.equal(hold(gesture, hands(), 1.4), 0);
    assert.equal(hold(gesture, hands(), 0.1), 1);
  }
});

test('invalid viewer inputs, degenerate anatomy and legacy samples fail closed', () => {
  for (const [viewer, direction] of [[new THREE.Vector3(NaN, 0, 0), forward], [head, new THREE.Vector3()], [head, new THREE.Vector3(0, Infinity, 0)]]) {
    assert.equal(hold(new XRHelpGesture(), hands(), 2, viewer, direction), 0);
  }
  const noPose = hands(); delete noPose[0].jointPositions;
  assert.equal(hold(new XRHelpGesture(), noPose, 2), 0);
  const zeroBones = hands();
  Object.values(zeroBones[1].jointPositions).forEach(point => point.copy(zeroBones[1].jointPositions.wrist));
  assert.equal(hold(new XRHelpGesture(), zeroBones, 2), 0);
  assert.equal(new XRHelpGesture().update([], head, forward, 1 / 90, true), false);
});
