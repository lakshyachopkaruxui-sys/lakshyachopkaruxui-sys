// Read real asset bytes but use a controlled decoded signal. Native MP3/WAV
// decoding remains a browser integration check, not something this mock proves.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function recordedAudioFixture(t, ctx, allowedFiles, { fail = false } = {}) {
  const requested = [], decoded = [], warnings = [];
  const allowed = new Set(allowedFiles);
  t.mock.method(globalThis, 'fetch', async url => {
    assert.ok(allowed.has(url), `unexpected audio request ${url}`);
    requested.push(url);
    if (fail) return { ok: false, status: 503, statusText: 'Controlled unavailable recording' };
    const bytes = readFileSync(new URL(`../../public${url}`, import.meta.url));
    assert.ok(bytes.length > 44, 'fixture must read a real bundled audio asset');
    return {
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
  });
  ctx.decodeAudioData = async bytes => {
    decoded.push(bytes);
    // A finite stereo signal makes loopTrim exercise its real fold-down and
    // edge treatment, while retaining a recognisable non-silent result.
    const buffer = ctx.createBuffer(2, ctx.sampleRate * 3, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let index = 0; index < samples.length; index++) {
        samples[index] = 0.12 * Math.sin(2 * Math.PI * (120 + channel * 20) * index / ctx.sampleRate);
      }
    }
    return buffer;
  };
  if (fail) t.mock.method(console, 'warn', (...args) => warnings.push(args));
  return {
    requested, decoded, warnings,
    settle: () => new Promise(resolve => setImmediate(resolve))
  };
}

/** Asset completion order differs from ClipSpec order; match spatial identity. */
export function clipAtSource(audio, world, clips) {
  const matches = clips.filter(clip => audio.position.distanceTo(world.soundSpots[clip.spot]) < 1e-10);
  assert.equal(matches.length, 1, 'each tested source resolves to exactly one semantic sound spot');
  return matches[0];
}
