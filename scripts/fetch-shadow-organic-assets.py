"""Fetch selected CC0 Poly Haven wood scans, verifying all provider hashes."""
from pathlib import Path
import hashlib
import json
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'public/models/shadow/organic'
HEADERS = {'User-Agent': 'TEAR-Prototype-Asset-Research/1.0 (personal educational project)', 'Accept': '*/*'}
ASSETS = {
    'dry_branches_medium_01': {'artists': ['Rico Cilliers']},
    'dead_quiver_trunk': {'artists': ['Dario Barresi', 'James Ray Cock', 'Rico Cilliers']},
}


def request(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'api.polyhaven.com', 'dl.polyhaven.org'}:
        raise ValueError('Unexpected asset URL: ' + url)
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as response:
        return response.read()


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    records = []
    for key, metadata in ASSETS.items():
        folder = DESTINATION / key
        folder.mkdir(parents=True, exist_ok=True)
        manifest_path = folder / 'provider-files.json'
        if not manifest_path.exists():
            manifest_path.write_bytes(request('https://api.polyhaven.com/files/' + key))
        provider = json.loads(manifest_path.read_text(encoding='utf-8'))
        gltf = provider['gltf']['1k']['gltf']
        entries = {key + '_1k.gltf': gltf, **gltf['include']}
        for filename, entry in entries.items():
            target = (folder / filename).resolve()
            if not target.is_relative_to(DESTINATION.resolve()):
                raise ValueError('Asset path leaves destination')
            data = target.read_bytes() if target.exists() else request(entry['url'])
            if len(data) != entry['size'] or hashlib.md5(data).hexdigest() != entry['md5']:
                raise ValueError('Provider hash mismatch: ' + str(target))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            records.append({'asset': key, 'source': 'https://polyhaven.com/a/' + key,
                'artists': metadata['artists'], 'url': entry['url'],
                'file': target.relative_to(ROOT).as_posix(), 'bytes': len(data),
                'md5': entry['md5'], 'sha256': hashlib.sha256(data).hexdigest()})
            print('Verified ' + target.relative_to(ROOT).as_posix(), flush=True)
    (DESTINATION / 'SOURCE-MANIFEST.json').write_text(json.dumps({
        'license': 'CC0-1.0', 'license_url': 'https://polyhaven.com/license',
        'files': records}, indent=2) + '\n', encoding='utf-8')
    print(f'{len(records)} files / {sum(item["bytes"] for item in records):,} verified bytes')


if __name__ == '__main__':
    main()
