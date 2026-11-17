"""Vendor the pinned browser Python runtime and the shared scientific sources."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = Path('D:/workspace/codex_list')
VERSION = '0.29.0'


def download(url, destination):
    if destination.is_file() and destination.stat().st_size:
        return
    last_error = None
    mirrors = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net'] if 'cdn.jsdelivr.net' in url else ['registry.npmjs.org']
    pending = destination.with_name(destination.name + '.download')
    for host in mirrors:
        for attempt in range(2):
            try:
                with urllib.request.urlopen(url.replace('cdn.jsdelivr.net', host), timeout=120) as response, pending.open('wb') as target:
                    shutil.copyfileobj(response, target)
                pending.replace(destination)
                return
            except OSError as error:
                last_error = error
                time.sleep(.3)
    raise last_error


def prepare(output):
    source = WORKSPACE / 'tools/helix-pyodide/package'
    source.parent.mkdir(parents=True, exist_ok=True)
    if not source.is_dir():
        archive = source.parent / 'pyodide.tgz'
        download(f'https://registry.npmjs.org/pyodide/-/pyodide-{VERSION}.tgz', archive)
        with tarfile.open(archive) as bundle:
            bundle.extractall(source.parent, filter='data')
    output.mkdir(parents=True, exist_ok=True)
    for name in ['pyodide.js', 'pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']:
        shutil.copy2(source / name, output / name)
    lock = json.loads((source / 'pyodide-lock.json').read_text())
    needed = set()
    def include(name):
        if name in needed:
            return
        needed.add(name)
        for dependency in lock['packages'][name]['depends']:
            include(dependency)
    for name in ['numpy', 'scipy', 'statsmodels', 'cryptography', 'charset-normalizer', 'pillow']:
        include(name)
    def package(name):
        record = lock['packages'][name]
        filename = record['file_name']
        download(f'https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/{filename}', source / filename)
        shutil.copy2(source / filename, output / filename)
    with ThreadPoolExecutor(max_workers=5) as pool:
        list(pool.map(package, sorted(needed)))
    # These packages only use pure Python for text and table extraction. The
    # optional native rasterizer is unused; PDF.js renders the visible pages.
    dependencies = WORKSPACE / 'tools/helix-pdf-deps'
    with zipfile.ZipFile(output / 'pdf-python.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
        for module in ['pdfplumber', 'pdfminer']:
            for path in (dependencies / module).rglob('*'):
                if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc':
                    bundle.write(path, path.relative_to(dependencies).as_posix())
        for folder in dependencies.glob('*dist-info'):
            if folder.name.startswith(('pdfplumber-', 'pdfminer_six-')):
                for path in folder.glob('*'):
                    if path.is_file():
                        bundle.write(path, path.relative_to(dependencies).as_posix())
    with zipfile.ZipFile(output / 'zhijing-python.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr('tools/__init__.py', '')
        for name in ['browser_compute.py', 'medical_analysis.py', 'research_api.py', 'pdf_library.py']:
            bundle.write(ROOT / 'tools' / name, 'tools/' + name)
    packages = {name: lock['packages'][name]['version'] for name in sorted(needed)}
    (output / 'runtime.json').write_text(json.dumps({'pyodide': VERSION, 'packages': packages, 'pdfplumber': '0.11.10', 'pdfminer.six': '20260107'}, indent=2), encoding='utf-8')
    licenses = output / 'licenses'
    licenses.mkdir(exist_ok=True)
    download(f'https://raw.githubusercontent.com/pyodide/pyodide/{VERSION}/LICENSE', source / 'LICENSE')
    shutil.copy2(source / 'LICENSE', licenses / 'Pyodide-LICENSE')
    for pattern in ['pdfplumber-*/licenses/*', 'pdfminer_six-*/licenses/*']:
        for path in dependencies.glob(pattern):
            if path.is_file():
                shutil.copy2(path, licenses / (path.parent.parent.name + '-' + path.name))
    print(json.dumps({'output': str(output), 'files': len(list(output.rglob('*'))), 'bytes': sum(p.stat().st_size for p in output.rglob('*') if p.is_file()), 'packages': packages}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/compute')
    prepare(parser.parse_args().output)
