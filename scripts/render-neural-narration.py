"""Render original-pitch male narration locally. Run acquire-narrator.py first.

Dependencies live in tools/narrator-deps, never shipped to the browser.
"""
from pathlib import Path
import hashlib
import json
import re
import sys
import os

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/narrator-deps'))
# Reuse the official portable Blender VC++ runtime when the host lacks it.
# This is an offline authoring dependency, not a browser or packaged requirement.
vc_runtime = ROOT / 'validation/tools/blender-4.2.0-windows-x64/blender.crt'
dll_scope = os.add_dll_directory(str(vc_runtime)) if os.name == 'nt' and vc_runtime.exists() else None
from kokoro_onnx import Kokoro
import soundfile as sf

model_dir = ROOT / 'tools/narrator-models'
output = ROOT / 'validation/narration-dry'
output.mkdir(parents=True, exist_ok=True)
source = (ROOT / 'src/audio/narrationScript.ts').read_text(encoding='utf-8')
script = dict(re.findall(r"id: '([^']+)',\s+text: '([^']+)'", source))
assert set(script) == {'opening', 'ocean', 'shadow', 'forest', 'return'}
kokoro = Kokoro(str(model_dir / 'kokoro-v1.0.onnx'), str(model_dir / 'voices-v1.0.bin'))
report = {}
for name, text in script.items():
    samples, rate = kokoro.create(text, voice='am_michael', speed=0.91, lang='en-us')
    target = output / (name + '.wav')
    sf.write(str(target), samples, rate, subtype='PCM_16')
    report[target.name] = {'text': text, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
    print(name, round(len(samples) / rate, 3), 'seconds', flush=True)
(output / 'script.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
generator = {'engine': 'kokoro-onnx', 'engine_version': '0.6.0',
             'model': 'Kokoro-82M v1.0, float32 ONNX export model-files-v1.1',
             'voice': 'am_michael', 'speed': 0.91, 'pitch_semitones': 0,
             'onnxruntime_version': '1.20.1',
             'model_license': 'Apache-2.0', 'wrapper_license': 'MIT',
             'sources': json.loads((model_dir / 'sources.json').read_text())}
(output / 'generator.json').write_text(json.dumps(generator, indent=2) + '\n', encoding='utf-8')
