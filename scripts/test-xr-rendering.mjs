// Controlled renderer/session regression checks, not a physical-headset or GPU test.
// Run with Node 22.15+ (or Node 24): node scripts/test-xr-rendering.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { WebGLBackground } from 'three/src/renderers/webgl/WebGLBackground.js';
import { WebGLTextures } from 'three/src/renderers/webgl/WebGLTextures.js';

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

const { PortalRenderer } = await import('../src/portal/PortalRenderer.ts');
const { App, NEXT_WORLD } = await import('../src/app/App.ts');
const { XRHelpGesture } = await import('../src/interaction/XRHelpGesture.ts');
const { WorldOne } = await import('../src/worlds/WorldOne.ts');
const { Creature } = await import('../src/worlds/Creature.ts');
const { InteractionStateMachine } = await import('../src/state/InteractionStateMachine.ts');

function controlledRenderer(blendMode = 'alpha-blend', presenting = true) {
  let clearAlpha = -1;
  let pixel = [0, 0, 0, 0];
  let stencil = 0;
  const clears = [];
  const draws = [];
  const state = {
    buffers: {
      color: { setClear: (_r, _g, _b, alpha) => { clearAlpha = alpha; }, setMask() {} },
      depth: { setTest() {}, setMask() {} }
    }
  };
  const renderer = {
    autoClear: true,
    outputColorSpace: THREE.LinearSRGBColorSpace,
    xr: {
      isPresenting: presenting,
      getEnvironmentBlendMode: () => blendMode,
      getSession: () => presenting ? { environmentBlendMode: blendMode } : null
    },
    getRenderTarget: () => null,
    setClearAlpha: alpha => background.setClearAlpha(alpha),
    clear: () => { clears.push(clearAlpha); pixel = [0, 0, 0, clearAlpha]; stencil = 0; },
    render(scene) {
      // Use the installed Three.js implementation, including its alpha-blend
      // clear-alpha override, rather than replacing it with an assumed behavior.
      background.render(scene);
      draws.push(scene);
      if (scene.userData.sampleRGBA) pixel = [...scene.userData.sampleRGBA];
      if (scene.userData.sampleStencil !== undefined) stencil = scene.userData.sampleStencil;
      const mesh = scene.children[0];
      if (mesh?.material?.blendSrcAlpha === THREE.OneFactor &&
        mesh.material.blendDstAlpha === THREE.ZeroFactor) {
        const material = mesh.material;
        assert.equal(material.blending, THREE.CustomBlending);
        assert.equal(material.blendEquation, THREE.AddEquation);
        assert.equal(material.blendEquationAlpha, THREE.AddEquation);
        assert.equal(material.depthTest, false);
        assert.equal(material.depthWrite, false);
        assert.equal(mesh.frustumCulled, false);
        assert.ok(mesh.layers.isEnabled(1) && mesh.layers.isEnabled(2));
        // Apply the configured blend equation to a representative fragment.
        // GPU shader execution and actual stereo coverage need device validation.
        if (material.stencilWrite) {
          assert.equal(material.blendSrc, THREE.OneFactor);
          assert.equal(material.blendDst, THREE.ZeroFactor);
          assert.equal(material.colorWrite, true);
          assert.equal(material.stencilFunc, THREE.EqualStencilFunc);
          assert.equal(material.stencilRef, 1);
          assert.equal(material.stencilFuncMask, 0xff);
          assert.equal(material.stencilWriteMask, 0);
          assert.equal(material.stencilFail, THREE.KeepStencilOp);
          assert.equal(material.stencilZFail, THREE.KeepStencilOp);
          assert.equal(material.stencilZPass, THREE.KeepStencilOp);
          assert.match(material.fragmentShader, /gl_FragColor\s*=\s*vec4\(0\.0\)/);
          if (stencil === 1) pixel = [0, 0, 0, 0];
        } else {
          assert.equal(material.blendSrc, THREE.ZeroFactor);
          assert.equal(material.blendDst, THREE.OneFactor);
          pixel = [pixel[0], pixel[1], pixel[2], 1];
        }
      }
    }
  };
  const background = WebGLBackground(renderer, null, state, null, true, true);
  return { renderer, clears, draws, get pixel() { return pixel; }, get clearAlpha() { return clearAlpha; } };
}

test('live-room phase clears alpha 0 and never draws an opaque cover', () => {
  const mock = controlledRenderer();
  const portal = new PortalRenderer(mock.renderer);
  const passes = [new THREE.Scene(), new THREE.Scene()];
  portal.render(new THREE.PerspectiveCamera(), passes, 'passthrough');
  assert.deepEqual(mock.clears, [0]);
  assert.deepEqual(mock.draws, passes);
  assert.equal(mock.pixel[3], 0);
});

test('virtual phase seals final alpha while preserving RGB despite Three alpha-blend override', () => {
  const mock = controlledRenderer();
  const portal = new PortalRenderer(mock.renderer);
  const passes = Array.from({ length: 4 }, () => new THREE.Scene());
  passes[3].userData.sampleRGBA = [0.17, 0.31, 0.63, 0.24];
  portal.render(new THREE.PerspectiveCamera(), passes, 'opaque');
  assert.deepEqual(mock.clears, [1]);
  assert.equal(mock.clearAlpha, 0, 'installed Three overrides the GL clear value during rendering');
  assert.deepEqual(mock.draws.slice(0, 4), passes, 'portal order is unchanged');
  assert.equal(mock.draws.length, 5, 'opacity is enforced after all world and overlay draws');
  assert.deepEqual(mock.pixel, [0.17, 0.31, 0.63, 1]);
});

test('the next live-room frame restores transparent output after a virtual frame', () => {
  const mock = controlledRenderer();
  const portal = new PortalRenderer(mock.renderer);
  const camera = new THREE.PerspectiveCamera();
  portal.render(camera, [new THREE.Scene()], 'opaque');
  portal.render(camera, [new THREE.Scene()], 'passthrough');
  assert.deepEqual(mock.clears, [1, 0]);
  assert.equal(mock.pixel[3], 0);
});

test('desktop output keeps its existing passes without an additional XR opacity draw', () => {
  const mock = controlledRenderer(undefined, false);
  const portal = new PortalRenderer(mock.renderer);
  const passes = [new THREE.Scene(), new THREE.Scene()];
  portal.render(new THREE.PerspectiveCamera(), passes);
  assert.deepEqual(mock.draws, passes);
});

test('return tear reveals the real room only inside stencil 1 and clears premultiplied RGB', () => {
  for (const stencil of [0, 1, 2]) {
    const mock = controlledRenderer();
    const portal = new PortalRenderer(mock.renderer);
    const passes = Array.from({ length: 4 }, () => new THREE.Scene());
    passes[1].userData.sampleStencil = stencil;
    passes[3].userData.sampleRGBA = [0.35, 0.16, 0.47, 0.28];
    portal.render(new THREE.PerspectiveCamera(), passes, 'portal-passthrough');
    assert.deepEqual(mock.clears, [1]);
    assert.equal(mock.draws.length, 6, 'seal full output, then cut out only the portal');
    assert.deepEqual(mock.pixel, stencil === 1 ? [0, 0, 0, 0] : [0.35, 0.16, 0.47, 1]);
  }
});

test('closing a return tear restores opaque output without carrying its old stencil forward', () => {
  const mock = controlledRenderer();
  const portal = new PortalRenderer(mock.renderer);
  const camera = new THREE.PerspectiveCamera();
  const mask = new THREE.Scene();
  mask.userData.sampleStencil = 1;
  portal.render(camera, [mask], 'portal-passthrough');
  assert.equal(mock.pixel[3], 0);
  const outer = new THREE.Scene();
  outer.userData.sampleRGBA = [0.2, 0.15, 0.4, 0.12];
  portal.render(camera, [outer], 'opaque');
  assert.deepEqual(mock.pixel, [0.2, 0.15, 0.4, 1]);
});

test('the return cutout never runs for desktop or opaque VR output', () => {
  for (const [blendMode, presenting] of [['opaque', true], ['opaque', false]]) {
    const mock = controlledRenderer(blendMode, presenting);
    const passes = [new THREE.Scene()];
    new PortalRenderer(mock.renderer).render(new THREE.PerspectiveCamera(), passes, 'portal-passthrough');
    assert.deepEqual(mock.draws, passes);
    assert.deepEqual(mock.clears, [1]);
  }
});

// Exercise installed Three's actual resolve/invalidate code. The controlled GL
// records attachment lifetime; this is not a GPU or physical headset test.
function questBufferHarness({ extension = true, externalDepth = false } = {}) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (Quest 3S) OculusBrowser/38.0' }
  });
  const invalidations = [];
  const order = [];
  const values = new WeakMap();
  const properties = {
    get(object) {
      if (!values.has(object)) values.set(object, {});
      return values.get(object);
    }
  };
  const gl = {
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
    DRAW_FRAMEBUFFER: 0x8ca9,
    READ_FRAMEBUFFER: 0x8ca8,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    STENCIL_BUFFER_BIT: 0x0400,
    NEAREST: 0x2600,
    blitFramebuffer() {},
    invalidateFramebuffer(_framebuffer, attachments) { invalidations.push(...attachments); }
  };
  const extensions = { has: () => extension, get: () => ({}) };
  const textures = new WebGLTextures(gl, extensions, { bindFramebuffer() {} }, properties, { maxSamples: 4 }, {}, {});
  const target = new THREE.WebGLRenderTarget(100, 100, {
    samples: 4, stencilBuffer: true,
    resolveDepthBuffer: externalDepth, resolveStencilBuffer: externalDepth,
    storeMultisampledDepthBuffer: externalDepth,
    storeMultisampledStencilBuffer: externalDepth
  });
  target.isXRRenderTarget = true;
  if (externalDepth) properties.get(target).__useRenderToTexture = false;
  const mock = controlledRenderer();
  const render = mock.renderer.render;
  const clear = mock.renderer.clear;
  Object.assign(mock.renderer, {
    extensions,
    getRenderTarget: () => target,
    setRenderTarget(value) { assert.equal(value, target); order.push('rebind'); },
    clear() { order.push('clear'); clear(); },
    render(scene, camera) {
      order.push('render');
      render(scene, camera);
      textures.updateMultisampleRenderTarget(target);
    }
  });
  mock.renderer.xr.enabled = true;
  return { ...mock, target, textures, invalidations, order, gl };
}

test('installed Three reproduces Quest discarding a portal stencil between scene passes', () => {
  const h = questBufferHarness();
  h.textures.updateMultisampleRenderTarget(h.target);
  assert.ok(h.invalidations.includes(h.gl.DEPTH_STENCIL_ATTACHMENT));
});

test('Quest render-to-texture preserves portal depth/stencil and keeps antialiasing', () => {
  const h = questBufferHarness();
  new PortalRenderer(h.renderer).render(new THREE.PerspectiveCamera(), Array.from({ length: 4 }, () => new THREE.Scene()));
  assert.deepEqual(h.invalidations, [], 'no pass may discard attachments used by a later pass');
  assert.equal(h.target.samples, 4, 'ordinary Quest MSAA remains enabled');
  assert.equal(h.target.storeMultisampledDepthBuffer, true);
  assert.equal(h.target.storeMultisampledStencilBuffer, true);
  assert.ok(!h.order.includes('rebind'));
});

test('Quest separate-MSAA fallback avoids colour loss and rebinds before clearing', () => {
  for (const options of [{ extension: false }, { extension: true, externalDepth: true }]) {
    const h = questBufferHarness(options);
    h.target.storeMultisampledDepthBuffer = true;
    h.target.storeMultisampledStencilBuffer = true;
    h.target.storeMultisampledColorBuffer = true;
    h.textures.updateMultisampleRenderTarget(h.target);
    assert.ok(h.invalidations.includes(h.gl.COLOR_ATTACHMENT0), 'Three fallback ignores its colour-storage intent');
    h.invalidations.length = 0;
    new PortalRenderer(h.renderer).render(new THREE.PerspectiveCamera(), Array.from({ length: 4 }, () => new THREE.Scene()), 'portal-passthrough');
    assert.equal(h.target.samples, 0);
    assert.deepEqual(h.order.slice(0, 2), ['rebind', 'clear']);
    assert.deepEqual(h.invalidations, [], 'both colour and portal mask survive all six passes');
  }
});

test('ordinary non-XR render targets retain their existing storage and samples', () => {
  const h = questBufferHarness({ extension: false });
  h.target.isXRRenderTarget = false;
  new PortalRenderer(h.renderer).render(new THREE.PerspectiveCamera(), []);
  assert.equal(h.target.samples, 4);
  assert.equal(h.target.storeMultisampledDepthBuffer, false);
  assert.ok(!h.order.includes('rebind'));
});

function sessionHarness(blendMode) {
  const requests = [];
  let ended = 0;
  let installed = null;
  const session = { environmentBlendMode: blendMode, end: async () => { ended++; } };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { xr: { requestSession: async (mode, features) => { requests.push({ mode, features }); return session; } } }
  });
  const app = Object.create(App.prototype);
  app.helpGesture = new XRHelpGesture();
  app.xrStartPromise = null;
  app.renderer = {
    xr: { isPresenting: false, getSession: () => null, setSession: async value => { installed = value; } },
    setClearAlpha() {}
  };
  app.worldOne = { scene: new THREE.Scene(), root: new THREE.Group() };
  app.anchor = new THREE.Group();
  app.desktopHands = { forceRelease() {} };
  app.sim = { reset() {} };
  app.worlds = Array.from({ length: 4 }, () => ({ stencilLayer: 1, refreshStencil() {} }));
  return { app, requests, session, get ended() { return ended; }, get installed() { return installed; } };
}

test('public headset entry defaults to immersive-ar, hides the virtual room, and requests tracked hands', async () => {
  const h = sessionHarness('alpha-blend');
  await h.app.enterXR();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].mode, 'immersive-ar');
  assert.ok(h.requests[0].features.requiredFeatures.includes('hand-tracking'));
  assert.equal(h.app.worldOne.root.visible, false);
  assert.equal(h.app.outerIndex, 0);
  assert.equal(h.app.currentWorld, 'The World of Stillness');
  assert.equal(h.installed, h.session);
  assert.equal(h.ended, 0);
});

test('headset entry rejects non-passthrough output without silently requesting VR', async () => {
  const h = sessionHarness('opaque');
  await assert.rejects(h.app.enterXR(), /Live-room passthrough is required/);
  assert.deepEqual(h.requests.map(request => request.mode), ['immersive-ar']);
  assert.equal(h.ended, 1);
  assert.equal(h.installed, null);
  assert.equal(h.app.worldOne.root.visible, true);
  assert.equal(h.app.xrStartPromise, null);
});

test('desktop bounds follow the aligned destination instead of the old world origin', () => {
  const app = Object.create(App.prototype);
  app.helpGesture = new XRHelpGesture();
  const center = new THREE.Vector3(31, 0, -18);
  app.worlds = [{ walkBounds: { center, radius: 8 } }];
  app.outerIndex = 0;
  app.controls = {};
  app.applyWalkBounds();
  assert.deepEqual(app.controls.bounds.centre.toArray(), [31, 0, -18]);
  assert.equal(app.controls.bounds.radius, 8);
  assert.notEqual(app.controls.bounds.centre, center, 'controls must not mutate the world bound');
});

function creatureAt(offset) {
  const creature = Object.create(Creature.prototype);
  const parent = new THREE.Group();
  parent.position.copy(offset);
  creature.group = new THREE.Group();
  creature.group.position.set(2, 0, -4);
  parent.add(creature.group);
  creature.body = new THREE.Group();
  creature.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3), new THREE.MeshBasicMaterial());
  creature.group.add(creature.body, creature.shadow);
  for (const key of ['tmp', 'localTear', 'localForward', 'localPlayer', 'target', 'station', 'home']) creature[key] = new THREE.Vector3();
  creature.parentInverse = new THREE.Matrix4();
  creature.perch = new THREE.Vector3(0.3, 0.6, -2);
  creature.state = 'guide';
  creature.stateTime = creature.wave = creature.hopPhase = creature.speed = 0;
  creature.ready = true;
  creature.rng = () => 0.5;
  creature.groundAt = (x, z) => 0.01 * x - 0.02 * z;
  return creature;
}

test('creature behavior is invariant when forest, tear and viewer translate together', () => {
  const offset = new THREE.Vector3(36, 0, -27);
  const original = creatureAt(new THREE.Vector3());
  const translated = creatureAt(offset);
  const tear = new THREE.Vector3(0, 1.3, -0.7);
  const viewer = new THREE.Vector3(0, 1.6, 0);
  const normal = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < 10; i++) {
    original.update(1 / 90, i / 90, tear, normal, 0.8, 0.2, true, viewer);
    translated.update(1 / 90, i / 90, tear.clone().add(offset), normal, 0.8, 0.2, true, viewer.clone().add(offset));
  }
  assert.ok(original.group.position.distanceTo(translated.group.position) < 1e-10);
  assert.ok(original.target.distanceTo(translated.target) < 1e-10);
  assert.ok(original.group.quaternion.angleTo(translated.group.quaternion) < 1e-7);
  assert.deepEqual(tear.toArray(), [0, 1.3, -0.7], 'world inputs remain unchanged');
});

function transitionHarness(outerIndex = 0, inXR = false) {
  const app = Object.create(App.prototype);
  app.helpGesture = new XRHelpGesture();
  const observations = { passes: [], output: '', maskScale: 0, maskParent: null, nextAudio: [], views: [], water: [] };
  app.time = 0;
  app.timer = { update() {}, getDelta: () => 0.05 };
  const session = { environmentBlendMode: 'alpha-blend', visibilityState: 'visible', end: () => assert.fail('journey must keep its XR session') };
  app.renderer = { xr: {
    isPresenting: inXR,
    getSession: () => inXR ? session : null,
    getFrame: () => ({ getViewerPose: () => ({}) }),
    getReferenceSpace: () => ({}),
    updateCamera() {}, getCamera: () => app.camera
  } };
  app.mode = inXR ? 'xr' : 'intro';
  app.xrMode = 'immersive-ar';
  app.xrFocusSuspended = false;
  app.xrAwaitingRelease = [false, false];
  app.camera = new THREE.PerspectiveCamera();
  app.camera.position.y = 1.65;
  app.camera.updateMatrixWorld();
  app.worlds = Array.from({ length: 4 }, () => ({
    scene: new THREE.Scene(), leakColor: new THREE.Color(0xffffff),
    root: new THREE.Group(),
    groundAt: () => 0, update() {}, refreshStencil() {}, alignTo() {},
    walkBounds: { center: new THREE.Vector3(), radius: 8 }
  }));
  app.outerIndex = outerIndex;
  app.nextWorld = NEXT_WORLD;
  app.worldOne = app.worlds[0];
  app.worldTwo = app.worlds[1];
  app.worldUnderwater = app.worlds[2];
  app.worldThree = app.worlds[3];
  app.worldThree.updateView = (position, direction, active, dt) => observations.views.push({ position: position.clone(), direction: direction.clone(), active, dt });
  app.worldThree.consumeReturnHint = () => false;
  app.anchor = new THREE.Group();
  app.worlds[outerIndex].scene.add(app.anchor);
  app.overlay = new THREE.Scene();
  app.maskScene = new THREE.Scene();
  app.swallow = 1.07;
  app.swapped = false;
  app.stepRequested = false;
  app.state = new InteractionStateMachine();
  app.trackers = [0, 1].map(() => ({ update() {}, tracked: false, pinching: false }));
  app.desktopHands = { sample() { return { tracked: false, thumbTip: new THREE.Vector3(), indexTip: new THREE.Vector3(), joints: [] }; }, forceRelease() {} };
  app.xrHands = app.desktopHands;
  app.spectator = { render() {} };
  app.controls = { endFrame() {}, ready: false };
  for (const key of ['tmpA', 'tmpB', 'tmpC', 'normal', 'gapCentre', 'tearWorld', 'viewerPosition', 'viewerDirection']) app[key] = new THREE.Vector3();
  app.tmpQ = new THREE.Quaternion();
  app.sim = {
    update() {}, gripsHolding: 2, gap: 0.6, centre: new THREE.Vector2(),
    tornLength: 0.6, openness: 1, crackOpenness: 1, energy: 0, strain: 0,
    releaseSuspended: false,
    grips: [0, 1].map(() => ({ holding: true, weight: 1, disp: new THREE.Vector3() })),
    reset() { this.gripsHolding = this.gap = this.tornLength = this.openness = this.crackOpenness = 0; }
  };
  app.membrane = { sync() { observations.maskScale = app.anchor.scale.x; observations.maskParent = app.anchor.parent; } };
  app.light = app.particles = app.creature = app.handVisual = app.guide = { update() {} };
  app.waterThreshold = { reset() {}, update(_time, _dt, _anchor, options) { observations.water.push(options); } };
  app.voice = { update() {}, rip() {} };
  app.debug = { tick: () => false };
  app.soundscapes = [null, { update() {}, mute() {} }, {
    update() { observations.nextAudio.push('audible'); }, mute() { observations.nextAudio.push('muted'); }
  }, { update() {}, mute() {} }];
  app.portal = { render(_camera, passes, output) { observations.passes = passes; observations.output = output; } };
  return { app, observations };
}

test('arrival renders only its world and synchronizes the mask after transition transforms', () => {
  const { app, observations } = transitionHarness();
  app.tick(50);
  assert.equal(app.outerIndex, 1);
  assert.equal(app.swapped, true);
  assert.equal(app.anchor.visible, false);
  assert.deepEqual(observations.passes, [app.worlds[1].scene, app.overlay]);
  assert.equal(observations.maskParent, app.worlds[1].scene);
  assert.equal(observations.maskScale, app.anchor.scale.x);
  assert.ok(observations.maskScale > 1);
  assert.deepEqual(observations.nextAudio, ['muted']);
});

test('transition completion shows a newly synchronized closed seam without the next world leaking through', () => {
  const { app, observations } = transitionHarness();
  app.tick(50);
  app.swallow = 1.49;
  app.tick(100);
  assert.equal(app.swallow, -1);
  assert.equal(app.swapped, false);
  assert.equal(app.anchor.visible, true);
  assert.equal(observations.maskScale, 1);
  assert.deepEqual(observations.passes, [app.worlds[1].scene, app.overlay]);
});

test('four-world journey visits underwater before violet and returns to the original first world', () => {
  const { app } = transitionHarness();
  const route = [app.outerIndex];
  for (let step = 0; step < 4; step++) { app.stepThrough(); route.push(app.outerIndex); }
  assert.deepEqual(route, [0, 1, 2, 3, 0]);
  assert.equal(app.outerWorld, app.worldOne);
  assert.equal(app.currentWorld, 'The World of Stillness');
  assert.equal(app.worldOne.root.visible, true);
  assert.equal(app.anchor.parent, app.worldOne.scene);
});

test('Quest return previews room through the tear, then fully returns without changing session', () => {
  const { app, observations } = transitionHarness(3, true);
  app.worldOne.root.visible = false;
  app.swallow = -1;
  const session = app.renderer.xr.getSession();
  app.tick(50);
  assert.equal(observations.output, 'portal-passthrough');
  assert.equal(app.worldOne.root.visible, false, 'virtual furniture and floor stay hidden behind the return tear');
  assert.deepEqual(observations.passes, [app.worldThree.scene, app.maskScene, app.worldOne.scene, app.overlay]);
  assert.equal(observations.views.at(-1).active, true);
  app.swallow = 1.07;
  app.tick(100);
  assert.equal(app.outerIndex, 0);
  assert.equal(app.currentWorld, 'The World of Stillness');
  assert.equal(app.worldOne.root.visible, false);
  assert.equal(observations.output, 'passthrough');
  assert.deepEqual(observations.passes, [app.worldOne.scene, app.overlay]);
  assert.equal(observations.views.at(-1).active, false);
  app.swallow = 1.49;
  app.tick(150);
  assert.equal(observations.output, 'passthrough');
  assert.equal(app.renderer.xr.getSession(), session);
  assert.equal(app.renderer.xr.isPresenting, true);
});

test('desktop return draws the same furnished room with opaque output', () => {
  const { app, observations } = transitionHarness(3);
  app.tick(50);
  assert.equal(app.outerWorld, app.worldOne);
  assert.equal(app.worldOne.root.visible, true);
  assert.equal(app.currentWorld, 'The World of Stillness');
  assert.equal(observations.output, 'opaque');
});

test('watcher receives the live XR head pose and pauses behind a portal or during transition', () => {
  const { app, observations } = transitionHarness(3, true);
  const headset = new THREE.PerspectiveCamera();
  headset.position.set(31, 1.52, -23);
  headset.rotation.set(0.21, 0.63, 0, 'YXZ');
  headset.updateMatrixWorld();
  app.renderer.xr.getCamera = () => headset;
  app.swallow = -1;
  app.tick(50);
  assert.equal(observations.views.length, 1);
  const first = observations.views[0];
  assert.equal(first.active, true);
  assert.ok(first.position.distanceTo(headset.position) < 1e-10);
  assert.ok(first.direction.distanceTo(new THREE.Vector3(0, 0, -1).applyQuaternion(headset.quaternion)) < 1e-10);
  app.outerIndex = 2; // Violet is only the destination seen through the underwater tear.
  app.tick(100);
  assert.equal(observations.views.at(-1).active, false);
  app.outerIndex = 3;
  app.swallow = 0;
  app.tick(150);
  assert.equal(observations.views.at(-1).active, false);
  assert.equal(observations.views.length, 3, 'one view update per actual frame');
});

test('return room translates its floor and walking bounds around a distant seam', () => {
  const room = Object.create(WorldOne.prototype);
  room.root = new THREE.Group();
  // Use actual room-sized floor geometry without creating decorative textures.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 7.5), new THREE.MeshBasicMaterial());
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -1.2;
  room.root.add(floor);
  const ray = new THREE.Raycaster();
  for (const yaw of [0, 0.7, -2.1]) {
    const anchor = new THREE.Object3D();
    anchor.position.set(35, 1.35, -24);
    anchor.rotation.y = yaw;
    anchor.updateMatrixWorld();
    room.alignTo(anchor);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(anchor.quaternion);
    for (const reach of [0.43, 0.65, 1.1, 1.35]) {
      const viewer = anchor.position.clone().addScaledVector(forward, -reach);
      viewer.y = 1.65;
      const bounds = room.walkBounds;
      assert.ok(Math.hypot(viewer.x - bounds.center.x, viewer.z - bounds.center.z) < bounds.radius);
      ray.set(viewer, new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(floor, false)[0];
      assert.ok(hit, 'viewer lands over actual rendered room floor');
      assert.ok(Math.abs(hit.point.y - room.groundAt(viewer.x, viewer.z)) < 1e-8);
    }
    assert.ok(room.walkBounds.center.distanceTo(new THREE.Vector3(0, 0, -1.2)) > 30);
  }
});

for (const inXR of [false, true]) {
  test(`${inXR ? 'Quest' : 'desktop'} water spills only through the forest-to-underwater tear`, () => {
    const { app, observations } = transitionHarness(1, inXR);
    app.swallow = -1;
    app.tick(50);
    assert.equal(app.innerWorld, app.worldUnderwater);
    assert.equal(observations.water.at(-1).active, true);
    assert.equal(observations.water.at(-1).openness, 1);
    assert.equal(observations.output, 'opaque');
    app.swallow = 1.07;
    app.tick(100);
    assert.equal(app.outerWorld, app.worldUnderwater);
    assert.equal(app.currentWorld, 'The World of Drowned Dreams');
    assert.equal(observations.water.at(-1).active, false);
    assert.equal(observations.output, 'opaque');
    assert.deepEqual(observations.passes, [app.worldUnderwater.scene, app.overlay]);
    app.swallow = 1.49;
    app.tick(150);
    app.tick(200);
    assert.equal(app.innerWorld, app.worldThree);
    assert.equal(observations.water.at(-1).active, false);
    assert.equal(observations.views.at(-1).active, false, 'violet watcher waits until arrival');
  });
}
