"""Export the hosted application as a clean source tree without runtime data."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {'Dockerfile', 'compose.yaml', '.dockerignore', '.gitignore', '.gitattributes', 'README.md', 'DEPLOY.md', 'PUBLICATION.md', 'ATTRIBUTION.md', 'requirements-web.txt', 'requirements-research.txt'}
BUILD_TOOLS = {'check_imaging_v22.cjs', 'check_imaging_pixels_v22.py', 'check_reading_v22.cjs', 'check_experience_v22.cjs', 'check_capacity_v22.mjs', 'submit_indexnow_v22.mjs', 'download_imaging_v22.mjs', 'prepare_imaging_v22.py', 'test_imaging_v22.cjs', 'build_anatomy_binary.py', 'test_anatomy_binary.py', 'check_anatomy_v22.cjs', 'check_anatomy_integrated_v22.cjs', 'test_reader_history.mjs', 'test_search_pages.mjs', 'test_library_loading.mjs', 'test_account_collaboration.mjs', 'test_review_workspace.mjs', 'check_loading_ui.cjs', 'check_v21_browser.cjs', 'check_v21_guest_public.cjs', 'build_release.py', 'build_intro.py', 'build_cloud.py', 'migrate_free_files.py', 'test_free_storage.mjs', 'test_free_pdf_routes.mjs', 'check_pages_assets.mjs', 'check_public_visitor.cjs', 'prepare_browser_runtime.py', 'prepare_compute_baselines.py', 'migrate_cloud.py', 'check_owner_browser.js', 'check_cloud_compute.js', 'check_compute_ui.js', 'serve_cloud_check.mjs', 'check_cloud_pdf_workflow.js', 'test_cloud_worker.mjs', 'audit_literature.py', 'prepare_web_release.py', 'prepare_publication.py', 'translate_publication.py', 'test_web_users.js', 'check_web_browser.py', 'check_upgrade_browser.js', 'check_research_browser.js', 'serve_upgrade_check.py'}
RUNTIME_TOOLS = {'admin_store.py', 'research_store.py', 'site_store.py', 'browser_compute.py', 'medical_analysis.py', 'literature_audit.py', 'research_api.py', 'pdf_library.py', 'translation_service.py', 'publication_library.py', 'export-browser-notes.html'}
CORE_TESTS = {'test_pages_entry.mjs','test_pipeline.py', 'test_final_statistics.py', 'test_medical_analysis.py', 'test_browser_compute.py', 'test_cloud_providers.mjs', 'test_literature_audit.py', 'test_research_api.py', 'test_model_translation.py', 'test_simulation_exports.py', 'test_review_checklists.js', 'test_publication_library.py'}
EXCLUDED_PARTS = {'.git', '.wrangler', '.selftest_tmp', 'scratch', 'exports', 'backups', 'verification', '__pycache__', 'node_modules', '.venv', 'browser-profile', 'browser-cache', 'screenshots'}


def included(path: Path, source: Path):
    parts = path.relative_to(source).parts
    if not path.is_file() or any(part in EXCLUDED_PARTS for part in parts):
        return False
    if parts[:2]==('assets','compute') and path.suffix.lower() in {'.zip','.whl','.wasm','.js','.json','.md','.txt'}:
        return True
    if parts[:2] == ('assets','anatomy') and path.suffix.lower() in {'.gz','.json','.js'}:
        return True
    if parts[:2] == ('assets','imaging'):
        return True
    if parts[:2] == ('data','imaging-sources'):
        return path.suffix.lower() in {'.json','.md','.py','.txt'}
    if path.name == 'runtime.local.json' or path.name.startswith('.env') or path.suffix.lower() in {'.sqlite', '.sqlite3', '.db', '.pyc', '.log', '.tmp', '.zip', '.gz', '.exe', '.dll', '.gguf'} or '.sqlite-' in path.name:
        return False
    if len(parts) == 1:
        return path.name in ROOT_FILES or path.name.startswith(('LICENSE', 'NOTICE', 'COPYING')) or (path.suffix == '.html' and path.name != 'helix-demo.html')
    if parts[0] == '_tools':
        return len(parts) == 2 and path.name in BUILD_TOOLS
    if parts[0] == 'tools':
        return len(parts) == 2 and (path.name.startswith('web_') and path.suffix == '.py' or path.name in RUNTIME_TOOLS)
    if parts[0] == 'tests':
        return len(parts) == 2 and (path.name.startswith('test_web') or path.name in CORE_TESTS)
    if parts[0] == '.github':
        return parts[:2] == ('.github', 'workflows') and path.suffix in {'.yml', '.yaml'}
    if parts[0] in {'cloud','functions'}:
        return path.suffix in {'.js','.mjs','.json','.sql','.toml','.md','.ps1'}
    if parts[0] == 'data':
        if parts[1:3] == ('publication', 'sources'):
            return path.name.endswith('.source.json') or (parts[3:4] == ('metadata',) and path.suffix == '.json')
        if parts[1:3] == ('publication', 'documents'):
            if path.suffix != '.json':
                return False
            document = json.loads(path.read_text(encoding='utf-8-sig'))
            return document.get('license', {}).get('eligibility') in {'eligible', 'eligible_noncommercial'}
        if parts[1] == 'workbench-sources':
            return path.suffix in {'.json', '.md'}
        if parts[1] == 'anatomy-sources':
            return path.suffix in {'.json', '.txt'} or path.name in {'official-license.html', 'official-description.html', 'official-download.html', 'README_e.html'}
        return path.suffix in {'.json', '.txt'}
    return parts[0] in {'_lib', 'assets', 'tools', 'code', 'tests', 'deploy'}


def prepare(source: Path, output: Path, archive_path: Path | None = None):
    source, output = source.resolve(), output.resolve()
    if output.is_relative_to(source):
        raise ValueError('Choose an output directory outside the source tree.')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory is not empty: ' + str(output))
    files = sorted((p for p in source.rglob('*') if included(p, source)), key=lambda p: p.relative_to(source).as_posix())
    output.mkdir(parents=True, exist_ok=True)
    for file in files:
        target = output / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
    if archive_path:
        archive_path = archive_path.resolve()
        archive_path.parent.mkdir(parents=True, exist_ok=True)
        if archive_path.exists():
            raise ValueError('Archive already exists: ' + str(archive_path))
        with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
            for file in files:
                relative = file.relative_to(source)
                bundle.write(output / relative, output.name + '/' + relative.as_posix())
    return {'source': str(source), 'output': str(output), 'files': len(files), 'bytes': sum(p.stat().st_size for p in files), 'archive': str(archive_path) if archive_path else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--archive', type=Path)
    args = parser.parse_args()
    try:
        result = prepare(args.source, args.output, args.archive)
    except (ValueError, OSError) as exc:
        parser.exit(1, str(exc) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()


