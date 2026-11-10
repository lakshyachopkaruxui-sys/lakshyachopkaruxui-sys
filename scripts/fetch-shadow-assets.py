"""Fetch two selected CC0 assets from the official API, checking size and MD5."""
from pathlib import Path
import hashlib
import json
import urllib.request
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[1]
cache = root / 'validation/shadow-asset-research'
cache.mkdir(parents=True, exist_ok=True)
headers = {'User-Agent': 'TEAR-Prototype-Asset-Research/1.0 (personal educational project)', 'Accept': '*/*'}
records = []

def request(url):
    parsed = urlparse(url)
    assert parsed.scheme == 'https' and parsed.hostname in {'api.polyhaven.com', 'dl.polyhaven.org'}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=45) as response:
        return response.read()

def manifest(key):
    path = cache / (key + '.json')
    if not path.exists():
        path.write_bytes(request('https://api.polyhaven.com/files/' + key))
    return json.loads(path.read_text())

def save(entry, target, key):
    target = target.resolve()
    assert target.is_relative_to((root / 'public').resolve())
    data = target.read_bytes() if target.exists() else request(entry['url'])
    assert len(data) == entry['size'], f'Size mismatch: {target}'
    assert hashlib.md5(data).hexdigest() == entry['md5'], f'MD5 mismatch: {target}'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    records.append({'asset': key, 'source': 'https://polyhaven.com/a/' + key,
                    'url': entry['url'], 'file': target.relative_to(root).as_posix(),
                    'bytes': len(data), 'md5': entry['md5'], 'sha256': hashlib.sha256(data).hexdigest()})
    print('Verified ' + target.relative_to(root).as_posix(), flush=True)

rock = manifest('rock_face_01')['gltf']['1k']['gltf']
folder = root / 'public/models/shadow/rock_face_01'
save(rock, folder / 'rock_face_01_1k.gltf', 'rock_face_01')
for filename, entry in rock['include'].items():
    save(entry, folder / filename, 'rock_face_01')
ground = manifest('aerial_rocks_02')
for kind, filename in [('diff', 'ground-diffuse.jpg'), ('nor_gl', 'ground-normal.jpg'), ('rough', 'ground-roughness.jpg')]:
    match = next(key for key in ground if key.lower() in ({'diff', 'diffuse'} if kind == 'diff' else {kind}))
    save(ground[match]['1k']['jpg'], root / 'public/textures/shadow' / filename, 'aerial_rocks_02')
(root / 'public/models/shadow/SOURCE-MANIFEST.json').write_text(json.dumps({'license': 'CC0-1.0',
    'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/', 'files': records}, indent=2) + '\n')
