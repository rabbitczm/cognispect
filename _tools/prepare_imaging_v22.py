"""Prepare original-resolution public CT slices for the browser imaging laboratory."""
from pathlib import Path
import gzip
import json
import math
import re
import struct
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'data/imaging-sources'
OUTPUT = ROOT / 'assets/imaging'
VERSION = 'imaging-20261116-1'


def nrrd(name):
    raw = (SOURCES / name).read_bytes()
    end = raw.index(b'\n\n')
    header = dict(line.split(': ', 1) for line in raw[:end].decode().splitlines() if ': ' in line and not line.startswith('#'))
    sizes = list(map(int, header['sizes'].split()))
    directions = [list(map(float, part.split(','))) for part in re.findall(r'\(([^)]+)\)', header['space directions'])]
    dtype = {'int': '<i4', 'float': '<f4'}[header['type']]
    data = np.frombuffer(gzip.decompress(raw[end + 2:]), dtype).reshape(sizes[::-1])
    return data, directions, list(map(float, header['space origin'].strip('()').split(','))), dtype


def nifti(name):
    raw = gzip.decompress((SOURCES / name).read_bytes())
    dims = struct.unpack_from('<8h', raw, 40)[1:4]
    spacing = struct.unpack_from('<8f', raw, 76)[1:4]
    offset = int(struct.unpack_from('<f', raw, 108)[0])
    slope, intercept = struct.unpack_from('<2f', raw, 112)
    data = np.frombuffer(raw, '<f4', count=math.prod(dims), offset=offset).reshape(dims[::-1])
    if slope not in (0, 1) or intercept:
        data = data * (slope or 1) + intercept
    affine = [list(struct.unpack_from('<4f', raw, off)) for off in (280, 296, 312)]
    if struct.unpack_from('<h', raw, 254)[0]:
        # NIfTI's RAS affine is converted to the LPS coordinates used by NRRD.
        affine = [[-v if row < 2 else v for v in values] for row, values in enumerate(affine)]
        directions = [[affine[row][axis] for row in range(3)] for axis in range(3)]
        origin = [values[3] for values in affine]
    else:
        directions = [[spacing[0], 0, 0], [0, spacing[1], 0], [0, 0, spacing[2]]]
        origin = [0, 0, 0]
    return data, directions, origin, '<f4'


def build():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    specs = [
        ('brain', '脑部 CT', 'brain.nrrd', 26, 32, 100, 40,
         '3D Slicer CT-MR Brain', '受试者向 3D Slicer 捐赠，允许不受限制使用',
         'https://github.com/Slicer/Slicer/blob/main/Modules/Scripted/SampleData/SampleData.py',
         'https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/6a5b6caccb76576a863beb095e3bfb910c50ca78f4c9bf043aa42f976cfa53d1'),
        ('liver', '腹部与肝脏 CT', 'liver.nrrd', 480, 48, 400, 50,
         'Medical Segmentation Decathlon Task03 Liver · liver_100', 'CC BY-SA 4.0',
         'https://creativecommons.org/licenses/by-sa/4.0/',
         'https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/e16eae0ae6fefa858c5c11e58f0f1bb81834d81b7102e021571056324ef6f37e'),
        ('vessel', '肝血管增强 CT', 'vessel.nii.gz', 0, 28, 400, 80,
         'Medical Segmentation Decathlon Task08 HepaticVessel · hepaticvessel_306', 'CC BY-SA 4.0',
         'https://creativecommons.org/licenses/by-sa/4.0/',
         'https://msd-for-monai.s3-us-west-2.amazonaws.com/Task08_HepaticVessel.tar'),
    ]
    datasets = []
    for key, title, file, start, count, window, level, source, license_name, license_url, source_url in specs:
        data, directions, origin, dtype = nifti(file) if file.endswith('.gz') else nrrd(file)
        spacing = [math.sqrt(sum(v*v for v in vector)) for vector in directions]
        chunks = []
        for i in range(0, count, 4):
            slices = np.ascontiguousarray(data[start+i:start+min(i+4, count)], dtype=dtype)
            path = f'{key}-{i:03d}.bin.gz'
            packed = gzip.compress(slices.tobytes(), compresslevel=6, mtime=0)
            (OUTPUT / path).write_bytes(packed)
            chunks.append({'start': i, 'count': len(slices), 'url': '/assets/imaging/' + path, 'bytes': len(packed)})
        datasets.append({'id': key, 'title': title, 'version': VERSION, 'width': data.shape[2], 'height': data.shape[1],
                         'slices': count, 'originalSlices': data.shape[0], 'sourceSliceStart': start, 'dtype': dtype,
                         'spacing': spacing, 'directions': directions, 'origin': origin, 'space': 'LPS',
                         'window': window, 'level': level, 'units': 'HU', 'source': source, 'license': license_name,
                         'licenseUrl': license_url, 'sourceUrl': source_url, 'chunks': chunks, 'referenceMask': None,
                         'processing': '选取连续原始切片，保留原始矩阵、像素值、像素间距和方向；未缩放、未插值。'})
        print(key, data.shape, 'selected', count, 'bytes', sum(c['bytes'] for c in chunks))
    result = {'version': VERSION, 'datasets': datasets}
    (OUTPUT / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (SOURCES / 'provenance.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    build()
