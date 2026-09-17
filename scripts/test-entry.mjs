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
    textContent: '', disabled: false, inert: false, open: false,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    addEventListener: (name, callback) => events.set(name, callback),
    scrollIntoView() {},
    click() { if (!this.disabled) events.get('click')?.(); }
  };
}

async function harness(options = {}) {
  const capabilities = { coarse: false, fine: true, supported: false, secure: true, ...options };
  const nodes = new Map(['intro', 'enter-headset', 'enter-desktop', 'xr-note', 'headset-help', 'app'].map(id => [id, element()]));
  const events = [];
  const xrEvents = new Map();
  let activation = false;
  let constructed = 0;
  let instance;
  class App {
    constructor() {
      constructed++;
      instance = this;
      this.renderer = { xr: { isPresenting: false, addEventListener: (name, callback) => xrEvents.set(name, callback) } };
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
    document: { getElementById: id => nodes.get(id) },
    navigator: { xr: { isSessionSupported: async () => capabilities.supported } },
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
    async click(id) {
      activation = true;
      nodes.get(id).click();
      activation = false;
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
