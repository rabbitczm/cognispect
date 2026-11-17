"""Create an offline D1 import for private PDFs without changing account data."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

CHUNK_BYTES = 1024 * 1024
SQL_FRAGMENT_BYTES = 32 * 1024


def quoted(value):
    return "'" + str(value).replace("'", "''") + "'"


def export(manifest_path: Path, output: Path):
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    groups = {}
    for entry in manifest.get('files', []):
        key = str(entry['key'])
        if not key.startswith(('users/', 'published-pdfs/')):
            continue
        source = Path(entry['path']).resolve()
        groups.setdefault(source, []).append(key)
    statements = []
    total_bytes = 0
    for source, keys in groups.items():
        size = source.stat().st_size
        if size > 30 * CHUNK_BYTES:
            raise ValueError('A PDF exceeds the 30 MiB file limit.')
        total_bytes += size
        blob_id = quoted('import:' + keys[0])
        statements.append(f"INSERT OR IGNORE INTO storage_blobs(id,size,content_type,complete,created) VALUES({blob_id},{size},'application/pdf',0,{int(time.time() * 1000)});")
        with source.open('rb') as handle:
            index = 0
            while chunk := handle.read(CHUNK_BYTES):
                statements.append(f"INSERT OR IGNORE INTO storage_chunks(blob_id,chunk_index,data) SELECT {blob_id},{index},X'' WHERE EXISTS(SELECT 1 FROM storage_blobs WHERE id={blob_id} AND complete=0);")
                for offset in range(0, len(chunk), SQL_FRAGMENT_BYTES):
                    fragment = chunk[offset:offset + SQL_FRAGMENT_BYTES].hex()
                    statements.append(f"UPDATE storage_chunks SET data=CAST(data || X'{fragment}' AS BLOB) WHERE blob_id={blob_id} AND chunk_index={index} AND length(data)={offset} AND EXISTS(SELECT 1 FROM storage_blobs WHERE id={blob_id} AND complete=0);")
                index += 1
        statements.append(f"UPDATE storage_blobs SET complete=1 WHERE id={blob_id} AND size=(SELECT COALESCE(SUM(length(data)),0) FROM storage_chunks WHERE blob_id={blob_id});")
        for key in keys:
            statements.append(f"INSERT OR IGNORE INTO storage_objects(object_key,blob_id) SELECT {quoted(key)},{blob_id} WHERE EXISTS(SELECT 1 FROM storage_blobs WHERE id={blob_id} AND complete=1);")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('\n'.join(statements) + '\n', encoding='utf-8')
    return {'files': sum(len(keys) for keys in groups.values()), 'blobs': len(groups), 'bytes': total_bytes, 'statements': len(statements)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(export(args.manifest, args.output), ensure_ascii=False))


if __name__ == '__main__':
    main()
