"""Acquire official CC0 conifer authoring files for a measured browser export."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib
import json
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'validation/conifer-sources'
HEADERS = {'User-Agent': 'TEAR-Prototype-Asset-Research/1.0 (personal educational project)'}


def request(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90)


def download(url, path, expected=None, algorithm='md5'):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (not expected or hashlib.new(algorithm, path.read_bytes()).hexdigest() == expected):
        return
    with request(url) as response, path.open('wb') as target:
        while chunk := response.read(1024 * 1024):
            target.write(chunk)
    if expected and hashlib.new(algorithm, path.read_bytes()).hexdigest() != expected:
        raise ValueError('Source checksum mismatch: ' + str(path))
    print('Verified ' + str(path.relative_to(ROOT)) + ' ' + str(path.stat().st_size), flush=True)


def fetch_asset(asset):
    with request('https://api.polyhaven.com/files/' + asset) as response:
        manifest = json.load(response)
    folder = CACHE / asset
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'official-files.json').write_text(json.dumps(manifest, indent=2))
    entry = manifest['blend']['1k']['blend']
    targets = [(entry, folder / (asset + '_1k.blend'))]
    targets += [(item, folder / name) for name, item in entry['include'].items()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda job: download(job[0]['url'], job[1], job[0]['md5']), targets))


def fetch_blender():
    base = 'https://download.blender.org/release/Blender4.2/'
    name = 'blender-4.2.0-windows-x64.zip'
    with request(base + 'blender-4.2.0.sha256') as response:
        checksums = response.read().decode()
    checksum = next(line.split()[0] for line in checksums.splitlines() if name in line)
    destination = ROOT / 'validation/tools'
    archive = destination / name
    download(base + name, archive, checksum, 'sha256')
    if not (destination / 'blender-4.2.0-windows-x64/blender.exe').exists():
        with zipfile.ZipFile(archive) as package:
            for entry in package.infolist():
                if not (destination / entry.filename).resolve().is_relative_to(destination.resolve()):
                    raise ValueError('Archive path escapes converter directory')
            package.extractall(destination)
    print('Official Blender portable ready', flush=True)


def fetch_forest_background():
    with request('https://api.polyhaven.com/files/forest_slope') as response:
        entry = json.load(response)['hdri']['2k']['hdr']
    destination = ROOT / 'public/hdri/forest_slope_2k.hdr'
    download(entry['url'], destination, entry['md5'])
    entry.update(source='https://polyhaven.com/a/forest_slope', author='Andreas Mischok',
        license='CC0-1.0', license_url='https://polyhaven.com/license',
        file=destination.relative_to(ROOT).as_posix(), sha256=hashlib.sha256(destination.read_bytes()).hexdigest())
    (destination.parent / 'forest_slope-SOURCE.json').write_text(json.dumps(entry, indent=2) + '\n')


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(fetch_asset, 'fir_tree_01'), pool.submit(fetch_forest_background)]
        futures.append(pool.submit(fetch_blender))
        for future in futures:
            future.result()
