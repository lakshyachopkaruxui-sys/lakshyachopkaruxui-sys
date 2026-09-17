import { mulberry32 } from '../utils/math';

// Original synthesized ambience and fallbacks for recorded forest clips.
// The tear's own sounds stay procedural so they can follow the hands in real time.

const rng = mulberry32(5);

function make(ctx: BaseAudioContext, seconds: number, fill: (data: Float32Array, rate: number) => void, rate = ctx.sampleRate) {
  const buf = ctx.createBuffer(1, Math.floor(seconds * rate), rate);
  fill(buf.getChannelData(0), rate);
  return buf;
}

// These low-frequency voices need no full-bandwidth PCM. The four underwater
// loops together use at most 6.4 MB, including on a 96 kHz host audio device.
const marineRate = (ctx: BaseAudioContext) => Math.min(ctx.sampleRate, 32000);

/** A broad, slow water body, with no surface hiss or recognisable land sounds. */
export function underwaterBuffer(ctx: BaseAudioContext) {
  const r = mulberry32(73011);
  return make(ctx, 12, (d, rate) => {
    let low = 0, broad = 0, softened = 0;
    const lowAlpha = 1 - Math.exp(-2 * Math.PI * 100 / rate);
    const broadAlpha = 1 - Math.exp(-2 * Math.PI * 380 / rate);
    for (let i = 0; i < d.length; i++) {
      const t = i / rate;
      const noise = r() * 2 - 1;
      low += (noise - low) * lowAlpha;
      broad += (noise - broad) * broadAlpha;
      softened += (broad - softened) * broadAlpha;
      const swell = 0.64 + 0.17 * Math.sin(2 * Math.PI * t / 12) + 0.12 * Math.sin(2 * Math.PI * t / 6 + 0.8);
      d[i] = (low * 1.6 + softened * 0.36) * swell;
    }
    fadeLoop(d, rate);
  }, marineRate(ctx));
}

/** A few rounded bubble tones in small, irregular clusters, with silence between. */
export function bubblesBuffer(ctx: BaseAudioContext) {
  const r = mulberry32(73012);
  return make(ctx, 11, (d, rate) => {
    for (const cluster of [0.65, 3.9, 7.6]) {
      let startTime = cluster;
      const count = 2 + Math.floor(r() * 3);
      for (let bubble = 0; bubble < count; bubble++) {
        const duration = 0.16 + r() * 0.15;
        const start = Math.floor(startTime * rate), length = Math.floor(duration * rate);
        const pitch = 380 + r() * 370;
        const gain = 0.14 + r() * 0.08;
        let phase = 0;
        for (let i = 0; i < length; i++) {
          const k = i / (length - 1);
          phase += 2 * Math.PI * pitch * (1 + k * 0.28) / rate;
          const envelope = Math.sin(Math.PI * k) ** 2 * Math.exp(-k * 4.5);
          d[start + i] += Math.sin(phase) * envelope * gain;
        }
        startTime += duration + 0.1 + r() * 0.22;
      }
    }
  }, marineRate(ctx));
}

/** Original distant whale-like motifs, deliberately not a recorded animal call. */
export function whaleBuffer(ctx: BaseAudioContext) {
  return make(ctx, 18, (d, rate) => {
    const calls = [{ time: 1.5, duration: 5.8, pitch: 94 }, { time: 10.2, duration: 5.4, pitch: 71 }];
    for (const call of calls) {
      const start = Math.floor(call.time * rate), length = Math.floor(call.duration * rate);
      let phase = 0;
      for (let i = 0; i < length; i++) {
        const k = i / (length - 1), t = i / rate;
        const pitch = call.pitch * (1 + 0.3 * Math.sin(Math.PI * k) - 0.12 * k + 0.015 * Math.sin(t * 3.2));
        phase += 2 * Math.PI * pitch / rate;
        const envelope = Math.sin(Math.PI * k) ** 2;
        const roundedVoice = Math.sin(phase) * 0.65 + Math.sin(phase * 2) * 0.2 + Math.sin(phase * 3) * 0.06;
        d[start + i] += roundedVoice * envelope * 0.25;
      }
    }
  }, marineRate(ctx));
}

/** Close, gentle eddies; irregular swells rather than a compulsory breathing rhythm. */
export function currentBuffer(ctx: BaseAudioContext) {
  const r = mulberry32(73013);
  return make(ctx, 9, (d, rate) => {
    let band = 0, smooth = 0;
    const alpha = 1 - Math.exp(-2 * Math.PI * 590 / rate);
    for (let i = 0; i < d.length; i++) {
      const t = i / rate;
      band += (r() * 2 - 1 - band) * alpha;
      smooth += (band - smooth) * alpha;
      const flow = 0.34 + 0.16 * Math.sin(t * 1.13 + 0.4) + 0.13 * Math.sin(t * 0.53 + 1.5);
      d[i] = smooth * flow * 0.6;
    }
    fadeLoop(d, rate);
  }, marineRate(ctx));
}

export function noiseBuffer(ctx: BaseAudioContext, seconds = 2) {
  return make(ctx, seconds, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
  });
}

/** Babbling water: band-limited noise with fast random amplitude flutter. */
export function streamBuffer(ctx: BaseAudioContext) {
  return make(ctx, 6, (d, rate) => {
    let lp = 0, hp = 0, env = 0.5, target = 0.5;
    for (let i = 0; i < d.length; i++) {
      if (i % Math.floor(rate * 0.03) === 0) target = 0.25 + rng() * 0.75;
      env += (target - env) * 0.002;
      const n = rng() * 2 - 1;
      lp += (n - lp) * 0.25;
      hp = lp - hp * 0.98;
      d[i] = hp * env * 0.6;
    }
    fadeLoop(d, rate);
  });
}

/** Wind moving through leaves: slow swelling filtered noise. */
export function windBuffer(ctx: BaseAudioContext) {
  return make(ctx, 10, (d, rate) => {
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / rate;
      const swell = 0.35 + 0.35 * Math.sin(t * 0.9) * Math.sin(t * 0.31 + 1) + 0.2 * Math.sin(t * 2.3);
      lp += (rng() * 2 - 1 - lp) * (0.04 + swell * 0.05);
      d[i] = lp * swell * 1.6;
    }
    fadeLoop(d, rate);
  });
}

/** A loop with a few bird phrases scattered in silence. */
export function birdsBuffer(ctx: BaseAudioContext, seed: number) {
  const r = mulberry32(seed);
  return make(ctx, 9, (d, rate) => {
    const phrases = 3 + Math.floor(r() * 3);
    for (let p = 0; p < phrases; p++) {
      let t0 = r() * 8;
      const notes = 2 + Math.floor(r() * 5);
      const base = 2400 + r() * 2200;
      for (let n = 0; n < notes; n++) {
        const dur = 0.05 + r() * 0.12;
        const f0 = base * (0.8 + r() * 0.5), f1 = f0 * (0.6 + r() * 0.9);
        const start = Math.floor(t0 * rate), len = Math.floor(dur * rate);
        let phase = 0;
        for (let i = 0; i < len && start + i < d.length; i++) {
          const k = i / len;
          const f = f0 + (f1 - f0) * k + Math.sin(k * 40) * 120;
          phase += (2 * Math.PI * f) / rate;
          d[start + i] += Math.sin(phase) * Math.sin(Math.PI * k) ** 2 * 0.35;
        }
        t0 += dur + 0.03 + r() * 0.08;
      }
    }
  });
}

/** Close insect hum / clicks — the reward for leaning in. */
export function insectsBuffer(ctx: BaseAudioContext) {
  return make(ctx, 5, (d, rate) => {
    let bp = 0, bp2 = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / rate;
      const n = rng() * 2 - 1;
      bp += (n - bp) * 0.6;
      bp2 += (bp - bp2) * 0.5;
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 28 * t);
      const click = rng() < 0.0006 ? 1 : 0;
      d[i] = (bp - bp2) * am * 0.25 * (0.6 + 0.4 * Math.sin(t * 1.7)) + click * (rng() - 0.5);
    }
    fadeLoop(d, rate);
  });
}

// Violet's three mono loops need less than 6.9 MB even on a 96 kHz host. Their
// 23/29/19-second periods and independent playback offsets rarely line up.
const violetRate = (ctx: BaseAudioContext) => Math.min(ctx.sampleRate, 24000);

/** Violet world: detuned low voices, with a little upper-body tone for headset speakers. */
export function droneBuffer(ctx: BaseAudioContext) {
  const seconds = 23;
  return make(ctx, seconds, (d, rate) => {
    // Whole cycles make the sustained bed genuinely periodic: no recurring
    // fade-to-silence, abrupt cut or phase discontinuity at the loop point.
    const frequencies = [68, 68.17, 101.7, 138.35, 205.5, 277.3, 411.8];
    const partials = frequencies.map(frequency => Math.round(frequency * seconds) / seconds);
    const gains = [0.21, 0.18, 0.16, 0.13, 0.11, 0.075, 0.035];
    for (let i = 0; i < d.length; i++) {
      const phase = 2 * Math.PI * i / d.length;
      let v = 0;
      for (let k = 0; k < partials.length; k++) {
        const swell = 0.61 + 0.2 * Math.sin(phase * (1 + k % 3) + k * 1.7)
          + 0.09 * Math.sin(phase * (3 + k % 2) - k * 0.6);
        const detune = 0.24 * Math.sin(phase * (1 + k % 2) + k * 0.7);
        v += Math.sin(phase * Math.round(partials[k] * seconds) + detune) * gains[k] * swell;
      }
      d[i] = v * 0.38;
    }
  }, violetRate(ctx));
}

/** Violet world: sparse, slowly bending metallic groans with soft attacks. */
export function chimesBuffer(ctx: BaseAudioContext) {
  return make(ctx, 29, (d, rate) => {
    const phrases = [
      { start: 2.7, duration: 4.2, pitch: 191, bend: -0.11 },
      { start: 12.8, duration: 3.5, pitch: 157, bend: 0.075 },
      { start: 22.1, duration: 5.1, pitch: 226, bend: -0.09 }
    ];
    for (const phrase of phrases) {
      const start = Math.floor(phrase.start * rate), length = Math.floor(phrase.duration * rate);
      let phase = 0;
      for (let i = 0; i < length; i++) {
        const k = i / (length - 1), t = i / rate;
        const pitch = phrase.pitch * (1 + phrase.bend * k + 0.002 * Math.sin(t * 7.3));
        phase += 2 * Math.PI * pitch / rate;
        const envelope = Math.sin(Math.PI * k) ** 2 * (0.7 + 0.3 * Math.sin(k * Math.PI));
        const tone = Math.sin(phase) * 0.53 + Math.sin(phase * 1.413 + 0.4) * 0.28
          + Math.sin(phase * 2.371) * 0.13 + Math.sin(phase * 3.917) * 0.04;
        d[start + i] = tone * envelope * 0.24;
      }
    }
  }, violetRate(ctx));
}

/** Breath-like fabric/air movement, without words or a regular breathing beat. */
export function uneaseBuffer(ctx: BaseAudioContext) {
  const r = mulberry32(61409);
  return make(ctx, 19, (d, rate) => {
    const phrases = [
      { start: 1.4, duration: 2.6, gain: 0.66 },
      { start: 7.3, duration: 4.0, gain: 0.84 },
      { start: 14.1, duration: 2.9, gain: 0.58 }
    ];
    for (const phrase of phrases) {
      const start = Math.floor(phrase.start * rate), length = Math.floor(phrase.duration * rate);
      let upper = 0, lower = 0, smooth = 0;
      const upperAlpha = 1 - Math.exp(-2 * Math.PI * 1900 / rate);
      const lowerAlpha = 1 - Math.exp(-2 * Math.PI * 430 / rate);
      for (let i = 0; i < length; i++) {
        const k = i / (length - 1), t = i / rate;
        const noise = r() * 2 - 1;
        upper += (noise - upper) * upperAlpha;
        lower += (noise - lower) * lowerAlpha;
        smooth += (upper - lower - smooth) * upperAlpha;
        const envelope = Math.sin(Math.PI * k) ** 2;
        const friction = 0.72 + 0.14 * Math.sin(t * 8.7) + 0.1 * Math.sin(t * 15.3 + 0.6);
        d[start + i] = smooth * envelope * friction * phrase.gain * 1.05;
      }
    }
  }, violetRate(ctx));
}

/** Paper rip: dense crackle of tiny impulses with a fibrous tail. */
export function crackleBuffer(ctx: BaseAudioContext, seconds: number, density: number) {
  return make(ctx, seconds, (d, rate) => {
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const k = i / d.length;
      const env = Math.pow(1 - k, 1.6) * Math.min(1, k * 40);
      const p = (density * env) / rate * 1200;
      const impulse = rng() < p ? (rng() * 2 - 1) : 0;
      lp += (impulse - lp) * 0.55;
      d[i] = (impulse * 0.8 + lp * 0.6 + (rng() * 2 - 1) * 0.05 * env) * env;
    }
  });
}

/**
 * The creature's voice — an original two-tone warble, synthesized here.
 * (Deliberately not any existing game creature's cry: those are copyrighted.)
 */
export function cryBuffer(ctx: BaseAudioContext, seed: number) {
  const r = mulberry32(seed * 977);
  return make(ctx, 0.75, (d, rate) => {
    const notes = 2 + Math.floor(r() * 2);
    let t0 = 0.02;
    for (let n = 0; n < notes; n++) {
      const dur = 0.12 + r() * 0.16;
      const f0 = 520 + r() * 420;
      const f1 = f0 * (n === notes - 1 ? 0.7 + r() * 0.3 : 1.25 + r() * 0.5);
      const start = Math.floor(t0 * rate);
      const len = Math.floor(dur * rate);
      let phase = 0;
      for (let i = 0; i < len && start + i < d.length; i++) {
        const k = i / len;
        const vib = 1 + 0.06 * Math.sin(k * Math.PI * 2 * 9);
        const f = (f0 + (f1 - f0) * k) * vib;
        phase += (2 * Math.PI * f) / rate;
        const env = Math.sin(Math.PI * k) ** 1.2;
        // A little second harmonic keeps it chirpy rather than flute-like.
        d[start + i] += (Math.sin(phase) * 0.7 + Math.sin(phase * 2) * 0.25) * env * 0.5;
      }
      t0 += dur + 0.03 + r() * 0.05;
    }
  });
}

/** Trim a long recording to a seamless loop of `seconds` (saves memory on device). */
export function loopTrim(ctx: BaseAudioContext, source: AudioBuffer, seconds: number, fade = 1.2) {
  if (source.duration <= seconds + fade) return source;
  const rate = source.sampleRate;
  const len = Math.floor(seconds * rate);
  const fadeLen = Math.floor(fade * rate);
  const out = ctx.createBuffer(source.numberOfChannels, len, rate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const src = source.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    // Crossfade the material just past the end back over the start, so the
    // loop point is inaudible instead of clicking or dipping to silence.
    for (let i = 0; i < fadeLen && len + i < src.length; i++) {
      const k = i / fadeLen;
      dst[i] = dst[i] * k + src[len + i] * (1 - k);
    }
  }
  return out;
}

function fadeLoop(d: Float32Array, rate: number) {
  const n = Math.floor(rate * 0.25);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[i] *= k;
    d[d.length - 1 - i] *= k;
  }
}
