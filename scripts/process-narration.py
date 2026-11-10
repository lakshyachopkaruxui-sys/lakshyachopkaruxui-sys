"""Keep the narrator's natural pitch/tone; add only a very quiet room reflection."""
from pathlib import Path
import hashlib
import json
import re
import wave
import numpy as np

root = Path(__file__).resolve().parents[1]
rendered = json.loads((root / 'validation/narration-dry/script.json').read_text(encoding='utf-8-sig'))
script = dict(re.findall(r"id: '([^']+)',\s+text: '([^']+)'", (root / 'src/audio/narrationScript.ts').read_text()))
rate = 24000
generator = json.loads((root / 'validation/narration-dry/generator.json').read_text(encoding='utf-8'))
assert generator['pitch_semitones'] == 0
tail_seconds = .55
report = {'voice': 'Kokoro am_michael (American English male)',
          'kind': 'local synthetic male voice, not a recorded performer',
          'pitch_semitones': 0, 'bass_boost_db': 0, 'nonlinear_compression': False,
          'sample_rate': rate, 'channels': 2,
          'echo_seconds': [], 'tail_seconds': tail_seconds,
          'wet_gain': .028, 'dry_gain': 1.0, 'reverb_predelay_seconds': .018,
          'generator': generator,
          'clips': {}}

def reflection_tone(signal):
    size = 1 << (len(signal) * 2 - 1).bit_length()
    frequency = np.fft.rfftfreq(size, 1 / rate)
    # Only the reflection is filtered. The direct voice has no EQ or pitch effect.
    highpass = frequency ** 2 / (frequency ** 2 + 65 ** 2)
    lowpass = 1 / np.sqrt(1 + (frequency / 5700) ** 8)
    return np.fft.irfft(np.fft.rfft(signal, size) * highpass * lowpass, size)[:len(signal)]

def convolution(a, b):
    count = len(a) + len(b) - 1
    size = 1 << (count - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, size) * np.fft.rfft(b, size), size)[:count]

for name in ('opening', 'ocean', 'shadow', 'forest', 'return'):
    raw = root / 'validation/narration-dry' / (name + '.wav')
    source_hash = hashlib.sha256(raw.read_bytes()).hexdigest()
    assert rendered[name + '.wav']['text'] == script[name], 'Re-render after changing narration text'
    assert rendered[name + '.wav']['sha256'] == source_hash, 'Dry voice does not match its text manifest'
    with wave.open(str(raw)) as source:
        assert source.getnchannels() == 1 and source.getsampwidth() == 2
        dry = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2').astype(np.float64) / 32768
        source_rate = source.getframerate()
    nonzero = np.flatnonzero(np.abs(dry) > 0.0015)
    assert nonzero.size, 'Silent source narration'
    dry = dry[max(0, nonzero[0] - int(source_rate * .045)):min(len(dry), nonzero[-1] + int(source_rate * .16))]
    positions = np.arange(0, len(dry) - 1, source_rate / rate)
    voice = np.interp(positions, np.arange(len(dry)), dry)
    voice -= np.mean(voice)
    # Linear gain only: preserve the model's natural pitch, formants and dynamics.
    voice *= 0.13 / max(np.sqrt(np.mean(voice ** 2)), 1e-8)
    channels = []
    for channel in range(2):
        rng = np.random.default_rng(730 + channel)
        t = np.arange(int(rate * tail_seconds)) / rate
        noise = rng.standard_normal(len(t))
        ir = reflection_tone(noise) * np.exp(-t * 14.0)
        ir[:int(rate * report['reverb_predelay_seconds'])] = 0
        ir /= max(np.linalg.norm(ir), 1e-8)
        wet = convolution(voice, ir) * report['wet_gain']
        mixed = wet.copy()
        mixed[:len(voice)] += voice
        mixed[-int(rate * .15):] *= np.linspace(1, 0, int(rate * .15))
        channels.append(mixed)
    stereo = np.stack(channels, axis=1)
    stereo *= min(1, 10 ** (-2.5 / 20) / max(np.abs(stereo).max(), 1e-8))
    pcm = np.round(stereo * 32767).astype('<i2')
    target = root / 'public/audio/narration' / (name + '.wav')
    with wave.open(str(target), 'wb') as output:
        output.setnchannels(2); output.setsampwidth(2); output.setframerate(rate)
        output.writeframes(pcm.tobytes())
    report['clips'][name] = {'text': script[name], 'dry_sha256': source_hash,
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size,
        'voice_seconds': round(len(voice) / rate, 3), 'total_seconds': round(len(stereo) / rate, 3),
        'peak_dbfs': round(20 * np.log10(np.abs(stereo).max()), 2),
        'rms_dbfs': round(20 * np.log10(np.sqrt(np.mean(stereo ** 2))), 2),
        'tail_rms': float(np.sqrt(np.mean(stereo[len(voice):] ** 2)))}
(root / 'public/audio/narration/render-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
provenance = {'generator': 'Kokoro-82M via kokoro-onnx + scripts/process-narration.py', 'cloud_service': False,
              'voice_cloning': False, 'voice': report['voice'],
              'model': generator,
              'effects': 'original pitch and tone; linear level adjustment; 2.8% short stereo room reflection; no bass boost or repeat echoes',
              'files': [{'file': name + '.wav', **data} for name, data in report['clips'].items()]}
(root / 'public/audio/narration/provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
