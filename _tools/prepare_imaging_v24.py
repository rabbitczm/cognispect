"""Split the existing lossless image blocks into independently cached original slices."""
from pathlib import Path
import gzip
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/imaging/manifest.json'
OUTPUT = ROOT / 'assets/imaging/v24'
VERSION = 'imaging-slices-v24.1'


def build():
    manifest = json.loads(SOURCE.read_text(encoding='utf-8'))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest['version'] = VERSION
    summary = []
    for dataset in manifest['datasets']:
        entries = []
        size = dataset['width'] * dataset['height'] * 4
        for old in dataset['chunks']:
            raw = gzip.decompress((ROOT / old['url'].lstrip('/')).read_bytes())
            for offset in range(old['count']):
                index = old['start'] + offset
                path = OUTPUT / f"{dataset['id']}-{index:03}.bin.gz"
                packed = gzip.compress(raw[offset * size:(offset + 1) * size], compresslevel=9, mtime=0)
                path.write_bytes(packed)
                entries.append({'start': index, 'count': 1, 'url': '/' + path.relative_to(ROOT).as_posix(), 'bytes': len(packed)})
        dataset['version'] = VERSION
        dataset['chunks'] = entries
        summary.append({'id': dataset['id'], 'slices': len(entries), 'initialBytes': entries[dataset['slices'] // 2]['bytes'], 'largestBytes': max(item['bytes'] for item in entries)})
    text = json.dumps(manifest, ensure_ascii=False, separators=(',', ':'))
    (OUTPUT / 'manifest.json').write_text(text, encoding='utf-8')
    (OUTPUT / 'manifest.js').write_text('var IMAGING_MANIFEST=' + text + ';\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    build()
