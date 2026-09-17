// Buffer and control-graph regression checks. These do not replace listening
// through a headset or verifying its browser's native audio implementation.
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
      format: 'module',
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
      shortCircuit: true
    };
    return nextLoad(url, context);
  }
});

const { underwaterBuffer, bubblesBuffer, whaleBuffer, currentBuffer } = await import('../src/audio/synth.ts');
const { Soundscape, UNDERWATER_SOUNDS, WORLD_TWO_SOUNDS } = await import('../src/audio/Soundscape.ts');
const { CONFIG } = await import('../src/config/config.ts');

function param(value = 0) {
  return { value, targets: [], setTargetAtTime(v) { this.value = v; this.targets.push(v); }, linearRampToValueAtTime(v) { this.value = v; } };
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

function fixture(clips = UNDERWATER_SOUNDS) {
  const ctx = controlledContext();
  const listener = { context: ctx, getInput: () => node(), timeDelta: 1 / 72 };
  const engine = { state: 'running', ctx, listener };
  const world = { root: new THREE.Group(), soundSpots: {
    water: new THREE.Vector3(0, 5, -8), bubbles: new THREE.Vector3(-4, 2, -5),
    whale: new THREE.Vector3(8, 14, -20), near: new THREE.Vector3(0, 1, -1),
    canopyLeft: new THREE.Vector3(-3, 4, -2)
  } };
  const soundscape = new Soundscape(engine, world, clips);
  const step = (seconds, inside, openness = 0, lean = 0) => {
    for (let i = 0; i < seconds * 72; i++) {
      ctx.currentTime += 1 / 72;
      soundscape.update(1 / 72, openness, 0, lean, inside);
    }
  };
  return { ctx, engine, world, soundscape, step };
}

const makeBuffers = ctx => [underwaterBuffer(ctx), bubblesBuffer(ctx), whaleBuffer(ctx), currentBuffer(ctx)];

test('all underwater loops stay finite, non-clipping, click-free at the loop boundary and below 6.5 MB', () => {
  for (const rate of [22050, 44100, 48000, 96000]) {
    let memory = 0;
    for (const buffer of makeBuffers(controlledContext(rate))) {
      assert.equal(buffer.numberOfChannels, 1);
      const samples = buffer.getChannelData(0);
      memory += samples.byteLength;
      let peak = 0, squareSum = 0, biggestStep = 0;
      for (let i = 0; i < samples.length; i++) {
        assert.ok(Number.isFinite(samples[i]));
        peak = Math.max(peak, Math.abs(samples[i]));
        squareSum += samples[i] ** 2;
        if (i) biggestStep = Math.max(biggestStep, Math.abs(samples[i] - samples[i - 1]));
      }
      assert.ok(peak < 0.8, `bounded peak ${peak}`);
      assert.ok(Math.sqrt(squareSum / samples.length) > 0.001, 'buffer has audible signal');
      assert.ok(biggestStep < 0.13, `no abrupt impulse ${biggestStep}`);
      assert.equal(Math.abs(samples[0]), 0);
      assert.equal(Math.abs(samples.at(-1)), 0);
    }
    assert.ok(memory <= 6_500_000, `${memory} bytes at host rate ${rate}`);
  }
});

test('bubble and whale voices contain quiet intervals and underwater noise is spectrally subdued', () => {
  const [water, bubbles, whale, current] = makeBuffers(controlledContext());
  for (const buffer of [bubbles, whale]) {
    const samples = buffer.getChannelData(0);
    const silent = samples.reduce((count, value) => count + (Math.abs(value) < 0.00001 ? 1 : 0), 0) / samples.length;
    assert.ok(silent > 0.32, `sparse events leave ${silent * 100}% quiet`);
  }
  for (const buffer of [water, whale, current]) {
    const samples = buffer.getChannelData(0);
    let low = 0, highEnergy = 0, allEnergy = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * 2000 / buffer.sampleRate);
    for (const sample of samples) {
      low += (sample - low) * alpha;
      highEnergy += (sample - low) ** 2;
      allEnergy += sample ** 2;
    }
    assert.ok(highEnergy / allEnergy < 0.08, `high-frequency energy ${highEnergy / allEnergy}`);
  }
});

test('starting audio requires unlocked engine, creates four silent loops once, then opens progressively', () => {
  const f = fixture();
  f.engine.state = 'locked';
  f.soundscape.start();
  assert.equal(f.world.root.children.length, 0);
  f.engine.state = 'running';
  f.soundscape.start();
  f.soundscape.start();
  assert.equal(f.world.root.children.length, 4);
  for (const audio of f.world.root.children) {
    assert.equal(audio.gain.gain.value, 0);
    assert.equal(audio.loop, true);
    assert.equal(audio.isPlaying, true);
    assert.ok(audio.offset >= 0 && audio.offset < audio.buffer.duration);
  }
  f.step(1, false, 0);
  const closed = f.world.root.children[0].gain.gain.value;
  f.step(1, false, 0.5);
  const half = f.world.root.children[0].gain.gain.value;
  f.step(2, true);
  const inside = f.world.root.children[0].gain.gain.value;
  assert.ok(closed < half && half < inside);
});

test('all underwater clips keep their acoustic ceilings inside, including maximum close-seam lean', () => {
  const f = fixture();
  f.soundscape.start();
  for (const inside of [false, true]) {
    f.step(4, inside, 1, 1);
    f.world.root.children.forEach((audio, i) => {
      const filter = audio.filters[0];
      assert.equal(filter.type, 'lowpass');
      assert.ok(filter.frequency.value <= UNDERWATER_SOUNDS[i].maxCutoff);
      assert.ok(filter.frequency.value >= 420);
    });
  }
  const land = fixture([WORLD_TWO_SOUNDS.find(clip => clip.synth === 'wind')]);
  land.soundscape.start();
  land.step(4, true);
  assert.ok(land.world.root.children[0].filters[0].frequency.value > CONFIG.audio.leakOpenCutoff * 0.99, 'forest retains its open high-frequency character');
});

test('positional sources and native panners follow a translated, rotated world exactly once', () => {
  const f = fixture();
  f.soundscape.start();
  f.world.root.position.set(8, -2, 11);
  f.world.root.rotation.y = 1.2;
  f.world.root.updateMatrixWorld(true);
  f.world.root.children.forEach((audio, i) => {
    const local = f.world.soundSpots[UNDERWATER_SOUNDS[i].spot];
    assert.ok(audio.position.distanceTo(local) < 1e-10);
    const expected = local.clone().applyMatrix4(f.world.root.matrixWorld);
    assert.ok(audio.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-10);
    assert.ok(Math.abs(audio.panner.positionX.value - expected.x) < 1e-10);
    assert.ok(Math.abs(audio.panner.positionY.value - expected.y) < 1e-10);
    assert.ok(Math.abs(audio.panner.positionZ.value - expected.z) < 1e-10);
  });
});

test('leaving underwater fades existing gain smoothly to exact zero and re-entry restores the sound', () => {
  const f = fixture();
  f.soundscape.start();
  f.step(4, true);
  let previous = f.world.root.children.map(audio => audio.gain.gain.value);
  f.soundscape.mute(1 / 72);
  const first = f.world.root.children.map(audio => audio.gain.gain.value);
  first.forEach((value, i) => assert.ok(value < previous[i] && value > previous[i] * 0.8, 'no abrupt volume drop on first inactive frame'));
  previous = first;
  for (let frame = 0; frame < 240; frame++) {
    f.soundscape.mute(1 / 72);
    f.world.root.children.forEach((audio, i) => {
      assert.ok(audio.gain.gain.value <= previous[i]);
      previous[i] = audio.gain.gain.value;
    });
  }
  for (const audio of f.world.root.children) assert.equal(audio.gain.gain.value, 0);
  f.step(2, true);
  for (const audio of f.world.root.children) assert.ok(audio.gain.gain.value > 0.01);
});
