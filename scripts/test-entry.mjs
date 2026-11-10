// Exercise the real entry module with a controlled DOM and app boundary.
// This checks launch routing and activation order, not WebGL or headset hardware.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const entry = stripTypeScriptTypes(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/import \{ App \} from ['"]\.\/app\/App['"];?/, '')
  .replaceAll('import.meta.env.DEV', 'false');

function element() {
  const events = new Map();
  const classes = new Set();
  const attributes = new Map();
  return {
    textContent: '', disabled: false, inert: false, open: false, dataset: {},
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    addEventListener: (name, callback) => events.set(name, callback),
    scrollIntoView() {},
    click() { if (!this.disabled) events.get('click')?.(); }
  };
}

async function harness(options = {}) {
  const capabilities = { coarse: false, fine: true, supported: false, secure: true, forestPrepared: true, ...options };
  const nodes = new Map(['intro', 'enter-headset', 'enter-desktop', 'xr-note', 'headset-help', 'app'].map(id => [id, element()]));
  const events = [];
  const xrEvents = new Map();
  let activation = false;
  let constructed = 0;
  let preparationCalls = 0;
  let pendingPreparation;
  let instance;
  class App {
    setNarrationEnabled() {}
    enterIntro() {}
    constructor() {
      constructed++;
      instance = this;
      this.forestPrepared = capabilities.forestPrepared;
      this.renderer = { xr: { isPresenting: false, addEventListener: (name, callback) => xrEvents.set(name, callback) } };
    }
    prepareForestForEntry(onProgress) {
      preparationCalls++;
      if (this.forestPrepared) return Promise.resolve();
      events.push('prepare');
      onProgress('Loading forest…');
      return new Promise((resolve, reject) => {
        pendingPreparation = { resolve, reject, onProgress };
      });
    }
    enterDesktop() { events.push('desktop'); }
    enterXR() {
      events.push('headset');
      assert.equal(activation, true, 'headset request must run before the click returns');
      if (capabilities.reject) return Promise.reject(new Error('Permission denied'));
      this.renderer.xr.isPresenting = true;
      return Promise.resolve();
    }
    startAudio() {
      events.push('audio');
      // Audio can remain suspended without blocking session launch or the intro.
      return new Promise(() => {});
    }
  }
  const context = {
    App,
    document: { getElementById: id => nodes.get(id), addEventListener() {} },
    navigator: { userAgent: capabilities.userAgent ?? 'Desktop browser', xr: { isSessionSupported: async () => capabilities.supported } },
    window: {
      isSecureContext: capabilities.secure,
      matchMedia: query => ({ matches: query.includes('coarse') ? capabilities.coarse : capabilities.fine }),
      setTimeout, clearTimeout
    },
    console: { error() {}, warn() {} }
  };
  await runInNewContext(entry, context);
  return {
    nodes, events, capabilities,
    get constructed() { return constructed; },
    get preparationCalls() { return preparationCalls; },
    async click(id) {
      activation = true;
      nodes.get(id).click();
      activation = false;
      await new Promise(resolve => setImmediate(resolve));
    },
    preparationProgress(message) {
      assert.ok(pendingPreparation, 'preparation must be pending before reporting progress');
      pendingPreparation.onProgress(message);
    },
    async completePreparation() {
      assert.ok(pendingPreparation, 'preparation must be pending before completion');
      instance.forestPrepared = true;
      pendingPreparation.resolve();
      pendingPreparation = undefined;
      await new Promise(resolve => setImmediate(resolve));
    },
    async failPreparation() {
      assert.ok(pendingPreparation, 'preparation must be pending before failure');
      pendingPreparation.reject(new Error('Forest GPU preparation failed'));
      pendingPreparation = undefined;
      await new Promise(resolve => setImmediate(resolve));
    },
    endSession() {
      instance.renderer.xr.isPresenting = false;
      xrEvents.get('sessionend')?.();
    }
  };
}

test('touch-only desktop click keeps setup visible and never constructs the 3D app', async () => {
  const h = await harness({ coarse: true, fine: false });
  await h.click('enter-desktop');
  assert.equal(h.constructed, 0);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('intro').inert, false);
  assert.equal(h.nodes.get('headset-help').open, true);
  assert.match(h.nodes.get('xr-note').textContent, /mouse and keyboard/);
  assert.equal(h.nodes.get('enter-headset').disabled, false);
});

test('phone browsers cannot start either experience or construct the 3D app', async () => {
  for (const userAgent of ['Mozilla/5.0 (iPhone) Mobile Safari', 'Mozilla/5.0 Android 15 Mobile Chrome']) {
    const h = await harness({ userAgent, coarse: true, fine: false, supported: true });
    await h.click('enter-desktop'); await h.click('enter-headset');
    assert.equal(h.constructed, 0);
    assert.equal(h.nodes.get('intro').dataset.phone, 'true');
    assert.equal(h.nodes.get('enter-desktop').disabled, true);
    assert.equal(h.nodes.get('enter-headset').disabled, true);
    assert.match(h.nodes.get('xr-note').textContent, /Phone playback is not supported/);
  }
});

test('Quest mobile user agent retains native headset entry', async () => {
  const h = await harness({ userAgent: 'Mozilla/5.0 Android Mobile OculusBrowser Quest', coarse: true, fine: false, supported: true });
  await h.click('enter-headset');
  assert.equal(h.constructed, 1);
  assert.deepEqual(h.events, ['headset', 'audio']);
});

test('hybrid touchscreen with a fine pointer retains normal desktop entry', async () => {
  const h = await harness({ coarse: true, fine: true });
  await h.click('enter-desktop');
  assert.equal(h.constructed, 1);
  assert.deepEqual(h.events, ['audio', 'desktop']);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), true);
  assert.equal(h.nodes.get('intro').inert, true);
});

test('input capabilities are rechecked after a mouse is attached', async () => {
  const h = await harness({ coarse: true, fine: false });
  await h.click('enter-desktop');
  h.capabilities.fine = true;
  await h.click('enter-desktop');
  assert.equal(h.constructed, 1);
  assert.ok(h.events.includes('desktop'));
});

test('touch-only guard does not block headset entry or await suspended audio first', async () => {
  const h = await harness({ coarse: true, fine: false, supported: true });
  await h.click('enter-headset');
  assert.equal(h.constructed, 1);
  assert.deepEqual(h.events, ['headset', 'audio']);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), true);
});

test('unsupported headset browser offers neutral setup without starting 3D', async () => {
  const h = await harness({ coarse: true, fine: false });
  await h.click('enter-headset');
  assert.equal(h.constructed, 0);
  assert.equal(h.nodes.get('headset-help').open, true);
  assert.match(h.nodes.get('xr-note').textContent, /Quest Browser/);
  assert.doesNotMatch(h.nodes.get('xr-note').textContent, /this laptop/);
});

test('denied headset permission leaves a visible message and a usable retry', async () => {
  const h = await harness({ supported: true, reject: true });
  await h.click('enter-headset');
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('enter-headset').disabled, false);
  assert.match(h.nodes.get('xr-note').textContent, /Permission denied/);
  h.capabilities.reject = false;
  await h.click('enter-headset');
  assert.equal(h.constructed, 1);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), true);
});

test('ending a headset session restores the accessible entry page', async () => {
  const h = await harness({ supported: true });
  await h.click('enter-headset');
  h.endSession();
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('intro').inert, false);
  assert.equal(h.nodes.get('enter-headset').disabled, false);
  assert.match(h.nodes.get('xr-note').textContent, /session ended/);
});

test('desktop waits behind the visible intro while Forest prepares and ignores duplicate entry clicks', async () => {
  const h = await harness({ supported: true, forestPrepared: false });
  await h.click('enter-desktop');
  assert.deepEqual(h.events, ['audio', 'prepare'], 'audio unlock happens on the click without awaiting suspended audio');
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('intro').inert, false);
  assert.equal(h.nodes.get('enter-desktop').disabled, true);
  assert.equal(h.nodes.get('enter-headset').disabled, true);
  assert.match(h.nodes.get('enter-desktop').textContent, /Preparing worlds/);
  assert.match(h.nodes.get('xr-note').textContent, /Loading forest/);
  h.preparationProgress('Preparing forest graphics…');
  assert.equal(h.nodes.get('xr-note').textContent, 'Preparing forest graphics…');

  await h.click('enter-desktop');
  await h.click('enter-headset');
  assert.equal(h.constructed, 1);
  assert.equal(h.preparationCalls, 1);
  assert.deepEqual(h.events, ['audio', 'prepare']);

  await h.completePreparation();
  assert.deepEqual(h.events, ['audio', 'prepare', 'desktop']);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), true);
  assert.equal(h.nodes.get('intro').inert, true);
  assert.equal(h.nodes.get('enter-desktop').disabled, false);
});

test('failed desktop preparation keeps entry usable and retries with the existing app', async () => {
  const h = await harness({ forestPrepared: false });
  await h.click('enter-desktop');
  await h.failPreparation();
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('intro').inert, false);
  assert.equal(h.nodes.get('enter-desktop').disabled, false);
  assert.match(h.nodes.get('xr-note').textContent, /could not start/i);
  assert.equal(h.events.includes('desktop'), false);

  await h.click('enter-desktop');
  assert.equal(h.constructed, 1);
  assert.equal(h.preparationCalls, 2);
  await h.completePreparation();
  assert.deepEqual(h.events, ['audio', 'prepare', 'audio', 'prepare', 'desktop']);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), true);
});

test('headset preparation finishes outside XR and requires a fresh activated click to request a session', async () => {
  const h = await harness({ userAgent: 'Android Mobile OculusBrowser Quest', supported: true, coarse: true, fine: false, forestPrepared: false });
  await h.click('enter-headset');
  assert.deepEqual(h.events, ['prepare']);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('enter-headset').disabled, true);
  assert.equal(h.nodes.get('intro').dataset.busy, 'true');
  await h.click('enter-headset');
  await h.click('enter-desktop');
  assert.equal(h.preparationCalls, 1);
  assert.equal(h.constructed, 1);

  await h.completePreparation();
  assert.deepEqual(h.events, ['prepare'], 'resolving preparation must never issue a session request after await');
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('intro').inert, false);
  assert.equal(h.nodes.get('enter-headset').disabled, false);
  assert.equal(h.nodes.get('intro').dataset.busy, 'false');
  assert.match(h.nodes.get('xr-note').textContent, /Worlds ready.*Choose Enter headset/);

  await h.click('enter-headset');
  // enterXR itself asserts the click is still active. Audio remains unresolved.
  assert.deepEqual(h.events, ['prepare', 'headset', 'audio']);
  assert.equal(h.preparationCalls, 1);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), true);
});

test('failed headset preparation can retry without requesting XR during either asynchronous attempt', async () => {
  const h = await harness({ supported: true, forestPrepared: false });
  await h.click('enter-headset');
  await h.failPreparation();
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  assert.equal(h.nodes.get('enter-headset').disabled, false);
  assert.match(h.nodes.get('xr-note').textContent, /Forest GPU preparation failed/);
  assert.deepEqual(h.events, ['prepare']);

  await h.click('enter-headset');
  await h.completePreparation();
  assert.equal(h.constructed, 1);
  assert.equal(h.preparationCalls, 2);
  assert.deepEqual(h.events, ['prepare', 'prepare']);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), false);
  await h.click('enter-headset');
  assert.deepEqual(h.events, ['prepare', 'prepare', 'headset', 'audio']);
  assert.equal(h.nodes.get('intro').classList.contains('hidden'), true);
});
