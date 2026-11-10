// Controlled session/layer behavior; no compositor or physical Quest is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = new URL('../src/xr/XRSessionSetup.ts', import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  if (url === source) return { format: 'module', shortCircuit: true,
    source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }) };
  return nextLoad(url, context);
} });
const { setupXRSession, configureXRLayerAlpha } = await import(source);

function harness({ blendMode = 'alpha-blend', alpha = true, stencil = true, lost = false, layer = { blendTextureSourceAlpha: false } } = {}) {
  const session = new EventTarget();
  session.environmentBlendMode = blendMode;
  const events = { adds: 0, removes: 0, installations: 0 };
  for (const [name, key] of [['addEventListener', 'adds'], ['removeEventListener', 'removes']]) {
    const original = session[name].bind(session);
    session[name] = (...args) => { events[key]++; return original(...args); };
  }
  let installed = null;
  const renderer = {
    getContext: () => ({ getContextAttributes: () => ({ alpha, stencil }), isContextLost: () => lost }),
    xr: {
      isPresenting: false,
      async setSession(value) { events.installations++; installed = value; this.isPresenting = true; },
      getSession: () => installed,
      getBaseLayer: () => layer
    }
  };
  return { renderer, session, layer, events };
}

test('projection source alpha is explicitly enabled after awaited installation', async () => {
  const h = harness();
  const info = await setupXRSession(h.renderer, h.session, 'immersive-ar');
  assert.equal(h.layer.blendTextureSourceAlpha, true);
  assert.deepEqual(info, { blendMode: 'alpha-blend', layer: 'projection', sourceAlpha: true, contextAlpha: true, contextStencil: true });
  assert.equal(h.events.installations, 1);
  assert.equal(h.events.adds, h.events.removes);
});

test('legacy WebGL layers are supported without adding unsupported properties', async () => {
  const h = harness({ layer: { framebuffer: {} } });
  assert.equal((await setupXRSession(h.renderer, h.session, 'immersive-ar')).layer, 'webgl');
  assert.equal('blendTextureSourceAlpha' in h.layer, false);
});

test('opaque/additive output is rejected for passthrough before attaching', async () => {
  for (const blendMode of ['opaque', 'additive']) {
    const h = harness({ blendMode });
    await assert.rejects(setupXRSession(h.renderer, h.session, 'immersive-ar'), /passthrough is required/);
    assert.equal(h.events.installations, 0);
    assert.equal(h.events.adds, h.events.removes);
  }
  const h = harness({ blendMode: 'opaque' });
  assert.equal((await setupXRSession(h.renderer, h.session, 'immersive-vr')).blendMode, 'opaque');
});

test('missing alpha/stencil or context loss fails before installation', async () => {
  for (const options of [{ alpha: false }, { stencil: false }, { lost: true }]) {
    const h = harness(options);
    await assert.rejects(setupXRSession(h.renderer, h.session, 'immersive-ar'), /graphics context/);
    assert.equal(h.events.installations, 0);
    assert.equal(h.events.adds, h.events.removes);
  }
});

test('missing or unwriteable alpha layers cannot report success', async () => {
  assert.throws(() => configureXRLayerAlpha(null), /render layer/);
  const ignored = { get blendTextureSourceAlpha() { return false; }, set blendTextureSourceAlpha(_) {} };
  assert.throws(() => configureXRLayerAlpha(ignored), /enable transparency/);
  const h = harness({ layer: null });
  await assert.rejects(setupXRSession(h.renderer, h.session, 'immersive-ar'), /render layer/);
  assert.equal(h.events.adds, h.events.removes);
});

test('installation rejection preserves its cause and removes event listener', async () => {
  const h = harness();
  const cause = new Error('requestReferenceSpace failed');
  h.renderer.xr.setSession = async () => { throw cause; };
  await assert.rejects(setupXRSession(h.renderer, h.session, 'immersive-ar'), error => error === cause);
  assert.equal(h.events.adds, h.events.removes);
});

test('an end event during pending installation cannot later report startup success', async () => {
  const h = harness();
  let finish;
  h.renderer.xr.setSession = () => new Promise(resolve => { finish = resolve; });
  // A hostile late adapter completion must still be rejected even if it exposes
  // the abandoned session again. No fabricated browser end event is sent.
  h.renderer.xr.getSession = () => h.session;
  let settled = false;
  const installing = setupXRSession(h.renderer, h.session, 'immersive-ar').finally(() => { settled = true; });
  h.session.dispatchEvent(new Event('end'));
  await Promise.resolve();
  assert.equal(settled, false, 'do not abandon an installation still in progress');
  finish();
  await assert.rejects(installing, /closed during startup/);
  assert.equal(h.layer.blendTextureSourceAlpha, false);
  assert.equal(h.events.adds, h.events.removes);
});

test('a changed renderer session cannot be mistaken for this installation', async () => {
  const h = harness();
  h.renderer.xr.getSession = () => ({});
  await assert.rejects(setupXRSession(h.renderer, h.session, 'immersive-ar'), /closed during startup/);
});

test('an attached but non-presenting session cannot report successful startup', async () => {
  const h = harness();
  h.renderer.xr.setSession = async () => {};
  h.renderer.xr.getSession = () => h.session;
  await assert.rejects(setupXRSession(h.renderer, h.session, 'immersive-ar'), /closed during startup/);
});
