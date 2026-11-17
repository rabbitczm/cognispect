"""Prepare progressive BodyParts3D geometry with offline vertex normals."""
from __future__ import annotations

import base64
import gzip
import json
from pathlib import Path
import re
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/anatomy/binary-v22'
VERSION = 'bodyparts3d-4.0-binary-v22.1'


def vertex_normals(positions, indices):
    faces = indices.reshape(-1, 3)
    normals = np.zeros_like(positions)
    triangles = positions[faces]
    crosses = np.cross(triangles[:, 2] - triangles[:, 1], triangles[:, 0] - triangles[:, 1])
    for column in range(3):
        np.add.at(normals, faces[:, column], crosses)
    lengths = np.linalg.norm(normals, axis=1)
    normals[lengths > 0] /= lengths[lengths > 0, None]
    return np.rint(np.clip(normals, -1, 1) * 32767).astype('<i2')


def append_mesh(blob, positions, indices, group):
    positions = np.asarray(positions, dtype='<f4').reshape(-1, 3)
    indices = np.asarray(indices, dtype='<u2' if len(positions) <= 65535 else '<u4').reshape(-1)
    blob.extend(b'\0' * (-len(blob) % 4))
    meta = {'offset': len(blob), 'vertices': len(positions), 'indices': len(indices), 'indexWidth': indices.itemsize, 'group': group}
    blob.extend(positions.tobytes())
    meta['normalOffset'] = len(blob)
    blob.extend(vertex_normals(positions, indices).tobytes())
    blob.extend(b'\0' * (-len(blob) % indices.itemsize))
    meta['indexOffset'] = len(blob)
    blob.extend(indices.tobytes())
    return meta


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / 'data/anatomy-catalog.json').read_text(encoding='utf-8'))
    manifest = {'version': VERSION, 'source': catalog['source'], 'license': catalog['license'], 'chunks': {}, 'meshes': {}, 'lite': {}}

    def write_chunk(name, blob):
        target = OUT / (name + '.bin.gz')
        target.write_bytes(gzip.compress(blob, compresslevel=6, mtime=0))
        manifest['chunks'][name] = {'file': '/' + target.relative_to(ROOT).as_posix(), 'bytes': target.stat().st_size}

    intro_text = (ROOT / 'assets/anatomy/intro.js').read_text(encoding='utf-8')
    intro = json.loads(intro_text[intro_text.index('=') + 1:].rstrip(';\r\n'))
    blob = bytearray()
    for mesh in intro['meshes']:
        meta = append_mesh(blob, mesh['vertices'], mesh['indices'], mesh['group'])
        manifest['lite'][mesh['id']] = {**meta, 'chunk': 'lite'}
    write_chunk('lite', blob)

    for group, pack in catalog['packs'].items():
        script = (ROOT / pack['file'].lstrip('/')).read_text(encoding='utf-8')
        encoded = re.search(r'=\s*"([A-Za-z0-9+/=]+)"\s*;', script).group(1)
        raw = base64.b64decode(encoded)
        blob, chunk_no, chunk_ids = bytearray(), 0, []

        def flush():
            nonlocal blob, chunk_no, chunk_ids
            if not blob:
                return
            name = f'{group}-{chunk_no:03}'
            write_chunk(name, blob)
            for key in chunk_ids:
                manifest['meshes'][key]['chunk'] = name
            blob, chunk_ids = bytearray(), []
            chunk_no += 1

        for key, meta in catalog['meshes'].items():
            if meta['group'] != group:
                continue
            estimated = meta['vertices'] * 18 + meta['indices'] * meta['indexWidth']
            if blob and len(blob) + estimated > 1024 * 1024:
                flush()
            positions = np.frombuffer(raw, dtype='<f4', count=meta['vertices'] * 3, offset=meta['offset']).reshape(-1, 3)
            indices = np.frombuffer(raw, dtype='<u2' if meta['indexWidth'] == 2 else '<u4', count=meta['indices'], offset=meta['offset'] + meta['vertices'] * 12)
            manifest['meshes'][key] = append_mesh(blob, positions, indices, group)
            chunk_ids.append(key)
        flush()
    text = json.dumps(manifest, ensure_ascii=False, separators=(',', ':'))
    (ROOT / 'assets/anatomy/manifest-v22.json').write_text(text, encoding='utf-8')
    print(json.dumps({'version': VERSION, 'liteBytes': manifest['chunks']['lite']['bytes'], 'chunks': len(manifest['chunks']), 'meshes': len(manifest['meshes']), 'bytes': sum(c['bytes'] for c in manifest['chunks'].values())}))


if __name__ == '__main__':
    build()
