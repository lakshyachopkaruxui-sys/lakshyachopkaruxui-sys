"""Smooth woody surface lighting without changing geometry, UVs or colliders.

Area-weighted normals are shared across coincident positions even when a UV
seam needs separate vertices. Needle cards keep their authored split normals.
Run after convert-conifer-assets.py and pack-fir-alpha.py.
"""
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'public/models/forest/conifers'


def smooth(path):
    raw = bytearray(path.read_bytes())
    length = struct.unpack_from('<I', raw, 12)[0]
    data = json.loads(raw[20:20 + length])
    binary_start = 28 + length

    def accessor(index):
        entry = data['accessors'][index]
        view = data['bufferViews'][entry['bufferView']]
        return entry, binary_start + view.get('byteOffset', 0) + entry.get('byteOffset', 0), view.get('byteStride')

    changed = 0
    for mesh in data['meshes']:
        for primitive in mesh['primitives']:
            if 'twig' in data['materials'][primitive['material']]['name']:
                continue
            position, offset, stride = accessor(primitive['attributes']['POSITION'])
            assert position['componentType'] == 5126
            points = [struct.unpack_from('<fff', raw, offset + i * (stride or 12)) for i in range(position['count'])]
            keys = [tuple(round(c, 6) for c in point) for point in points]
            indices, offset, stride = accessor(primitive['indices'])
            code, width = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4)}[indices['componentType']]
            order = [struct.unpack_from('<' + code, raw, offset + i * (stride or width))[0] for i in range(indices['count'])]
            sums = defaultdict(lambda: [0.0, 0.0, 0.0])
            for i in range(0, len(order), 3):
                a, b, c = [points[k] for k in order[i:i + 3]]
                u = [b[k] - a[k] for k in range(3)]
                v = [c[k] - a[k] for k in range(3)]
                normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
                for index in order[i:i + 3]:
                    total = sums[keys[index]]
                    for axis in range(3):
                        total[axis] += normal[axis]
            normals, offset, stride = accessor(primitive['attributes']['NORMAL'])
            assert normals['componentType'] == 5126 and normals['count'] == len(points)
            for i, key in enumerate(keys):
                normal = sums[key]
                magnitude = math.sqrt(sum(value * value for value in normal))
                if magnitude < 1e-12:
                    continue
                normal = [value / magnitude for value in normal]
                location = offset + i * (stride or 12)
                previous = struct.unpack_from('<fff', raw, location)
                if sum((a - b) ** 2 for a, b in zip(previous, normal)) > .001:
                    changed += 1
                struct.pack_into('<fff', raw, location, *normal)
    path.write_bytes(raw)
    return {'file': path.name, 'changed_normals': changed, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


if __name__ == '__main__':
    reports = [smooth(FOLDER / name) for name in ['fir_tree_01.glb', 'fir_tree_01_bare.glb']]
    manifest = FOLDER / 'SOURCE-MANIFEST.json'
    data = json.loads(manifest.read_text())
    for record in data['exports']:
        report = next(r for r in reports if record['runtime'].endswith('/' + r['file']))
        record.update(bytes=report['bytes'], sha256=report['sha256'])
    note = 'Woody normals recomputed with area-weighted coincident-position smoothing; positions, UVs and triangle indices unchanged. Run scripts/smooth-fir-normals.py last.'
    if note not in data['changes']:
        data['changes'].append(note)
    manifest.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps(reports))
