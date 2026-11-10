"""Fetch the public Kokoro model and record source hashes for offline rendering."""
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'tools/narrator-models'
TARGET.mkdir(parents=True, exist_ok=True)
BASE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/'
SOURCES = {
    'kokoro-v1.0.onnx': BASE + 'kokoro-v1.0.onnx',
    'voices-v1.0.bin': BASE + 'voices-v1.0.bin',
    'MODEL-LICENSE.txt': 'https://www.apache.org/licenses/LICENSE-2.0.txt',
    'MODEL-CARD.md': 'https://huggingface.co/hexgrad/Kokoro-82M/raw/main/README.md',
    'WRAPPER-LICENSE.txt': 'https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/LICENSE',
}
records = []
for name, url in SOURCES.items():
    destination = TARGET / name
    if not destination.exists():
        temporary = destination.with_suffix(destination.suffix + '.part')
        with urllib.request.urlopen(url, timeout=90) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temporary.replace(destination)
    records.append({'file': name, 'url': url, 'bytes': destination.stat().st_size,
                    'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
    print(name, destination.stat().st_size, flush=True)
(TARGET / 'sources.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
