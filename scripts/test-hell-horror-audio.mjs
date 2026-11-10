import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }) };
    return next(url, context);
  }
});
const { HellHorrorAudio, HELL_MONSTER_CLIPS } = await import('../src/audio/HellHorrorAudio.ts');

function param(value = 0) {
  return { value, setTargetAtTime(value) { this.value = value; }, setValueAtTime(value) { this.value = value; },
    cancelScheduledValues() {}, linearRampToValueAtTime(value) { this.value = value; } };
}
function node(extra = {}) { return { connect() {}, disconnect() {}, ...extra }; }
function fixture(t, { fail = false, rate = 48000, sky = false } = {}) {
  let panners = 0;
  const ctx = {
    currentTime: 0, state: 'running', sampleRate: rate,
    createBuffer(channels, length, sampleRate) {
      const samples = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, numberOfChannels: channels, sampleRate, duration: length / sampleRate, getChannelData: i => samples[i] };
    },
    createGain: () => node({ gain: param(1) }),
    createPanner: () => { panners++; return node(Object.fromEntries(
      ['positionX','positionY','positionZ','orientationX','orientationY','orientationZ'].map(key => [key,param()]))); },
    createBiquadFilter: () => node({ frequency: param(), Q: param(1) }),
    createBufferSource: () => node({ playbackRate: param(1), detune: param(), start() {}, stop() {} }),
    async decodeAudioData(bytes) {
      // Controlled WAV decoder retains real samples and models the host-rate
      // resampling done by browsers; native browser decode remains a UI check.
      const pcm = Buffer.from(bytes), sourceRate = pcm.readUInt32LE(24), sourceCount = pcm.readUInt32LE(40) / 2;
      const length = Math.round(sourceCount * rate / sourceRate), buffer = ctx.createBuffer(1, length, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = pcm.readInt16LE(44 + Math.min(sourceCount - 1, Math.floor(i * sourceRate / rate)) * 2) / 32768;
      return buffer;
    }
  };
  const requested = [];
  t.mock.method(globalThis, 'fetch', async file => {
    assert.ok(HELL_MONSTER_CLIPS.some(clip => clip.file === file), `Unexpected request ${file}`);
    requested.push(file);
    if (fail === true || (fail === 'first' && file === HELL_MONSTER_CLIPS[0].file) ||
        (fail === 'sky' && HELL_MONSTER_CLIPS.find(clip => clip.file === file)?.kind === 'sky')) return { ok: false };
    const data = readFileSync(new URL(`../public${file}`, import.meta.url));
    return { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  });
  const environmentalBus = node(), listener = { context: ctx, getInput: () => environmentalBus, timeDelta: 1/72 };
  const engine = { state: 'running', ctx, listener };
  const root = new THREE.Group(), faunaRoot = new THREE.Group(); root.add(faunaRoot);
  const creatures = [-7, 7].map((x, i) => { const group = new THREE.Group(); group.position.set(x,0,-8-i*8); faunaRoot.add(group); return { root: group, height: i ? 2.25 : 2.45 }; });
  const skyPositions = [new THREE.Vector3(-8, 7, -14), new THREE.Vector3(9, 10, -20)];
  const world = { root, fauna: { creatures }, ...(sky ? {
    getSkyCreaturePositions(out) { skyPositions.forEach((at, i) => out[i].copy(at)); return skyPositions.length; }
  } : {}) }, audio = new HellHorrorAudio(engine, world);
  const sources = () => { const result = []; root.traverse(child => { if (child instanceof THREE.PositionalAudio) result.push(child); }); return result; };
  const step = (seconds, inside = true) => {
    let maximum = 0;
    for (let i = 0; i < Math.round(seconds*72); i++) {
      ctx.currentTime += 1/72; audio.update(1/72, inside ? 1 : 0, 0, inside); root.updateMatrixWorld(true);
      maximum = Math.max(maximum, sources().filter(source => source.isPlaying).length);
    }
    return maximum;
  };
  return { ctx, engine, world, audio, sources, step, requested, skyPositions, panners: () => panners };
}

test('bundled licensed effects are mono24k, short, quiet-edged and hash-verified', () => {
  const folder = new URL('../public/audio/hell/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('SOURCE.json', folder)));
  assert.equal(manifest.length,6);
  let bytes = 0;
  for (const entry of manifest) {
    const data = readFileSync(new URL(entry.file, folder)); bytes += data.length;
    assert.equal(createHash('sha256').update(data).digest('hex'),entry.sha256);
    assert.equal(entry.license,'CC0-1.0'); assert.ok(entry.source.startsWith('https://opengameart.org/content/'));
    assert.equal(data.toString('ascii',0,4),'RIFF'); assert.equal(data.readUInt16LE(22),1);
    assert.equal(data.readUInt32LE(24),24000); assert.equal(data.readUInt16LE(34),16);
    assert.equal(data.readInt16LE(44),0); assert.equal(data.readInt16LE(data.length-2),0);
    let peak = 0, sum = 0;
    for (let i=44;i<data.length;i+=2) { const value=data.readInt16LE(i)/32768; peak=Math.max(peak,Math.abs(value)); sum+=value*value; }
    assert.ok(peak <= .461 && peak > .2); assert.ok(Math.sqrt(sum/((data.length-44)/2)) > .02);
  }
  assert.ok(bytes < 650000, `${bytes} bytes`);
});

test('unlock starts only two pooled voices and decodes once; preview remains silent', async t => {
  const f=fixture(t,{rate:96000});
  f.engine.state='locked'; f.audio.start(); assert.equal(f.panners(),0); assert.equal(f.requested.length,0);
  f.engine.state='running'; f.audio.start(); f.audio.start(); await f.audio.ready;
  assert.equal(f.panners(),2); assert.equal(f.requested.length,6); assert.equal(f.audio.status,'ready');
  assert.ok(f.audio.stats.decodedBytes < 1300000);
  f.step(30,false); assert.equal(f.audio.stats.creatureCalls,0); assert.equal(f.audio.stats.stoneEvents,0);
  assert.ok(f.sources().every(source=>!source.isPlaying && source.getVolume()===0));
});

test('first creature waits5–8seconds and voices follow actual actors through alignment', async t => {
  const f=fixture(t); f.audio.start(); await f.audio.ready;
  f.step(4.9); assert.equal(f.audio.stats.creatureCalls,0);
  f.step(3.2); assert.ok(f.audio.stats.creatureCalls>=1);
  const source=f.sources().find(source=>source.isPlaying);
  assert.ok(source); assert.ok(f.world.fauna.creatures.some(actor=>actor.root===source.parent));
  const actor=f.world.fauna.creatures.find(actor=>actor.root===source.parent);
  assert.equal(source.position.y,actor.height*.88); assert.equal(source.loop,false); assert.equal(source.panner.panningModel,'HRTF');
  f.world.root.position.set(18,.4,-9); f.world.root.rotation.y=1.4;
  source.parent.position.x+=1.5; f.world.root.updateMatrixWorld(true);
  const expected=source.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(source.panner.positionX.value-expected.x)<1e-8);
  assert.ok(Math.abs(source.panner.positionY.value-expected.y)<1e-8);
  assert.ok(Math.abs(source.panner.positionZ.value-expected.z)<1e-8);
});

test('five minutes keeps sparse variation, headroom and the same two audio nodes', async t => {
  const f=fixture(t); f.audio.start(); await f.audio.ready;
  const initial=new Set(f.sources());
  const max=f.step(300);
  assert.ok(max<=2 && max>=1); assert.equal(f.panners(),2);
  assert.ok(f.audio.stats.creatureCalls>=10 && f.audio.stats.creatureCalls<40,f.audio.stats.creatureCalls);
  assert.ok(f.audio.stats.stoneEvents>4 && f.audio.stats.stoneEvents<25);
  assert.ok(f.sources().every(source=>initial.has(source) && source.getVolume()<=.82));
});

test('departure fades to silence; focus loss stops immediately and resume waits again', async t => {
  const f=fixture(t); f.audio.start(); await f.audio.ready; f.step(8.1);
  assert.ok(f.sources().some(source=>source.isPlaying));
  const calls=f.audio.stats.creatureCalls; f.step(2,false);
  assert.ok(f.sources().every(source=>!source.isPlaying && source.getVolume()===0));
  f.step(4.9); assert.equal(f.audio.stats.creatureCalls,calls);
  f.step(3.2); assert.ok(f.sources().some(source=>source.isPlaying));
  f.audio.mute(0,true); assert.equal(f.audio.stats.playing,0); assert.ok(f.sources().every(source=>!source.isPlaying && source.getVolume()===0));
  f.ctx.state='suspended'; f.step(20); assert.equal(f.audio.stats.playing,0);
  f.ctx.state='running'; const old=f.audio.stats.creatureCalls; f.step(4.9); assert.equal(f.audio.stats.creatureCalls,old);
});

test('missing recordings settle fallback without fake replacement calls or repeated fetches', async t => {
  const f=fixture(t,{fail:true}); f.audio.start(); await f.audio.ready;
  assert.equal(f.audio.status,'fallback'); assert.equal(f.audio.failedFiles.length,6); f.step(60);
  assert.equal(f.audio.stats.playing,0); assert.equal(f.audio.stats.creatureCalls,0); assert.equal(f.audio.stats.stoneEvents,0);
  f.audio.start(); assert.equal(f.requested.length,6);
});

test('one failed creature file still permits the surviving authored voice', async t => {
  const f=fixture(t,{fail:'first'}); f.audio.start(); await f.audio.ready;
  assert.equal(f.audio.status,'fallback'); assert.equal(f.audio.failedFiles.length,1);
  f.step(8.1); assert.ok(f.audio.stats.creatureCalls>=1);
  assert.ok(f.sources().some(source=>source.isPlaying));
});

test('sky calls follow the rendered flying actor and remain in the same two-voice pool', async t => {
  const f = fixture(t, { sky: true }); f.audio.start(); await f.audio.ready;
  // Stop at the first actual sky event, rather than assuming a random cue time.
  for (let i = 0; i < 16 * 72 && !f.audio.stats.skyCalls; i++) f.step(1 / 72);
  assert.equal(f.audio.stats.skyCalls, 1);
  const source = f.sources().find(source => source.isPlaying && source.parent === f.world.root);
  assert.ok(source); assert.ok(source.position.equals(f.skyPositions[0]));
  assert.equal(source.getRefDistance(), 11);
  f.skyPositions[0].set(-3, 12, -18); f.step(.2);
  assert.ok(source.position.equals(f.skyPositions[0]));
  f.world.root.position.set(11, .7, -8); f.world.root.rotation.y = -.6; f.world.root.updateMatrixWorld(true);
  const expected = source.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(source.panner.positionX.value - expected.x) < 1e-8);
  assert.ok(Math.abs(source.panner.positionY.value - expected.y) < 1e-8);
  assert.ok(Math.abs(source.panner.positionZ.value - expected.z) < 1e-8);
  assert.ok(f.step(180) <= 2); assert.equal(f.panners(), 2);
  assert.ok(f.audio.stats.skyCalls >= 5 && f.audio.stats.skyCalls < 20);
});

test('no flying actor means no disembodied sky calls; missing sky assets retain ground voices', async t => {
  const f = fixture(t); f.audio.start(); await f.audio.ready; f.step(60);
  assert.equal(f.audio.stats.skyCalls, 0); assert.ok(f.audio.stats.creatureCalls > 0);
});

test('missing sky recordings remain silent and never replace ground voices', async t => {
  const f = fixture(t, { sky: true, fail: 'sky' }); f.audio.start(); await f.audio.ready; f.step(90);
  assert.equal(f.audio.status, 'fallback'); assert.equal(f.audio.failedFiles.length, 2);
  assert.equal(f.audio.stats.skyCalls, 0); assert.ok(f.audio.stats.creatureCalls > 0);
  f.audio.mute(0, true); assert.ok(f.sources().every(source => !source.isPlaying && source.getVolume() === 0));
});

test('hidden page and a suspended context stop all moving sky sources immediately', async t => {
  const f = fixture(t, { sky: true }); f.audio.start(); await f.audio.ready;
  for (let i = 0; i < 16 * 72 && !f.audio.stats.skyCalls; i++) f.step(1 / 72);
  assert.ok(f.sources().some(source => source.isPlaying));
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const visibility = { hidden: true };
  Object.defineProperty(globalThis, 'document', { value: visibility, configurable: true });
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  f.step(.1); assert.equal(f.audio.stats.playing, 0);
  assert.ok(f.sources().every(source => !source.isPlaying && source.getVolume() === 0));
  visibility.hidden = false;
  for (let i = 0; i < 16 * 72 && !f.sources().some(source => source.isPlaying); i++) f.step(1 / 72);
  assert.ok(f.sources().some(source => source.isPlaying));
  f.ctx.state = 'suspended'; f.step(.1);
  assert.equal(f.audio.stats.playing, 0);
  assert.ok(f.sources().every(source => !source.isPlaying && source.getVolume() === 0));
});

test('the two strongest horror voices have bounded peak headroom at the shared master', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/audio/hell/SOURCE.json', import.meta.url)));
  const peaks = HELL_MONSTER_CLIPS.map(clip => clip.gain * manifest.find(entry => clip.file.endsWith('/' + entry.file)).peak)
    .sort((a, b) => b - a);
  const layerMaximumAtMaster = (peaks[0] + peaks[1]) * .9;
  assert.ok(layerMaximumAtMaster < .7, layerMaximumAtMaster);
});
