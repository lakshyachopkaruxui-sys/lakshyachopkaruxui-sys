// Deterministic lifecycle and asset checks; not a claim of headset listening tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

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
      format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true
    };
    return nextLoad(url, context);
  }
});

const { Narration } = await import('../src/audio/Narration.ts');
const { NARRATION_SCRIPT } = await import('../src/audio/narrationScript.ts');
const manifestFile = `../public${NARRATION_SCRIPT.opening.file.replace(/[^/]+$/, 'manifest.json')}`;
const legacyScript = Object.fromEntries(Object.entries(NARRATION_SCRIPT).map(([id, cue]) => [id, { ...cue, segments: undefined }]));
const speechOnly = Object.fromEntries(Object.entries(legacyScript).map(([id, cue]) => [id, { ...cue, file: undefined }]));
const localVoice = { name: 'Local test voice', localService: true, lang: 'en-US', default: true };
Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, writable: true, value: undefined });
Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: undefined });
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: undefined });

function fixture(t, { voices = [], state = 'running', script = legacyScript, fetcher } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spoken = [], cancelled = [], ducks = [], captions = [], sources = [];
  let speechListeners = new Map();
  const synth = {
    getVoices: () => voices,
    addEventListener: (type, callback) => speechListeners.set(type, callback),
    removeEventListener: type => speechListeners.delete(type),
    speak: utterance => spoken.push(utterance),
    cancel: () => cancelled.push(true)
  };
  t.mock.property(globalThis, 'speechSynthesis', synth);
  t.mock.property(globalThis, 'SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
  t.mock.method(globalThis, 'fetch', fetcher ?? (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })));
  const engine = {
    ctx: {
      state, destination: {},
      createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
      decodeAudioData: async () => ({ duration: 3 }),
      createBufferSource: () => {
        const source = { starts: 0, stops: 0, disconnects: 0, connect() {},
          start() { this.starts++; }, stop() { this.stops++; }, disconnect() { this.disconnects++; } };
        sources.push(source);
        return source;
      }
    },
    setNarrationDucking: active => ducks.push(active)
  };
  const narration = new Narration(engine, { onCaption: value => captions.push(value) }, script);
  t.after(() => narration.dispose());
  return { narration, engine, spoken, cancelled, ducks, captions, sources, synth, speechListeners };
}

const shortTimeline = Object.fromEntries(Object.entries(NARRATION_SCRIPT).map(([id, cue]) => [id, {
  ...cue, durationSeconds: 3.5, segments: [
    { start: .2, end: .8, text: 'First phrase.' },
    { start: 1.4, end: 2.1, text: 'Second phrase.' }
  ]
}]));

function tabChannels(t, deferred = false) {
  const channels = [], pending = [];
  channels.flush = () => pending.splice(0).forEach(deliver => deliver());
  t.mock.property(globalThis, 'window', { BroadcastChannel: class {
    constructor(name) { this.name = name; this.closed = false; channels.push(this); }
    postMessage(value) { for (const peer of channels) if (peer !== this && !peer.closed && peer.name === this.name) {
      const deliver = () => peer.onmessage?.({ data: value });
      if (deferred) pending.push(deliver); else deliver();
    } }
    close() { this.closed = true; }
  } });
  return channels;
}

test('a second Tear tab stops the first voice and disposal closes its channel', async t => {
  const channels = tabChannels(t), f = fixture(t);
  await f.narration.prepare(); f.narration.play('ocean');
  const other = new window.BroadcastChannel('tear:narration');
  other.postMessage({ type: 'claim', at: Date.now() + 1, owner: 'other' });
  assert.equal(f.sources[0].stops, 1);
  assert.equal(f.captions.at(-1), null);
  f.narration.dispose(); assert.equal(channels[0].closed, true); other.close();
});

test('another tab invalidates a queued decode so it cannot restart an old voice', async t => {
  tabChannels(t); let resolveDecode;
  const f = fixture(t);
  f.engine.ctx.decodeAudioData = () => new Promise(resolve => { resolveDecode = resolve; });
  f.narration.play('shadow');
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const other = new window.BroadcastChannel('tear:narration'); other.postMessage({ type: 'claim', at: Date.now() + 1, owner: 'other' });
  resolveDecode({ duration: 3 });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(f.sources.length, 0); assert.equal(f.captions.at(-1), null); other.close();
});

test('simultaneous tabs keep the newer take when queued claims arrive out of order', async t => {
  const channels = tabChannels(t, true), f = fixture(t);
  let clock = 1000; t.mock.method(Date, 'now', () => clock);
  const second = new Narration(f.engine, { onCaption() {} }, legacyScript);
  t.after(() => second.dispose());
  await f.narration.prepare(); await second.prepare();
  f.narration.play('ocean'); clock++;
  second.play('shadow'); channels.flush();
  assert.equal(f.narration.source, null);
  assert.ok(second.source, 'the older queued claim must not silence the newer take');
});

test('a muted caption-only cue keeps its text when another tab speaks', async t => {
  tabChannels(t); const f = fixture(t);
  await f.narration.prepare(); f.narration.play('ocean'); f.narration.setEnabled(false);
  const other = new window.BroadcastChannel('tear:narration');
  other.postMessage({ type: 'claim', at: Date.now() + 1, owner: 'other' });
  assert.equal(f.captions.at(-1).id, 'ocean');
  assert.equal(f.captions.at(-1).mode, 'captions'); other.close();
});

test('phrase captions and ducking follow the audio clock, with empty pause gaps', async t => {
  const f = fixture(t, { script: shortTimeline });
  f.engine.ctx.currentTime = 10;
  await f.narration.prepare(); f.narration.play('ocean');
  assert.equal(f.captions.at(-1), null);
  f.engine.ctx.currentTime = 10.2; t.mock.timers.tick(200);
  assert.equal(f.captions.at(-1).text, 'First phrase.');
  assert.deepEqual(f.ducks, [true]);
  f.engine.ctx.currentTime = 10.8; t.mock.timers.tick(600);
  assert.equal(f.captions.at(-1), null);
  assert.deepEqual(f.ducks, [true, false]);
  f.engine.ctx.currentTime = 11.4; t.mock.timers.tick(600);
  assert.equal(f.captions.at(-1).text, 'Second phrase.');
  f.engine.ctx.currentTime = 12.1; t.mock.timers.tick(700);
  assert.equal(f.captions.at(-1), null);
});

test('suspended audio holds the current phrase until its actual boundary', async t => {
  const f = fixture(t, { script: shortTimeline });
  f.engine.ctx.currentTime = 0;
  await f.narration.prepare(); f.narration.play('shadow');
  f.engine.ctx.currentTime = .2; t.mock.timers.tick(200);
  f.engine.ctx.state = 'suspended'; t.mock.timers.tick(5000);
  assert.equal(f.captions.at(-1).text, 'First phrase.');
  f.engine.ctx.state = 'running'; f.engine.ctx.currentTime = .8;
  t.mock.timers.tick(250);
  assert.equal(f.captions.at(-1), null);
  f.narration.stop(); t.mock.timers.tick(10000);
  assert.equal(f.captions.at(-1), null);
});

test('muting mid-phrase preserves its remaining caption time and replay starts fresh', async t => {
  const f = fixture(t, { script: shortTimeline });
  f.engine.ctx.currentTime = 0;
  await f.narration.prepare(); f.narration.play('forest');
  f.engine.ctx.currentTime = .5; t.mock.timers.tick(500);
  f.narration.setEnabled(false);
  assert.equal(f.captions.at(-1).text, 'First phrase.');
  assert.ok(Math.abs(f.captions.at(-1).durationSeconds - .3) < .001);
  t.mock.timers.tick(301); assert.equal(f.captions.at(-1), null);
  f.narration.setEnabled(true); assert.equal(f.sources.length, 1);
  f.narration.play('forest', true); assert.equal(f.captions.at(-1), null);
  f.engine.ctx.currentTime = .7; t.mock.timers.tick(200);
  assert.equal(f.captions.at(-1).text, 'First phrase.');
});

test('crossing during a pause cannot reveal the abandoned cue later', async t => {
  const f = fixture(t, { script: shortTimeline });
  f.engine.ctx.currentTime = 0;
  await f.narration.prepare(); f.narration.play('ocean');
  f.engine.ctx.currentTime = .8; t.mock.timers.tick(800);
  f.narration.play('shadow');
  const start = f.captions.length;
  f.engine.ctx.currentTime = 2.2; t.mock.timers.tick(1400);
  assert.ok(f.captions.slice(start).every(caption => !caption || caption.id === 'shadow'));
});

test('voice queued behind scene downloads can still load after four seconds', async t => {
  const pending=[];
  const f=fixture(t,{fetcher:(_url,options)=>new Promise(resolve=>pending.push({resolve,signal:options.signal}))});
  const preparing=f.narration.prepare();
  t.mock.timers.tick(5000);
  assert.equal(pending.length,5);
  assert.ok(pending.every(request=>!request.signal.aborted));
  pending.forEach(request=>request.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}));
  await preparing;
  f.narration.play('opening');
  assert.equal(f.sources[0].starts,1,'prepared voice plays without a replacement fetch');
});

test('all five encoded tracks match the approved timeline and remain small', () => {
  const manifest = JSON.parse(readFileSync(new URL(manifestFile, import.meta.url)));
  assert.deepEqual(Object.keys(NARRATION_SCRIPT), ['opening', 'ocean', 'shadow', 'forest', 'return']);
  let bytes = 0;
  for (const [id, cue] of Object.entries(NARRATION_SCRIPT)) {
    const file = readFileSync(new URL(`../public${cue.file}`, import.meta.url));
    assert.equal(file.toString('ascii', 0, 4), 'OggS');
    assert.equal(createHash('sha256').update(file).digest('hex'), manifest.clips[id].sha256);
    assert.ok(file.length < 500_000); bytes += file.length;
    assert.equal(cue.text, manifest.clips[id].text);
    assert.deepEqual(cue.segments, manifest.clips[id].segments);
    let previous = 0;
    for (const segment of cue.segments) {
      assert.ok(segment.start >= previous && segment.end > segment.start);
      assert.ok(segment.end < cue.durationSeconds);
      assert.ok(segment.text.length > 0 && segment.text.length < 110);
      previous = segment.end;
    }
    // Ogg granule position is the decoded sample count, independent of the authoring manifest.
    let last = 0n, rate = 0;
    for (let pos = 0; pos < file.length;) {
      assert.equal(file.toString('ascii', pos, pos + 4), 'OggS');
      const count = file[pos + 26], body = pos + 27 + count;
      if (!rate) { assert.equal(file.toString('ascii', body + 1, body + 7), 'vorbis'); assert.equal(file[body + 11], 1, 'voice is mono for the headset'); rate = file.readUInt32LE(body + 12); }
      const granule = file.readBigInt64LE(pos + 6); if (granule > last) last = granule;
      let size = 0; for (let i = 0; i < count; i++) size += file[pos + 27 + i];
      pos = body + size;
    }
    assert.equal(rate, 24000);
    assert.ok(Math.abs(Number(last) / rate - manifest.clips[id].total_seconds) < .002);
  }
  assert.ok(bytes < 500_000, 'all five prerecorded tracks stay small for headset entry');
});

test('preloading is silent; real playback ducks the mix and restores it on completion', async t => {
  const f = fixture(t);
  await f.narration.prepare();
  assert.equal(f.sources.length, 0);
  assert.deepEqual(f.ducks, []);
  assert.equal(f.narration.play('opening'), true);
  assert.equal(f.sources[0].starts, 1);
  assert.equal(f.captions.at(-1).mode, 'audio');
  assert.deepEqual(f.ducks, [true]);
  f.sources[0].onended();
  assert.deepEqual(f.ducks, [true, false]);
  t.mock.timers.tick(NARRATION_SCRIPT.opening.durationSeconds * 1000 - 100);
  assert.equal(f.captions.at(-1).id, 'opening');
  t.mock.timers.tick(100);
  assert.equal(f.captions.at(-1), null);
});

test('whisper and performance pauses are authored into the same tracks', () => {
  const manifest = JSON.parse(readFileSync(new URL(manifestFile, import.meta.url)));
  assert.equal(manifest.pitch_semitones, 0);
  assert.equal(manifest.nonlinear_compression, false);
  assert.ok(manifest.tail_seconds <= .6); assert.equal(manifest.wet_gain, 0);
  assert.equal(manifest.effects.reverb, 0); assert.equal(manifest.effects.echo, 0);
  for (const clip of Object.values(manifest.clips)) assert.ok(clip.peak > .05 && clip.peak < .95);
  assert.ok(NARRATION_SCRIPT.shadow.segments.every(segment => segment.kind === 'whisper'));
  assert.equal(NARRATION_SCRIPT.shadow.segments[0].text, '[Whisper] No...');
  assert.equal(manifest.clips.shadow.source, 'shadow-stifled-v2.wav', 'the selected B performance is preserved');
  const ending = NARRATION_SCRIPT.return.segments;
  assert.equal(ending.at(-1).kind, 'whisper');
  assert.ok(ending.at(-1).start - ending.at(-2).end > 3, 'ending holds before the fearful realization');
});

test('opening and return play once each per session; explicit replay and new session work', async t => {
  const f = fixture(t);
  await f.narration.prepare();
  assert.equal(f.narration.play('opening'), true);
  assert.equal(f.narration.play('opening'), false);
  assert.equal(f.narration.play('return'), true);
  assert.equal(f.sources[0].stops, 1, 'new words stop the previous cue');
  assert.equal(f.narration.play('return', true), true);
  f.narration.startSession();
  assert.equal(f.narration.play('opening'), true);
});

test('late decode after exit cannot start sound or restore cleared captions', async t => {
  let resolveDecode;
  const f = fixture(t);
  f.engine.ctx.decodeAudioData = () => new Promise(resolve => { resolveDecode = resolve; });
  f.narration.play('opening');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  f.narration.stop();
  resolveDecode({ duration: 3 });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(f.sources.length, 0);
  assert.equal(f.captions.at(-1), null);
});

test('muting cancels current audio, preserves captions, and next cue remains caption-only', async t => {
  const f = fixture(t);
  await f.narration.prepare();
  f.narration.play('opening');
  f.narration.setEnabled(false);
  assert.equal(f.sources[0].stops, 1);
  assert.equal(f.captions.at(-1).mode, 'captions');
  assert.deepEqual(f.ducks, [true, false]);
  f.narration.play('return');
  assert.equal(f.sources.length, 1);
  assert.equal(f.captions.at(-1).id, 'return');
  f.narration.setEnabled(true);
  f.narration.play('return', true);
  assert.equal(f.sources.length, 2);
});

test('suspended audio context retains captions without invoking device speech', t => {
  const f = fixture(t, { state: 'suspended', script: speechOnly, voices: [
    { ...localVoice, localService: false }, { ...localVoice, lang: 'fr-FR' }
  ] });
  f.narration.play('opening');
  assert.equal(f.spoken.length, 0);
  assert.equal(f.captions.at(-1).mode, 'captions');
  assert.deepEqual(f.ducks, []);
  t.mock.timers.tick(NARRATION_SCRIPT.opening.durationSeconds * 1000);
  assert.equal(f.captions.at(-1), null);
});

test('muting invalidates a queued decode even if voice is re-enabled before loading finishes', async t => {
  let resolveDecode;
  const f = fixture(t);
  f.engine.ctx.decodeAudioData = () => new Promise(resolve => { resolveDecode = resolve; });
  f.narration.play('opening');
  for (let i = 0; i < 4; i++) await Promise.resolve();
  f.narration.setEnabled(false);
  f.narration.setEnabled(true);
  resolveDecode({ duration: 3 });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(f.sources.length, 0, 'enabling alone must not restart a cancelled line');
  assert.equal(f.spoken.length, 0);
  assert.equal(f.captions.at(-1).mode, 'captions');
  t.mock.timers.tick(NARRATION_SCRIPT.opening.durationSeconds * 1000);
  assert.equal(f.captions.at(-1), null, 'caption cleanup still runs after invalidation');
  assert.equal(f.narration.play('opening', true), true);
  assert.equal(f.sources.length, 1, 'explicit replay can use the loaded file');
});

test('unavailable audio keeps captions even when a female default voice exists', async t => {
  const f = fixture(t, { voices: [{ ...localVoice, name: 'Microsoft Zira Desktop' }], fetcher: async () => ({ ok: false, status: 404 }) });
  f.narration.play('opening');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(f.spoken.length, 0, 'the requested narrator is never replaced by a device voice');
  assert.equal(f.captions.at(-1).mode, 'captions');
  assert.deepEqual(f.ducks, []);
});

test('an audio start failure preserves captions without leaving ambience ducked', async t => {
  const f = fixture(t);
  await f.narration.prepare();
  f.engine.ctx.createBufferSource = () => ({ connect() {}, disconnect() {}, stop() {}, start() { throw new Error('device unavailable'); } });
  f.narration.play('opening');
  assert.equal(f.captions.at(-1).mode, 'captions');
  assert.equal(f.spoken.length, 0);
  assert.deepEqual(f.ducks, []);
});

test('a late previous audio completion cannot stop a newer cue', async t => {
  const f = fixture(t);
  await f.narration.prepare();
  f.narration.play('opening');
  const lateEnd = f.sources[0].onended;
  f.narration.play('return');
  lateEnd();
  assert.equal(f.captions.at(-1).id, 'return');
  assert.equal(f.ducks.at(-1), true);
});

test('disposing aborts loading, removes listeners, and rejects any later playback', async t => {
  let signal;
  const f = fixture(t, { fetcher: (_, options) => {
    signal = options.signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  f.narration.play('opening');
  f.narration.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(f.speechListeners.size, 0);
  assert.equal(f.narration.play('opening', true), false);
});
