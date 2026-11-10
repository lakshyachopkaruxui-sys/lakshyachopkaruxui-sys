// Exercise real App entry/replay methods with controlled XR/audio boundaries.
// No WebGL, audio device or physical headset is involved.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';

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

const { App, NEXT_WORLD } = await import('../src/app/App.ts');
const { XRHelpGesture } = await import('../src/interaction/XRHelpGesture.ts');
const { PinchTracker } = await import('../src/interaction/PinchTracker.ts');
const { TearSimulation } = await import('../src/tear/TearSimulation.ts');
const { InteractionStateMachine, InteractionState } = await import('../src/state/InteractionStateMachine.ts');
const { Guide } = await import('../src/ui/Guide.ts');
const { WORLD_NAMES } = await import('../src/config/worlds.ts');

function fixture(world = 0, arrivedAt = -99) {
  const app = Object.create(App.prototype);
  const events = [];
  const session = new EventTarget();
  session.environmentBlendMode = 'alpha-blend';
  session.visibilityState = 'visible';
  session.end = async () => session.dispatchEvent(new Event('end'));
  let installed = null;
  app.renderer = {
    xr: {
      isPresenting: false, getSession: () => installed,
      async setSession(value) { installed = value; this.isPresenting = true; },
      getBaseLayer: () => ({ blendTextureSourceAlpha: true })
    },
    getContext: () => ({ getContextAttributes: () => ({ alpha: true, stencil: true }), isContextLost: () => false }),
    setClearAlpha() {}
  };
  app.mode = 'intro'; app.xrStartPromise = null;
  app.time = 12; app.timer = { update() {}, getDelta: () => .05 };
  app.openingNarrated = false; app.presentedFrames = 0; app.pendingNarration = null;
  app.pendingXRPose = false; app.xrFocusSuspended = false;
  app.narration = { play: (id, replay = false) => events.push({ id, replay }), stop() {}, startSession() {} };
  app.audio = { unlock: async () => true, setActive() {} };
  app.camera = new THREE.PerspectiveCamera(70, 1);
  app.camera.position.y = 1.65;
  app.camera.updateMatrixWorld();
  app.worlds = Array.from({ length: 4 }, () => ({
    scene: new THREE.Scene(), root: new THREE.Group(), leakColor: new THREE.Color(),
    groundAt: () => 0, update() {}, updateView() {}, refreshStencil() {}, consumeReturnHint: () => false,
    walkBounds: { center: new THREE.Vector3(), radius: 8 }
  }));
  [app.worldOne, app.worldTwo, app.worldUnderwater, app.worldThree] = app.worlds;
  app.outerIndex = world; app.nextWorld = NEXT_WORLD; app.currentWorld = WORLD_NAMES[world];
  app.arrivedAt = arrivedAt; app.swallow = -1; app.swapped = false; app.stepRequested = false;
  app.anchor = new THREE.Group(); app.worlds[world].scene.add(app.anchor);
  app.state = new InteractionStateMachine();
  app.sim = new TearSimulation(app.anchor);
  app.trackers = [new PinchTracker(), new PinchTracker()];
  app.desktopHands = {
    forceRelease() {}, update() {},
    sample: () => ({ tracked: false, thumbTip: new THREE.Vector3(), indexTip: new THREE.Vector3(), joints: [] })
  };
  app.controls = { update() {}, endFrame() {}, consumePress: () => false, ready: false };
  for (const key of ['tmpA', 'tmpB', 'tmpC', 'normal', 'gapCentre', 'tearWorld', 'viewerPosition', 'viewerDirection', 'collisionHeadBase']) app[key] = new THREE.Vector3();
  app.collisionComfortMaterial = new THREE.ShaderMaterial({ uniforms: { opacity: { value: 0 } } });
  app.collisionComfort = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), app.collisionComfortMaterial);
  app.tmpQ = new THREE.Quaternion();
  app.helpGesture = new XRHelpGesture(); app.narrationGesture = new XRHelpGesture(); app.replayGesture = new XRHelpGesture();
  const action = () => ({ position: new THREE.Vector3(), update() {} });
  app.notesTarget = action(); app.narrationTarget = action(); app.replayTarget = action();
  app.guide = { setVisible() {}, showNotesFor() {}, update() {}, flash() {} };
  app.hud = { setVisible() {}, update() {} };
  app.membrane = { sync() {} };
  app.light = app.particles = app.handVisual = app.waterThreshold = { update() {} };
  app.voice = { update() {}, rip() {} };
  app.debug = { tick: () => false }; app.soundscapes = [];
  app.portal = { render() {} };
  return { app, events, session };
}

test('fresh headset entry after a previous crossing replays the opening, not the ending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(3, 8);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { xr: { requestSession: async () => h.session } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'navigator', previous) : delete globalThis.navigator);
  await h.app.enterXR();
  // The renderer boundary above is controlled; represent its first usable pose.
  h.app.mode = 'xr'; h.app.pendingXRPose = false;
  await h.app.replayNarration();
  assert.equal(h.app.outerIndex, 0);
  assert.deepEqual(h.events, [{ id: 'opening', replay: true }]);
});

test('desktop entry settles before narrating the actual resumed world exactly once', () => {
  for (const [world, arrivedAt, expected] of [[0, -99, 'opening'], [2, 8, 'ocean'], [3, 8, 'shadow'], [1, 8, 'forest'], [0, 8, 'return']]) {
    const h = fixture(world, arrivedAt);
    h.app.enterDesktop();
    for (let frame = 0; frame < 79; frame++) h.app.tick(frame * 50);
    assert.deepEqual(h.events, [], 'entry leaves four seconds to observe');
    for (let frame = 79; frame < 90; frame++) h.app.tick(frame * 50);
    assert.deepEqual(h.events, [{ id: expected, replay: false }], WORLD_NAMES[world]);
  }
});

test('an outstanding replay cannot restart narration after XR focus is lost', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(2, 8);
  await h.app.renderer.xr.setSession(h.session);
  h.app.mode = 'xr';
  let unlock;
  h.app.audio.unlock = () => new Promise(resolve => { unlock = resolve; });
  let stops = 0;
  h.app.narration.stop = () => { stops++; };
  h.app.watchXRVisibility(h.session);
  const replay = h.app.replayNarration();
  h.session.visibilityState = 'visible-blurred';
  h.session.dispatchEvent(new Event('visibilitychange'));
  unlock(true);
  await replay;
  assert.equal(stops, 1, 'focus loss immediately stops the existing line');
  assert.deepEqual(h.events, [], 'late audio unlock cannot speak over the system menu');
});

test('outstanding replay is cancelled when the world changes or its tracked pose becomes unavailable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const interrupt of [app => app.stepThrough(), app => { app.pendingXRPose = true; }]) {
    const h = fixture(2, 8);
    h.app.mode = 'desktop';
    let unlock;
    h.app.audio.unlock = () => new Promise(resolve => { unlock = resolve; });
    const replay = h.app.replayNarration();
    interrupt(h.app);
    unlock(true);
    await replay;
    assert.deepEqual(h.events, [], 'the obsolete replay must not speak in the new context');
  }
});

test('caption plane fits narrow desktop and headset views with a visible horizontal margin', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
    const context = new Proxy({
      font: '16px serif', createRadialGradient: () => ({ addColorStop() {} }),
      measureText(text) { return { width: text.length * Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16) * .5 }; }
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    return { width: 1, height: 1, getContext: () => context };
  } } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  const guide = new Guide(new THREE.Scene());
  const viewer = new THREE.Vector3(0, 1.6, 0);
  guide.setVisible(true);
  guide.setNarrationCaption('The room is unchanged. Your perspective has widened. What you know is real. It is not the whole picture.');
  for (const xr of [false, true]) for (const halfFovH of [.1, .25, .85]) {
    guide.update({ xr, ready: true, canGrab: false, gripping: false, gripsHolding: 0,
      state: InteractionState.Idle, openness: 0, strain: 0, canStep: false,
      seamWorld: new THREE.Vector3(0, 1.2, -.7), viewer, viewerForward: new THREE.Vector3(0, 0, -1),
      halfFovH, worldName: WORLD_NAMES[0], time: 1, dt: .05 });
    const mesh = guide.caption.mesh;
    const distance = Math.hypot(mesh.position.x - viewer.x, mesh.position.z - viewer.z);
    const width = mesh.geometry.parameters.width * mesh.scale.x;
    assert.ok(width <= 2 * distance * Math.tan(halfFovH - .06) + 1e-9, `caption exceeds view at half-FOV ${halfFovH}`);
    assert.ok(guide.caption.targetOpacity > 0);
  }
});
