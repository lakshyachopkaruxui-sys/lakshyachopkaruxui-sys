"""Fetch selected CC0 forest scans through Poly Haven's public API.

The fern glTF diffuse uses JPEG, so its separately published alpha map is
downloaded explicitly. Every source file is size/MD5 checked before use.
"""
from pathlib import Path
import hashlib
import json
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'validation/forest-asset-research'
HEADERS = {'User-Agent': 'TEAR-Prototype-Asset-Research/1.0 (personal educational project)', 'Accept': '*/*'}
RECORDS = []


def request(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'api.polyhaven.com', 'dl.polyhaven.org'}:
        raise ValueError('Unexpected asset source: ' + url)
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=45) as response:
        return response.read()


def manifest(key):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / (key + '.json')
    if not path.exists():
        path.write_bytes(request('https://api.polyhaven.com/files/' + key))
    return json.loads(path.read_text())


def save(entry, target, key):
    target = target.resolve()
    if not target.is_relative_to((ROOT / 'public').resolve()):
        raise ValueError('Asset target is outside public/')
    data = target.read_bytes() if target.exists() else request(entry['url'])
    if len(data) != entry['size'] or hashlib.md5(data).hexdigest() != entry['md5']:
        raise ValueError('Asset failed source integrity verification: ' + str(target))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    RECORDS.append({'asset': key, 'source': 'https://polyhaven.com/a/' + key,
                    'url': entry['url'], 'file': target.relative_to(ROOT).as_posix(),
                    'bytes': len(data), 'md5': entry['md5'], 'sha256': hashlib.sha256(data).hexdigest()})
    print('Verified ' + target.relative_to(ROOT).as_posix(), flush=True)


for asset in ['fern_02', 'tree_stump_01']:
    files = manifest(asset)
    gltf = files['gltf']['1k']['gltf']
    folder = ROOT / 'public/models/forest' / asset
    save(gltf, folder / (asset + '_1k.gltf'), asset)
    for filename, entry in gltf['include'].items():
        save(entry, folder / filename, asset)
    if asset == 'fern_02':
        save(files['Alpha']['1k']['jpg'], folder / 'textures/fern_02_alpha_1k.jpg', asset)

floor = manifest('forest_floor')
for kind, filename in [('diff', 'floor-diffuse.jpg'), ('nor_gl', 'floor-normal.jpg'), ('rough', 'floor-roughness.jpg')]:
    source_key = next(k for k in floor if k.lower() in ({'diff', 'diffuse'} if kind == 'diff' else {kind}))
    save(floor[source_key]['1k']['jpg'], ROOT / 'public/textures/forest' / filename, 'forest_floor')

(ROOT / 'public/models/forest/SOURCE-MANIFEST.json').write_text(json.dumps({
    'license': 'CC0-1.0', 'license_url': 'https://polyhaven.com/license',
    'assets': [
        {'id': 'fern_02', 'authors': ['Rico Cilliers (modeling)', 'Rob Tuytel (scanning)']},
        {'id': 'tree_stump_01', 'authors': ['Rob Tuytel']},
        {'id': 'forest_floor', 'authors': ['eye-candy.xyz']}
    ], 'files': RECORDS}, indent=2) + '\n')
