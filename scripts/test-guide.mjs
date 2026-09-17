// Exercise the actual spatial guide's clocks and visibility, without WebGL.
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

globalThis.document = { createElement() {
  const gradient = { addColorStop() {} };
  const context = new Proxy({
    font: '16px serif', createRadialGradient: () => gradient,
    measureText(text) { return { width: text.length * Number(this.font.match(/([\d.]+)px/)?.[1] ?? 16) * 0.5 }; }
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  return { width: 1, height: 1, getContext: () => context };
} };

const { Guide } = await import('../src/ui/Guide.ts');
const { InteractionState: State } = await import('../src/state/InteractionStateMachine.ts');
const { WORLD_NAMES } = await import('../src/config/worlds.ts');
const viewer = new THREE.Vector3(0, 1.6, 0);
const forward = new THREE.Vector3(0, 0, -1);

function fixture(xr = false) {
  const guide = new Guide(new THREE.Scene());
  guide.setVisible(true);
  guide.showNotesFor(20, 0, viewer, forward);
  const input = { xr, ready: true, canGrab: false, gripping: false, gripsHolding: 0,
    state: State.Idle, openness: 0, strain: 0, canStep: false,
    seamWorld: new THREE.Vector3(0, 1.2, -0.7), viewer, viewerForward: forward,
    halfFovH: 0.85, worldName: WORLD_NAMES[0], time: 0, dt: 0.05 };
  const update = (time, changes = {}) => { Object.assign(input, changes, { time }); guide.update(input); };
  update(0);
  return { guide, update };
}

test('first-world idle hints fade at 20 seconds and looking/locking cannot restart them', () => {
  for (const xr of [false, true]) {
    const { guide, update } = fixture(xr);
    update(19.9); assert.ok(guide.prompt.targetOpacity > 0);
    update(20); assert.equal(guide.prompt.targetOpacity, 0);
    update(21, { canGrab: true }); assert.equal(guide.prompt.targetOpacity, 0);
    update(22, { ready: false, canGrab: false }); assert.equal(guide.prompt.targetOpacity, 0);
    update(24, { ready: true, worldName: WORLD_NAMES[1] }); assert.equal(guide.prompt.targetOpacity, 0);
  }
});

test('grip, pull, healing, crossing and brief story cues remain visible after onboarding', () => {
  for (const xr of [false, true]) {
    const { guide, update } = fixture(xr);
    update(30, { gripping: true, gripsHolding: 2, state: State.Pulling });
    assert.ok(guide.prompt.targetOpacity > 0);
    update(31, { gripping: false, gripsHolding: 0, state: State.Healing });
    assert.ok(guide.prompt.targetOpacity > 0);
    update(32, { state: State.FullyOpen, canStep: true });
    assert.ok(guide.prompt.targetOpacity > 0);
    guide.flash('Something is watching.', 40);
    update(40, { state: State.Idle, canStep: false });
    assert.ok(guide.prompt.targetOpacity > 0);
    update(43); assert.equal(guide.prompt.targetOpacity, 0);
  }
});

test('recalled help stays for 20 seconds, stays in its placed location, and can be closed early', () => {
  const { guide, update } = fixture();
  update(30);
  guide.toggleNotes(viewer, forward, 30);
  update(30); assert.ok(guide.notes.targetOpacity > 0);
  const placed = guide.notes.mesh.position.clone();
  update(49.9, { viewer: new THREE.Vector3(2, 1.6, 1), viewerForward: new THREE.Vector3(1, 0, 0) });
  assert.ok(guide.notes.targetOpacity > 0);
  assert.ok(guide.notes.mesh.position.equals(placed), 'reference does not chase the camera');
  update(50); assert.equal(guide.notes.targetOpacity, 0);
  guide.toggleNotes(viewer, forward, 60);
  update(60); assert.ok(guide.notes.targetOpacity > 0);
  guide.toggleNotes(viewer, forward, 61);
  update(61); assert.equal(guide.notes.targetOpacity, 0);
});

test('notes yield immediately to tearing, crossing and a new world', () => {
  for (const change of [
    { gripping: true, gripsHolding: 1, state: State.Pinching },
    { state: State.WorldTransition },
    { worldName: WORLD_NAMES[2] }
  ]) {
    const { guide, update } = fixture(true);
    guide.toggleNotes(viewer, forward, 30);
    update(30); assert.ok(guide.notes.targetOpacity > 0);
    update(31, change); assert.equal(guide.notes.targetOpacity, 0);
  }
});

test('paused application time preserves the remaining reference-reading time', () => {
  const { guide, update } = fixture(true);
  guide.toggleNotes(viewer, forward, 30);
  update(45);
  for (let i = 0; i < 200; i++) update(45, { dt: 0 });
  assert.ok(guide.notes.targetOpacity > 0);
  update(49.99, { dt: 0.05 }); assert.ok(guide.notes.targetOpacity > 0);
  update(50); assert.equal(guide.notes.targetOpacity, 0);
});

test('a fresh headset journey clears old notes and starts a fresh finite onboarding window', () => {
  const { guide, update } = fixture();
  guide.toggleNotes(viewer, forward, 30);
  update(30);
  guide.resetJourney();
  guide.showNotesFor(20, 100, viewer, forward);
  update(100, { xr: true, worldName: WORLD_NAMES[0] });
  assert.equal(guide.notes.targetOpacity, 0);
  assert.ok(guide.prompt.targetOpacity > 0);
  update(120); assert.equal(guide.prompt.targetOpacity, 0);
});

test('larger chapter titles retain their complete names and fit narrow horizontal views', () => {
  const { guide, update } = fixture();
  assert.equal(guide.title.mesh.geometry.parameters.width, 3.7);
  for (const halfFovH of [0.1, 0.25, 0.85]) for (const worldName of WORLD_NAMES) {
    update(1, { halfFovH, worldName });
    assert.ok(guide.title.key.includes(worldName));
    const displayedWidth = guide.title.mesh.geometry.parameters.width * guide.title.mesh.scale.x;
    assert.ok(displayedWidth <= 2 * 4.8 * Math.tan(halfFovH - 0.05) + 1e-9);
    assert.ok(displayedWidth > 0);
  }
});
