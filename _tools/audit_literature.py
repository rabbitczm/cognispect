"""Refresh every PMID from Europe PMC, check DOI landings and prepare reading drafts."""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from literature_audit import build_guide, compare_metadata, publication_notices, utc_now


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def fetch_batch(keys, batch_index, evidence_dir, refresh=False):
    path = evidence_dir / 'sources' / f'europepmc-{batch_index:03d}.json'
    stamp = path.with_suffix('.fetch.json')
    if path.exists() and stamp.exists() and not refresh and read_json(path).get('resultList', {}).get('result'):
        return read_json(path), read_json(stamp)
    query = 'SRC:MED AND (' + ' OR '.join('EXT_ID:' + k for k in keys) + ')'
    url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?' + urlencode({'query': query, 'format': 'json', 'resultType': 'core', 'pageSize': 1000})
    result = subprocess.run(['curl.exe', '-sS', '--retry-all-errors', '--retry', '4', '--retry-delay', '1', '--max-time', '60', url], capture_output=True, encoding='utf-8')
    evidence = {'url': url, 'retrieved_at': utc_now(), 'exit_code': result.returncode, 'error': result.stderr.strip(), 'pmids': keys}
    data = json.loads(result.stdout) if result.returncode == 0 and result.stdout.startswith('{') else {}
    save_json(path, data)
    save_json(stamp, evidence)
    return data, evidence


def check_doi(doi, evidence_dir, refresh=False):
    # A separate file per DOI is indexed by the bibliography key by the caller.
    url = 'https://doi.org/' + doi
    result = subprocess.run(['curl.exe', '-sS', '-I', '-L', '--retry-all-errors', '--retry', '2', '--retry-delay', '1', '--connect-timeout', '8', '--max-time', '22', '--write-out', '\n%{json}', url], capture_output=True, encoding='utf-8', errors='replace')
    headers, _, tail = result.stdout.rpartition('\n')
    try:
        info = json.loads(tail)
    except ValueError:
        info = {}
    code = int(info.get('http_code', 0))
    effective = info.get('url_effective', url)
    return {'url': url, 'retrieved_at': utc_now(), 'method': 'HEAD',
            'http_status': code, 'effective_url': effective, 'redirect_count': info.get('num_redirects', 0),
            'status': 'verified' if result.returncode == 0 and 200 <= code < 300 and 'doi.org/' not in effective else 'unreachable',
            'exit_code': result.returncode, 'error': result.stderr.strip(), 'response_headers': headers[-7000:]}


def run(refresh=False, doi_workers=16, retry_network=True):
    library = read_json(ROOT / '_lib/lib.json')['docs']
    manifest = {str(r['key']): r for r in read_json(ROOT / 'data/publication/manifest.json')['records']}
    reader = read_json(ROOT / 'data/reader-content.json')['abstracts']
    audit_dir = ROOT / 'data/literature-audit'
    guides_dir = ROOT / 'data/paper-guides'
    source_availability = {'checked_at': utc_now(), 'records': [
        {'key': key, 'document_path': record.get('document_path'),
         'document_exists': bool(record.get('document_path') and (ROOT / record['document_path']).is_file()),
         'source_xml': record.get('source_xml'),
         'source_xml_exists': bool(record.get('source_xml') and (ROOT / record['source_xml']).is_file())}
        for key, record in manifest.items() if record.get('document_path')]}
    source_availability['summary'] = {'manifest_document_paths': len(source_availability['records']),
                                       'present_documents': sum(r['document_exists'] for r in source_availability['records']),
                                       'missing_documents': sum(not r['document_exists'] for r in source_availability['records'])}
    save_json(audit_dir / 'source-availability.json', source_availability)
    official = {}
    provenance = {}
    batches = [(i, [str(d['pmid']) for d in library[n:n + 100]]) for i, n in enumerate(range(0, len(library), 100))]
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_batch, keys, i, audit_dir, refresh): i for i, keys in batches}
        for future in as_completed(futures):
            data, evidence = future.result()
            for key in evidence.get('pmids', []):
                provenance[key] = evidence
            for row in data.get('resultList', {}).get('result', []):
                official[str(row['id'])] = row
                provenance[str(row['id'])] = evidence
            print(f'metadata batch {futures[future] + 1}/{len(batches)}; {len(official)} official records', flush=True)
    doi_results = {}
    jobs = []
    for doc in library:
        key = str(doc['key'])
        doi = official.get(key, {}).get('doi') or doc.get('doi')
        path = audit_dir / 'links' / f'{key}.json'
        if path.exists() and not refresh:
            doi_results[key] = read_json(path)
            cached = doi_results[key]
            cached['status'] = 'verified' if cached.get('exit_code') == 0 and 200 <= cached.get('http_status', 0) < 300 and 'doi.org/' not in cached.get('effective_url', '') else 'unreachable'
            if cached.get('exit_code') != 0 and retry_network:
                jobs.append((key, doi, path))
            else:
                save_json(path, cached)
        elif doi:
            jobs.append((key, doi, path))
    with ThreadPoolExecutor(max_workers=doi_workers) as pool:
        futures = {pool.submit(check_doi, doi, audit_dir, refresh): (key, path) for key, doi, path in jobs}
        for n, future in enumerate(as_completed(futures), 1):
            key, path = futures[future]
            doi_results[key] = future.result()
            save_json(path, doi_results[key])
            if n % 100 == 0 or n == len(futures):
                print(f'DOI checks {n}/{len(futures)}', flush=True)
    audits = []
    guides = []
    for doc in library:
        key = str(doc['key'])
        source = official.get(key)
        compared = compare_metadata(doc, source) if source else {'status': 'unreachable', 'fields': {}}
        link = doi_results.get(key, {'status': 'pending', 'url': '', 'reason': 'No DOI in available metadata'})
        status = compared['status']
        if status == 'verified' and link['status'] == 'unreachable':
            status = 'unreachable'
        record = {'key': key, 'pmid': str(doc['pmid']), 'title': doc['title'],
                  'status': status, 'metadata_status': compared['status'], 'fields': compared['fields'],
                  'checked_at': utc_now(), 'source': provenance.get(key, {}),
                  'official_metadata_path': f'data/literature-audit/records/{key}.json',
                  'doi_link': link, 'official_metadata': source,
                  'notices': publication_notices(source or {})}
        record['doi_link']['verification_scope'] = 'DOI resolution and publisher landing HTTP accessibility (HEAD)'
        record['doi_link']['publisher_content_identity'] = 'not_assessed'
        save_json(audit_dir / 'records' / f'{key}.json', record)
        audits.append({k: v for k, v in record.items() if k not in {'official_metadata', 'doi_link'}} | {'doi_url': link.get('url'), 'doi_status': link['status'], 'doi_http_status': link.get('http_status'), 'publisher_url': link.get('effective_url')})
        publication = manifest.get(key, {})
        document_path = ROOT / publication['document_path'] if publication.get('document_path') else None
        document = read_json(document_path) if document_path and document_path.exists() else None
        abstract = source.get('abstractText', '') if source else ''
        if not abstract:
            abstract = reader.get(key, '')
        guide = build_guide(doc, document, abstract)
        guide['source_evidence'] = {'fulltext_document': publication.get('document_path'),
                                    'fulltext_xml': publication.get('source_xml'), 'fulltext_fetch': publication.get('fetch'),
                                    'fulltext_document_exists': bool(document_path and document_path.is_file()),
                                    'fulltext_xml_exists': bool(publication.get('source_xml') and (ROOT / publication['source_xml']).is_file()),
                                    'abstract_source': 'fresh_europe_pmc' if source and source.get('abstractText') else 'data/reader-content.json',
                                    'metadata_audit': f'data/literature-audit/records/{key}.json'}
        guide['article_notices'] = record['notices']
        save_json(guides_dir / f'{key}.json', guide)
        guides.append({k: guide[k] for k in ('key', 'id', 'title', 'basis', 'status', 'review_status')} |
                      {'path': f'data/paper-guides/{key}.json', 'evidence_count': sum(len(s['evidence']) for s in guide['sections']),
                       'article_notice_status': record['notices']['status'],
                       'pending_sections': [s['id'] for s in guide['sections'] if s['status'] == 'pending']})
    generated = utc_now()
    audit_index = {'schema_version': 1, 'generated_at': generated, 'summary': {'records': len(audits), 'status': dict(Counter(r['status'] for r in audits)), 'metadata_status': dict(Counter(r['metadata_status'] for r in audits)), 'doi_status': dict(Counter(r['doi_status'] for r in audits)), 'article_notice_status': dict(Counter(r['notices']['status'] for r in audits))}, 'records': audits}
    guide_index = {'schema_version': 1, 'generated_at': generated, 'summary': {'records': len(guides), 'basis': dict(Counter(r['basis'] for r in guides)), 'status': dict(Counter(r['status'] for r in guides))}, 'records': guides}
    save_json(audit_dir / 'index.json', audit_index)
    save_json(guides_dir / 'index.json', guide_index)
    output = ROOT.parents[1] / 'output/zhijing-update'
    save_json(output / 'literature-audit.json', audit_index)
    save_json(output / 'paper-guides-index.json', guide_index)
    save_json(output / 'source-availability.json', source_availability)
    columns = ['key', 'title', 'status', 'metadata_status', 'doi_status', 'doi_http_status', 'publisher_url', 'conflict_fields', 'article_notice_status']
    with (output / 'literature-audit.csv').open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for record in audits:
            row = {k: record.get(k, '') for k in columns}
            row['conflict_fields'] = ', '.join(k for k, v in record['fields'].items() if v['status'] == 'conflict')
            row['article_notice_status'] = record['notices']['status']
            writer.writerow(row)
    print(json.dumps({'audit': audit_index['summary'], 'guides': guide_index['summary']}, ensure_ascii=False), flush=True)
    return audit_index, guide_index


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--doi-workers', type=int, default=16)
    parser.add_argument('--no-retry-network', action='store_true', help='Rebuild evidence indexes and guides from existing link attempts')
    args = parser.parse_args()
    run(refresh=args.refresh, doi_workers=args.doi_workers, retry_network=not args.no_retry_network)
