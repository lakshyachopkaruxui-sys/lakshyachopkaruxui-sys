// Real AudioEngine/Three AudioListener control graph with a controlled native
// AudioParam. These checks establish lifecycle ordering, not speaker acoustics.
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

const { AudioEngine } = await import('../src/audio/AudioEngine.ts');
const { CONFIG } = await import('../src/config/config.ts');

function fixture() {
  const events = [];
  const gain = {
    value: 1,
    cancelScheduledValues(time) { events.push({ type: 'cancel', time }); },
    setValueAtTime(value, time) { this.value = value; events.push({ type: 'immediate', value, time }); },
    setTargetAtTime(value, time, constant) { this.value = value; events.push({ type: 'target', value, time, constant }); }
  };
  let resumeCount = 0, suspendCount = 0;
  const ctx = {
    state: 'suspended', currentTime: 7, destination: {},
    createGain: () => ({ gain, connect() {} }),
    resume: async () => { resumeCount++; ctx.state = 'running'; },
    suspend: async () => { suspendCount++; ctx.state = 'suspended'; }
  };
  THREE.AudioContext.setContext(ctx);
  const camera = new THREE.PerspectiveCamera();
  const engine = new AudioEngine(camera);
  return { engine, ctx, gain, events, camera, resumes: () => resumeCount, suspends: () => suspendCount };
}

test('leaving an active scene immediately cancels its gain ramp and silences the actual listener', () => {
  const f = fixture();
  assert.equal(f.camera.children[0], f.engine.listener);
  f.engine.setNarrationDucking(true);
  f.engine.setActive(false);
  assert.deepEqual(f.events.slice(-2), [
    { type: 'cancel', time: 7 }, { type: 'immediate', value: 0, time: 7 }
  ]);
  assert.equal(f.engine.listener.getMasterVolume(), 0);
  assert.equal(f.resumes(), 0);
  assert.equal(f.suspends(), 0);
});

test('narration ending or starting while inactive cannot reopen the scene mix', () => {
  const f = fixture();
  f.engine.setActive(false);
  const afterExit = f.events.length;
  for (const ducked of [true, false, true, false]) {
    f.engine.setNarrationDucking(ducked);
    assert.equal(f.gain.value, 0);
  }
  const newGains = f.events.slice(afterExit).filter(event => event.type !== 'cancel');
  assert.ok(newGains.every(event => event.type === 'immediate' && event.value === 0));
});

test('re-entry restores the current intended ducked or normal mix without resuming or suspending context', () => {
  const f = fixture();
  f.engine.setNarrationDucking(true);
  f.engine.setActive(false);
  f.engine.setActive(true);
  assert.equal(f.gain.value, CONFIG.audio.master * 0.28);
  assert.equal(f.events.at(-1).type, 'target');
  f.engine.setActive(false);
  f.engine.setNarrationDucking(false);
  f.engine.setActive(true);
  assert.equal(f.gain.value, CONFIG.audio.master);
  assert.equal(f.resumes(), 0);
  assert.equal(f.suspends(), 0);
});

test('a delayed successful unlock cannot unmute an entry page reached while resume was pending', async () => {
  const f = fixture();
  let completeResume;
  f.ctx.resume = () => new Promise(resolve => { completeResume = () => { f.ctx.state = 'running'; resolve(); }; });
  const unlocking = f.engine.unlock();
  f.engine.setActive(false);
  f.engine.setNarrationDucking(false);
  const beforeResume = f.events.length;
  completeResume();
  assert.equal(await unlocking, true);
  assert.equal(f.engine.state, 'running');
  assert.equal(f.gain.value, 0);
  assert.equal(f.events.length, beforeResume, 'unlock does not schedule a gain recovery');
  f.engine.setActive(true);
  assert.equal(f.gain.value, CONFIG.audio.master);
});
