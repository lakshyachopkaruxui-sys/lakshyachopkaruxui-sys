// Real Three controller visibility lifecycle with deterministic XR joint poses.
// This checks the input adapter, not headset optics or native hand tracking.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { WebXRController } from 'three/src/renderers/webxr/WebXRController.js';

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

const { XRHandSource } = await import('../src/interaction/XRHandSource.ts');
const { PinchTracker } = await import('../src/interaction/PinchTracker.ts');
const { CONFIG } = await import('../src/config/config.ts');
const { App, NEXT_WORLD } = await import('../src/app/App.ts');
const { XRHelpGesture } = await import('../src/interaction/XRHelpGesture.ts');
const { TearSimulation } = await import('../src/tear/TearSimulation.ts');
const { InteractionStateMachine, InteractionState } = await import('../src/state/InteractionStateMachine.ts');

function harness(additionalJoints = []) {
  const controllers = [new WebXRController(), new WebXRController()];
  const adapter = new XRHandSource({ xr: { getHand: i => controllers[i].getHandSpace() } }, new THREE.Group());
  const sources = ['right', 'left'].map(handedness => ({
    handedness,
    hand: new Map(['wrist', 'thumb-tip', 'index-finger-tip', ...additionalJoints].map(jointName => [jointName, { jointName }]))
  }));
  controllers.forEach((controller, i) => controller.connect(sources[i]));
  const pose = (side, gap = 0.01, visibilityState = 'visible', missingJoint = '') => ({
    session: { visibilityState },
    getJointPose(joint) {
      if (joint.jointName === missingJoint) return null;
      const x = (side === 'left' ? -0.1 : 0.1) + (joint.jointName === 'index-finger-tip' ? gap : 0);
      return { transform: { matrix: new THREE.Matrix4().makeTranslation(x, 1.2, -0.5).elements }, radius: 0.005 };
    }
  });
  const update = (gap = 0.01, visibility = 'visible', missing = '') => {
    controllers.forEach((controller, i) => controller.update(sources[i], pose(sources[i].handedness, gap, visibility, missing), {}));
  };
  return { adapter, controllers, sources, update };
}

test('actual controller indices map to XR handedness and visible joint world poses', () => {
  const h = harness();
  h.update();
  assert.equal(h.adapter.sample('left').tracked, true);
  assert.equal(h.adapter.sample('right').tracked, true);
  assert.ok(h.adapter.sample('left').thumbTip.x < 0);
  assert.ok(h.adapter.sample('right').thumbTip.x > 0);
});

test('system overlay hides the hand parent even when Three retains visible tip joints', () => {
  const h = harness();
  const tracker = new PinchTracker();
  h.update();
  tracker.update(h.adapter.sample('left'), 1 / 90);
  assert.equal(tracker.pinching, true);
  h.update(0.01, 'visible-blurred');
  const hand = h.controllers[1].getHandSpace();
  assert.equal(hand.visible, false);
  assert.equal(hand.joints['thumb-tip'].visible, true, 'Three retains old per-joint visibility while blurred');
  assert.equal(h.adapter.sample('left').tracked, false, 'stale tips must not keep a pinch alive');
  for (let i = 0; i < Math.ceil(CONFIG.pinch.lostGraceSeconds * 90) + 2; i++) tracker.update(h.adapter.sample('left'), 1 / 90);
  assert.equal(tracker.tracked, false);
  assert.equal(tracker.pinching, false);
  h.update(0.05);
  tracker.update(h.adapter.sample('left'), 1 / 90);
  assert.equal(tracker.tracked, true);
  assert.equal(tracker.pinching, false, 'resumed open fingers do not inherit the old pinch');
});

test('missing fingertips and disconnected sources stop reporting tracked hands', () => {
  const h = harness();
  h.update();
  h.update(0.01, 'visible', 'index-finger-tip');
  assert.equal(h.adapter.sample('left').tracked, false);
  h.update();
  assert.equal(h.adapter.sample('left').tracked, true);
  h.controllers[1].disconnect(h.sources[1]);
  assert.equal(h.adapter.sample('left').tracked, false);
  assert.equal(h.adapter.sample('right').tracked, true);
});

test('named joint metadata clears hidden, missing and non-finite joints without changing anatomical names', () => {
  const name = 'middle-finger-phalanx-proximal';
  const h = harness([name]);
  h.update();
  const left = h.adapter.sample('left');
  assert.ok(left.jointPositions.wrist);
  assert.ok(left.jointPositions[name]);
  assert.notEqual(left.jointPositions[name], left.joints[1], 'named joints do not alias compacted dot storage');
  h.update(0.01, 'visible', name);
  assert.equal(h.adapter.sample('left').jointPositions[name], undefined);
  assert.ok(left.jointPositions['index-finger-tip']);
  h.update();
  const hand = h.controllers[1].getHandSpace();
  hand.joints[name].position.x = NaN;
  hand.joints[name].updateMatrix();
  assert.equal(h.adapter.sample('left').jointPositions[name], undefined);
  assert.ok(left.joints.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)));
  h.update(0.01, 'visible-blurred');
  assert.equal(h.adapter.sample('left').tracked, false);
  assert.deepEqual(left.jointPositions, {}, 'a hidden hand cannot keep last frame\'s help pose');
  h.update();
  assert.ok(h.adapter.sample('left').jointPositions[name]);
  h.controllers[1].disconnect(h.sources[1]);
  assert.deepEqual(h.adapter.sample('left').jointPositions, {});
});

function appHarness() {
  const app = Object.create(App.prototype);
  app.helpGesture = new XRHelpGesture();
  const session = new EventTarget();
  session.visibilityState = 'visible';
  const observation = { cameraUpdates: 0, renders: 0, poses: true, gap: 0.01 };
  app.time = 12;
  app.timer = { update() {}, getDelta: () => 0.05 };
  app.camera = new THREE.PerspectiveCamera();
  app.camera.position.y = 1.65;
  app.camera.updateMatrixWorld();
  app.renderer = { xr: {
    isPresenting: true, getSession: () => session,
    getFrame: () => ({ getViewerPose: () => observation.poses ? {} : null }),
    getReferenceSpace: () => ({}), getCamera: () => app.camera,
    updateCamera() { observation.cameraUpdates++; }
  } };
  app.mode = 'xr'; app.xrMode = 'immersive-ar';
  app.pendingXRPose = false; app.xrFocusSuspended = false;
  app.xrAwaitingRelease = [false, false];
  app.worlds = Array.from({ length: 4 }, () => ({
    scene: new THREE.Scene(), root: new THREE.Group(), leakColor: new THREE.Color(),
    groundAt: () => 0, update() {}, refreshStencil() {}, alignTo() {},
    walkBounds: { center: new THREE.Vector3(), radius: 8 }
  }));
  [app.worldOne, app.worldTwo, app.worldUnderwater, app.worldThree] = app.worlds;
  app.worldThree.updateView = () => {};
  app.worldThree.consumeReturnHint = () => false;
  app.outerIndex = 0; app.nextWorld = NEXT_WORLD;
  app.currentWorld = 'The World of Stillness';
  app.anchor = new THREE.Group();
  app.anchor.position.set(0, 1.2, -0.5);
  app.worldOne.scene.add(app.anchor);
  app.overlay = new THREE.Scene(); app.maskScene = new THREE.Scene();
  app.swallow = -1; app.swapped = false; app.arrivedAt = -99; app.stepRequested = false;
  app.state = new InteractionStateMachine();
  app.trackers = [new PinchTracker(), new PinchTracker()];
  app.sim = new TearSimulation(app.anchor);
  app.xrHands = { sample(side) {
    const x = side === 'left' ? -0.02 : 0.02;
    return { tracked: true, thumbTip: new THREE.Vector3(x, 1.2, -0.5),
      indexTip: new THREE.Vector3(x, 1.2 + observation.gap, -0.5), joints: [] };
  } };
  app.desktopHands = { forceRelease() {} };
  app.controls = { endFrame() {}, ready: false };
  for (const key of ['tmpA', 'tmpB', 'tmpC', 'normal', 'gapCentre', 'tearWorld', 'viewerPosition', 'viewerDirection']) app[key] = new THREE.Vector3();
  app.tmpQ = new THREE.Quaternion();
  app.membrane = { sync() {} };
  app.light = app.particles = app.creature = app.handVisual = app.guide = { update() {}, flash() {} };
  app.waterThreshold = { update() {}, reset() {} };
  app.voice = { update() {}, rip() {} };
  app.debug = { tick: () => false };
  app.soundscapes = [];
  app.portal = { render() { observation.renders++; } };
  app.spectator = { render() {} };
  app.watchXRVisibility(session);
  const visibility = value => { session.visibilityState = value; session.dispatchEvent(new Event('visibilitychange')); };
  return { app, session, observation, visibility };
}

test('a system-menu event with no intervening XR frame clears a held tear and its crossing timer', () => {
  const h = appHarness();
  h.app.tick(0);
  assert.equal(h.app.sim.gripsHolding, 2);
  h.app.state.state = InteractionState.FullyOpen;
  h.app.state.timeInState = 1.19;
  h.visibility('hidden');
  assert.equal(h.app.xrFocusSuspended, true);
  assert.equal(h.app.sim.gripsHolding, 0);
  assert.equal(h.app.state.timeInState, 0);
  assert.equal(h.app.state.state, InteractionState.Idle);
  assert.deepEqual(h.app.xrAwaitingRelease, [true, true]);
  h.visibility('visible');
  h.app.tick(5000);
  assert.equal(h.app.swallow, -1);
  assert.equal(h.app.sim.gripsHolding, 0, 'still-pinched fingers cannot revive the old tear');
  h.observation.gap = 0.05;
  h.app.tick(5010);
  assert.deepEqual(h.app.xrAwaitingRelease, [false, false]);
  h.observation.gap = 0.01;
  h.app.tick(5020);
  assert.equal(h.app.sim.gripsHolding, 2, 'a deliberate fresh pinch works after opening both hands');
});

test('blurred frames follow head motion but freeze world time and an already-started crossing', () => {
  const h = appHarness();
  h.app.swallow = 1.07; // next live tick would cross the 72% world-swap boundary
  const beforeTime = h.app.time;
  h.visibility('visible-blurred');
  for (let frame = 0; frame < 80; frame++) h.app.tick(frame * 50);
  assert.equal(h.observation.cameraUpdates, 80);
  assert.equal(h.observation.renders, 80);
  assert.equal(h.app.time, beforeTime);
  assert.equal(h.app.swallow, 1.07);
  assert.equal(h.app.outerIndex, 0);
  assert.equal(h.app.swapped, false);
  h.visibility('visible');
  h.app.tick(5000);
  assert.equal(h.app.time, beforeTime, 'resuming frame discards the hidden interval');
  assert.equal(h.app.swallow, 1.07);
  h.app.tick(5050);
  assert.equal(h.app.outerIndex, 1);
  assert.equal(h.app.swapped, true, 'the existing crossing resumes exactly once');
});

test('lost viewer pose pauses safely and requires fresh hand release after tracking returns', () => {
  const h = appHarness();
  h.app.tick(0);
  const time = h.app.time;
  h.observation.poses = false;
  h.app.tick(50);
  assert.equal(h.app.time, time);
  assert.equal(h.app.sim.gripsHolding, 0);
  assert.equal(h.observation.renders, 1, 'an invalid head pose is never rendered');
  h.observation.poses = true;
  h.app.tick(5000);
  assert.equal(h.app.time, time);
  assert.equal(h.app.sim.gripsHolding, 0);
  assert.deepEqual(h.app.xrAwaitingRelease, [true, true]);
});

test('ended sessions release visibility listeners instead of affecting the next journey', () => {
  const h = appHarness();
  h.session.dispatchEvent(new Event('end'));
  h.visibility('hidden');
  assert.equal(h.app.xrFocusSuspended, false);
});

test('App routes help to the tracked head, and blocks it during tearing, crossing and focus loss', () => {
  const h = appHarness();
  h.observation.gap = 0.06;
  const toggles = [], gates = [];
  let cancellations = 0;
  h.app.helpGesture = {
    update(samples, head, forward, dt, enabled) {
      assert.equal(samples.length, 2);
      assert.ok(head.equals(h.app.camera.getWorldPosition(new THREE.Vector3())));
      assert.ok(forward.distanceTo(h.app.camera.getWorldDirection(new THREE.Vector3())) < 1e-8);
      gates.push(enabled);
      return enabled;
    },
    cancelHold() { cancellations++; }
  };
  h.app.guide = { update() {}, flash() {}, toggleNotes(head, forward, now) {
    toggles.push({ head: head.clone(), forward: forward.clone(), now });
  } };
  h.app.camera.rotation.y = 0.7;
  h.app.camera.updateMatrixWorld();
  h.app.tick(0);
  assert.equal(toggles.length, 1);
  assert.equal(toggles[0].now, h.app.time);
  h.observation.gap = 0.01;
  h.app.tick(50);
  assert.equal(gates.at(-1), false, 'pinching/tearing cannot summon help');
  h.observation.gap = 0.06;
  h.app.swallow = 0.1;
  h.app.tick(100);
  assert.equal(gates.at(-1), false, 'crossing cannot summon help');
  h.visibility('visible-blurred');
  h.app.tick(150);
  assert.equal(gates.at(-1), false);
  assert.equal(cancellations, 1, 'an interruption cancels the pending hold');
  assert.equal(toggles.length, 1);
});
