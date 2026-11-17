"""Build public literature pages and compact positional search shards."""
import argparse
from array import array
import base64
import gzip
import json
from pathlib import Path
import re
import unicodedata
import zlib

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ('title', 'authors', 'journal', 'abstract', 'mesh')
DOC_STRIDE = 524288
FIELD_STRIDE = 65536
SHARDS = 64
META_FIELDS = ('key', 'pmid', 'doi', 'year', 'firstdate', 'title', 'authors', 'journal', 'cited', 'level', 'topics', 'oa', 'date_pending')


def tokens(value):
    if isinstance(value, list):
        value = ' '.join(map(str, value))
    value = ''.join(c for c in unicodedata.normalize('NFKD', str(value or '')).lower() if not unicodedata.combining(c))
    value = re.sub(r'([\u3400-\u9fff])', r' \1 ', value)
    return re.findall(r'[^\W_]+', value, re.UNICODE)


def shard(token):
    value = 2166136261
    for byte in token.encode('utf-8'):
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value % SHARDS


def encoded(values):
    result = bytearray()
    previous = 0
    for value in values:
        delta = value - previous
        while delta >= 128:
            result.append((delta & 127) | 128)
            delta >>= 7
        result.append(delta)
        previous = value
    return base64.b64encode(result).decode('ascii')


def write_gzip(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    packed = gzip.compress(raw, compresslevel=9, mtime=0)
    path.write_bytes(packed)
    return len(packed)


def build(source=None, output=None):
    source = Path(source or ROOT / 'scratch/literature-v25/records.json')
    output = Path(output or ROOT / 'scratch/public-library-v28')
    records = json.loads(source.read_text(encoding='utf-8-sig'))
    records.sort(key=lambda d: str(d['key']))
    records.sort(key=lambda d: str(d.get('firstdate') or d.get('year') or ''), reverse=True)
    output.mkdir(parents=True, exist_ok=True)
    postings, metadata, key_pages = {}, [], {}
    for doc_id, doc in enumerate(records):
        metadata.append({'_index': doc_id, **{k: doc[k] for k in META_FIELDS if k in doc},
                         'has_abstract': bool(doc.get('abstract')), 'has_zh': bool(doc.get('has_zh') or doc.get('zh'))})
        key_pages[str(doc['key'])] = doc_id // 100
        for field_id, field in enumerate(FIELDS):
            value = doc.get('authors_full') or doc.get('authors', '') if field == 'authors' else doc.get(field, '')
            for position, token in enumerate(tokens(value)):
                postings.setdefault(token, array('Q')).append(doc_id * DOC_STRIDE + field_id * FIELD_STRIDE + position)
    groups = [{} for _ in range(SHARDS)]
    for token, positions in postings.items():
        groups[shard(token)][token] = encoded(positions)
    term_bytes = sum(write_gzip(output / 'terms' / f'{i:02}.json.gz', group) for i, group in enumerate(groups))
    metadata_paths = []
    meta_bytes = 0
    for part in range(8):
        filename = f'metadata/{part:02}.json.gz'
        selected = metadata[part * len(records) // 8:(part + 1) * len(records) // 8]
        meta_bytes += write_gzip(output / filename, {'docs': selected})
        metadata_paths.append(filename)
    page_bytes = 0
    for start in range(0, len(records), 100):
        page_bytes += write_gzip(output / 'pages' / f'{start // 100:04}.json.gz', {'docs': records[start:start + 100]})
    version = f'public-v28-{zlib.crc32(source.read_bytes()):08x}'
    manifest = {'version': version, 'base_url': '/api/library/static/', 'total': len(records), 'page_size': 100,
                'metadata': metadata_paths, 'postings': {'shards': SHARDS, 'template': 'terms/{n}.json.gz'},
                'pages': {'template': 'pages/{n}.json.gz'}, 'key_pages': key_pages,
                'initial': [d for d in records if not d.get('date_pending')][:20],
                'default_order': [str(d['key']) for d in records if not d.get('date_pending')],
                'dates': {str(d['key']): str(d.get('firstdate') or d.get('year') or '') for d in records},
                'aliases': {str(d['key']): [str(d[name]) for name in ('pmid', 'doi') if d.get(name) and str(d[name]) != str(d['key'])] for d in records},
                'search_format': 'positional-varint-v1', 'doc_stride': DOC_STRIDE, 'field_stride': FIELD_STRIDE}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    report = {'records': len(records), 'terms': len(postings), 'metadata_bytes': meta_bytes,
              'term_shards_bytes': term_bytes, 'term_shard_count': SHARDS,
              'content_bytes': page_bytes, 'manifest_bytes': (output / 'manifest.json').stat().st_size,
              'source_bytes': source.stat().st_size, 'version': version}
    (output / 'build-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    build(args.source, args.output)
