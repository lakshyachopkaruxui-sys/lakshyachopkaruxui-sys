"""Fetch the approved Poly Haven CC0 sample assets with verified source hashes.

No project source code or existing assets are modified. Downloaded originals
remain under validation; runtime derivatives are written only under sample/.
"""
from pathlib import Path
import argparse
import hashlib
import json
import urllib.request
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'validation/forest-sample-2026-10-17'
RUNTIME = ROOT / 'public/models/forest/sample'
HEADERS = {'User-Agent': 'TEAR-Forest-Sample/1.0', 'Accept': '*/*'}
ASSETS = ['grass_medium_01', 'rock_moss_set_01', 'dry_branches_medium_01']


def request(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname not in {'api.polyhaven.com', 'dl.polyhaven.org'}:
        raise ValueError('Unexpected asset source: ' + url)
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90) as response:
        return response.read()


def checked_path(path):
    path = path.resolve()
    if not any(path.is_relative_to(parent.resolve()) for parent in [CACHE, RUNTIME]):
        raise ValueError('Asset target is outside the approved sample folders')
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def metadata(asset):
    path = checked_path(CACHE / (asset + '-files.json'))
    if not path.exists():
        path.write_bytes(request('https://api.polyhaven.com/files/' + asset))
    return json.loads(path.read_text())


def save(entry, target, asset):
    target = checked_path(target)
    data = target.read_bytes() if target.exists() else request(entry['url'])
    if len(data) != entry['size'] or hashlib.md5(data).hexdigest() != entry['md5']:
        raise ValueError('Asset failed source integrity verification: ' + str(target))
    target.write_bytes(data)
    record = {'asset': asset, 'source': 'https://polyhaven.com/a/' + asset,
              'url': entry['url'], 'file': target.relative_to(ROOT).as_posix(),
              'bytes': len(data), 'md5': entry['md5'], 'sha256': hashlib.sha256(data).hexdigest()}
    print('Verified ' + target.relative_to(ROOT).as_posix(), flush=True)
    return record


def inspect(asset, document):
    output = {'asset': asset, 'materials': document.get('materials', []),
              'nodes': document.get('nodes', []), 'meshes': []}
    for mesh in document.get('meshes', []):
        item = {'name': mesh.get('name'), 'primitives': []}
        for primitive in mesh['primitives']:
            position = document['accessors'][primitive['attributes']['POSITION']]
            indices = document['accessors'][primitive['indices']]
            item['primitives'].append({'triangles': indices['count'] // 3,
                                       'vertices': position['count'], 'min': position.get('min'),
                                       'max': position.get('max'), 'material': primitive.get('material')})
        output['meshes'].append(item)
    checked_path(CACHE / (asset + '-geometry.json')).write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps(output, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--prepare-textures', action='store_true')
    args = parser.parse_args()
    if args.prepare_textures:
        from PIL import Image, ImageFile
        ImageFile.MAXBLOCK = 32 * 1024 * 1024
        processing = []
        for asset in ASSETS:
            source = CACHE / 'originals' / asset / 'textures'
            target = RUNTIME / asset / 'textures'
            if asset == 'grass_medium_01':
                diffuse = Image.open(source / 'grass_medium_01_diff_1k.jpg').convert('RGBA')
                original_alpha = Image.open(source / 'grass_medium_01_alpha_1k.png')
                if original_alpha.mode in {'I;16', 'I;16B', 'I;16L', 'I'}:
                    # PIL convert('L') clips 16-bit values instead of scaling them.
                    alpha = Image.new('L', original_alpha.size)
                    alpha.putdata([round(value / 257) for value in original_alpha.getdata()])
                else:
                    alpha = original_alpha.convert('L')
                diffuse.putalpha(alpha)
                output = checked_path(target / 'grass_medium_01_diff_alpha_1k.png')
                diffuse.save(output, optimize=True)
                processing.append({'file': output.relative_to(ROOT).as_posix(),
                                   'process': 'Original decoded JPEG RGB and original 16-bit alpha PNG combined into one 1024px RGBA PNG; alpha scaled from 0..65535 to 0..255 without clipping, no RGB color adjustment.'})
            for item in source.glob('*.jpg'):
                name = item.name
                if asset == 'grass_medium_01' and '_diff_' in name:
                    continue
                if asset == 'rock_moss_set_01' and '_diff_1k' in name:
                    continue
                size = 2048 if '_diff_2k' in name else 1024
                if asset == 'grass_medium_01' or asset == 'dry_branches_medium_01' or '_rough_' in name:
                    size = 512
                image = Image.open(item).convert('RGB')
                if image.size != (size, size):
                    image = image.resize((size, size), Image.Resampling.LANCZOS)
                output_name = name.replace('_1k', '_512') if size == 512 else name
                output = checked_path(target / output_name)
                image.save(output, quality=94, subsampling=0, optimize=True)
                processing.append({'file': output.relative_to(ROOT).as_posix(),
                                   'process': f'{size}px RGB JPEG, Lanczos resampling where needed, quality 94 with no chroma subsampling; no color adjustment.'})
        checked_path(CACHE / 'texture-processing.json').write_text(json.dumps(processing, indent=2) + '\n')
        return
    records = []
    for asset in ASSETS:
        files = metadata(asset)
        gltf_entry = files['gltf']['1k']['gltf']
        directory = CACHE / 'originals' / asset
        records.append(save(gltf_entry, directory / (asset + '_1k.gltf'), asset))
        document = json.loads((directory / (asset + '_1k.gltf')).read_text())
        inspect(asset, document)
        if args.download:
            info_path = checked_path(CACHE / (asset + '-info.json'))
            if not info_path.exists():
                info_path.write_bytes(request('https://api.polyhaven.com/info/' + asset))
            for relative, entry in gltf_entry['include'].items():
                records.append(save(entry, directory / relative, asset))
            if asset == 'grass_medium_01':
                records.append(save(files['Alpha']['1k']['png'], directory / 'textures/grass_medium_01_alpha_1k.png', asset))
            if asset == 'rock_moss_set_01':
                records.append(save(files['Diffuse']['2k']['jpg'], directory / 'textures/rock_moss_set_01_diff_2k.jpg', asset))
    if args.download:
        checked_path(CACHE / 'download-manifest.json').write_text(json.dumps(records, indent=2) + '\n')


if __name__ == '__main__':
    main()
