"""Pack the creator's explicit cutout map into glTF base color's alpha channel.

Blender 4.2's AUTO image output retained JPEG for this separate-node input,
which cannot carry alpha. This deterministic post-pass preserves the source
diffuse RGB and maps the original grayscale cutout to the required channel.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
from PIL import Image


def pack(source: Path, destination: Path):
    raw = source.read_bytes()
    json_length = struct.unpack_from('<I', raw, 12)[0]
    document = json.loads(raw[20:20 + json_length])
    binary_offset = 20 + json_length
    binary_length = struct.unpack_from('<I', raw, binary_offset)[0]
    binary = bytearray(raw[binary_offset + 8:binary_offset + 8 + binary_length])
    folder = Path(__file__).resolve().parents[1] / 'validation/conifer-sources/fir_tree_01/textures'
    color = Image.open(folder / 'fir_tree_01_twig_diff_1k.png').convert('RGBA')
    alpha = Image.open(folder / 'fir_tree_01_twig_alpha_1k.png').convert('L')
    color.putalpha(alpha.resize(color.size, Image.Resampling.LANCZOS))
    buffer = io.BytesIO()
    color.save(buffer, format='PNG', optimize=True)
    while len(binary) % 4:
        binary.append(0)
    view = len(document['bufferViews'])
    document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(buffer.getvalue())})
    binary.extend(buffer.getvalue())
    image = len(document['images'])
    document['images'].append({'bufferView': view, 'mimeType': 'image/png', 'name': 'Original photographed fir needles with CC0 cutout alpha'})
    for material in document['materials']:
        if 'twig' not in material['name']:
            continue
        texture = document['textures'][material['pbrMetallicRoughness']['baseColorTexture']['index']]
        texture['source'] = image
        material['alphaMode'] = 'MASK'
        material['alphaCutoff'] = .43
    document['buffers'][0]['byteLength'] = len(binary)
    while len(binary) % 4:
        binary.append(0)
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    output = struct.pack('<4sII', b'glTF', 2, total)
    output += struct.pack('<I4s', len(encoded), b'JSON') + encoded
    output += struct.pack('<I4s', len(binary), b'BIN\x00') + binary
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)
    manifest = destination.parent / 'SOURCE-MANIFEST.json'
    if manifest.exists():
        records = json.loads(manifest.read_text())
        for record in records['exports']:
            if record['runtime'].endswith('/' + destination.name):
                record.update(bytes=len(output), sha256=hashlib.sha256(output).hexdigest())
        change = 'Original twig RGB and explicit cutout packed into RGBA PNG with glTF MASK; run scripts/pack-fir-alpha.py after Blender conversion.'
        if change not in records['changes']:
            records['changes'].append(change)
        manifest.write_text(json.dumps(records, indent=2) + '\n')
    print(json.dumps({'bytes': len(output), 'alpha_extrema': alpha.getextrema(), 'texture': color.size}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    pack(args.source, args.destination)
