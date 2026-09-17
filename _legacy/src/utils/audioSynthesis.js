// Procedural audio building blocks (no audio files anywhere in this
// project — see README "Asset Strategy"). Everything is synthesized with
// the Web Audio API: filtered noise for texture/rip/wind sounds, detuned
// oscillators for tones/drones.

/** A short buffer of white noise, meant to be played back looping. */
export function createNoiseBuffer(audioContext, seconds = 2) {
  const length = Math.floor(audioContext.sampleRate * seconds);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Starts a looping noise source through a bandpass filter; returns {filter, gain, stop}. */
export function createFilteredNoiseVoice(audioContext, noiseBuffer, { type = 'bandpass', frequency = 800, Q = 0.7 } = {}) {
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = audioContext.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = Q;

  const gain = audioContext.createGain();
  gain.gain.value = 0;

  source.connect(filter);
  filter.connect(gain);
  source.start();

  return { source, filter, gain, output: gain };
}

/** A short one-shot noise burst with an exponential decay envelope, for transient "stinger" sounds. */
export function playNoiseBurst(audioContext, noiseBuffer, destination, { duration = 0.18, frequency = 1200, Q = 1, peakGain = 0.5, type = 'bandpass' } = {}) {
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;

  const filter = audioContext.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = Q;

  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(peakGain, 0.0001), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  source.start(now);
  source.stop(now + duration + 0.05);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

/** A slow, soft detuned-oscillator drone; returns {gain, stop}. */
export function createDroneVoice(audioContext, { baseFrequency = 110, detune = 6 } = {}) {
  const gain = audioContext.createGain();
  gain.gain.value = 0;

  const oscillators = [0, detune, -detune].map((d) => {
    const osc = audioContext.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = baseFrequency;
    osc.detune.value = d * 8;
    osc.connect(gain);
    osc.start();
    return osc;
  });

  return { oscillators, gain, output: gain };
}
