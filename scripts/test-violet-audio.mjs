// Original audio-buffer and positional-graph checks. These verify no loud
// impulses or boundary clicks, not how a particular headset speaker sounds.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

THREE.TextureLoader.prototype.load = () => new THREE.Texture();
GLTFLoader.prototype.load = () => undefined;
globalThis.document = { createElement() { return {
  width: 64, height: 64,
  getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} })
}; } };
const { droneBuffer, chimesBuffer, uneaseBuffer } = await import('../src/audio/synth.ts');
const { Soundscape, WORLD_THREE_SOUNDS, WORLD_TWO_SOUNDS, UNDERWATER_SOUNDS } = await import('../src/audio/Soundscape.ts');
const { WorldThree } = await import('../src/worlds/WorldThree.ts');

function param(value = 0) {
  return { value, setTargetAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { this.value = value; } };
}
function node(extra = {}) { return { connect() {}, disconnect() {}, ...extra }; }
function controlledContext(sampleRate = 48000) {
  return {
    sampleRate, currentTime: 0,
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: index => data[index] };
    },
    createGain: () => node({ gain: param(1) }),
    createPanner: () => node(Object.fromEntries(['positionX', 'positionY', 'positionZ', 'orientationX', 'orientationY', 'orientationZ'].map(key => [key, param()]))),
    createBiquadFilter: () => node({ frequency: param(), Q: param(1) }),
    createBufferSource: () => node({ playbackRate: param(1), detune: param(), start() {}, stop() {} })
  };
}
function fixture() {
  const ctx = controlledContext();
  const listener = { context: ctx, getInput: () => node(), timeDelta: 1 / 72 };
  const engine = { state: 'running', ctx, listener };
  const world = new WorldThree(new THREE.Vector3(0, 1.35, -1.1));
  const soundscape = new Soundscape(engine, world, WORLD_THREE_SOUNDS);
  const sources = () => world.root.children.filter(child => child instanceof THREE.PositionalAudio);
  const step = (seconds, inside, openness = 0, lean = 0) => {
    for (let i = 0; i < seconds * 72; i++) {
      ctx.currentTime += 1 / 72;
      soundscape.update(1 / 72, openness, 0, lean, inside);
    }
  };
  return { ctx, world, engine, soundscape, sources, step };
}
const makeBuffers = ctx => [droneBuffer(ctx), chimesBuffer(ctx), uneaseBuffer(ctx)];

test('violet loops are finite, quiet, smoothly joined and below 6.9 MB on common audio devices', () => {
  for (const rate of [22050, 44100, 48000, 96000]) {
    let memory = 0;
    for (const [index, buffer] of makeBuffers(controlledContext(rate)).entries()) {
      const samples = buffer.getChannelData(0);
      memory += samples.byteLength;
      assert.equal(buffer.numberOfChannels, 1);
      let peak = 0, squareSum = 0, maximumStep = 0;
      for (let i = 0; i < samples.length; i++) {
        assert.ok(Number.isFinite(samples[i]));
        peak = Math.max(peak, Math.abs(samples[i]));
        squareSum += samples[i] ** 2;
        if (i) maximumStep = Math.max(maximumStep, Math.abs(samples[i] - samples[i - 1]));
      }
      assert.ok(peak < 0.55, `peak headroom: ${peak}`);
      assert.ok(Math.sqrt(squareSum / samples.length) > 0.004, 'layer contains useful signal');
      assert.ok(maximumStep < (index === 2 ? 0.22 : 0.07), `no full-level click: ${maximumStep}`);
      const joinStep = Math.abs(samples[0] - samples.at(-1));
      assert.ok(joinStep < 0.02, `quiet loop seam: ${joinStep}`);
      if (index > 0) {
        assert.equal(Math.abs(samples[0]), 0);
        assert.equal(Math.abs(samples.at(-1)), 0);
      }
    }
    assert.ok(memory <= 6_900_000, `${memory} bytes at host rate ${rate}`);
  }
});

test('metal and breath-like details are sparse while the low bed stays continuous across its boundary', () => {
  const [drone, metal, rustle] = makeBuffers(controlledContext());
  assert.equal(new Set([drone.duration, metal.duration, rustle.duration]).size, 3, 'independent cycle lengths');
  for (const buffer of [metal, rustle]) {
    const samples = buffer.getChannelData(0);
    const silence = samples.reduce((count, sample) => count + (Math.abs(sample) < 0.00001 ? 1 : 0), 0) / samples.length;
    assert.ok(silence > 0.45 && silence < 0.8, `detail leaves listening space: ${silence}`);
  }
  const samples = drone.getChannelData(0);
  const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
  assert.ok(rms(samples.subarray(0, drone.sampleRate / 10)) > 0.02, 'bed does not dip to silence when wrapping');
  assert.ok(rms(samples.subarray(-drone.sampleRate / 10)) > 0.02, 'bed sustains through the end');
});

test('all three violet layers use real world sound spots, unlock once and follow scene alignment', () => {
  const f = fixture();
  f.engine.state = 'locked';
  f.soundscape.start();
  assert.equal(f.sources().length, 0);
  f.engine.state = 'running';
  f.soundscape.start();
  f.soundscape.start();
  assert.equal(f.sources().length, 3, 'no silent missing spot or duplicate source');
  f.world.root.position.set(5, -0.2, 8);
  f.world.root.rotation.y = 1.1;
  f.world.scene.updateMatrixWorld(true);
  for (const [i, audio] of f.sources().entries()) {
    const clip = WORLD_THREE_SOUNDS[i];
    assert.equal(audio.gain.gain.value, 0, 'entry begins silent');
    assert.equal(audio.loop, true);
    assert.equal(audio.isPlaying, true);
    assert.ok(audio.offset >= 0 && audio.offset < audio.buffer.duration);
    assert.ok(audio.position.distanceTo(f.world.soundSpots[clip.spot]) < 1e-10);
    const expected = f.world.soundSpots[clip.spot].clone().applyMatrix4(f.world.root.matrixWorld);
    assert.ok(Math.abs(audio.panner.positionX.value - expected.x) < 1e-10);
    assert.ok(Math.abs(audio.panner.positionY.value - expected.y) < 1e-10);
    assert.ok(Math.abs(audio.panner.positionZ.value - expected.z) < 1e-10);
    assert.equal(audio.panner.distanceModel, 'inverse');
    assert.equal(audio.panner.rolloffFactor, clip.near ? 3 : 1);
  }
});

test('violet opens gently, limits nearby rustle, keeps spectral ceilings and leaves other worlds unchanged', () => {
  const unchanged = JSON.stringify([WORLD_TWO_SOUNDS, UNDERWATER_SOUNDS]);
  const f = fixture();
  f.soundscape.start();
  f.step(1, false);
  const closed = f.sources().map(audio => audio.gain.gain.value);
  f.step(1, false, 0.5, 0.5);
  const half = f.sources().map(audio => audio.gain.gain.value);
  f.step(3, true, 1, 1);
  f.sources().forEach((audio, i) => {
    const clip = WORLD_THREE_SOUNDS[i];
    assert.ok(closed[i] < half[i] && half[i] < audio.gain.gain.value);
    assert.ok(audio.gain.gain.value <= clip.gain * (clip.near ? 0.5 : 1));
    assert.ok(audio.filters[0].frequency.value <= clip.maxCutoff);
  });
  assert.equal(JSON.stringify([WORLD_TWO_SOUNDS, UNDERWATER_SOUNDS]), unchanged);
});

test('leaving violet fades all layers to silence and re-entry restores them without accumulating sources', () => {
  const f = fixture();
  f.soundscape.start();
  f.step(3, true);
  let previous = f.sources().map(audio => audio.gain.gain.value);
  f.soundscape.mute(1 / 72);
  f.sources().forEach((audio, i) => {
    assert.ok(audio.gain.gain.value < previous[i] && audio.gain.gain.value > previous[i] * 0.8);
  });
  for (let frame = 0; frame < 240; frame++) {
    previous = f.sources().map(audio => audio.gain.gain.value);
    f.soundscape.mute(1 / 72);
    f.sources().forEach((audio, i) => assert.ok(audio.gain.gain.value <= previous[i]));
  }
  for (const audio of f.sources()) assert.equal(audio.gain.gain.value, 0);
  f.soundscape.start();
  f.step(2, true);
  assert.equal(f.sources().length, 3);
  for (const audio of f.sources()) assert.ok(audio.gain.gain.value > 0.02);
});
