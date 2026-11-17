"""Compare shipped imaging chunks directly with their original source pixels."""
from pathlib import Path
import gzip
import json
import numpy as np
from prepare_imaging_v22 import nrrd, nifti, ROOT

manifest = json.loads((ROOT / 'assets/imaging/manifest.json').read_text(encoding='utf-8'))
report = []
for dataset in manifest['datasets']:
    key = dataset['id']
    original, directions, origin, dtype = nifti('vessel.nii.gz') if key == 'vessel' else nrrd(key+'.nrrd')
    count = 0
    for chunk in dataset['chunks']:
        packed = (ROOT / chunk['url'].lstrip('/')).read_bytes()
        actual = np.frombuffer(gzip.decompress(packed), dataset['dtype']).reshape(chunk['count'], dataset['height'], dataset['width'])
        index = dataset['sourceSliceStart']+chunk['start']
        expected = original[index:index+chunk['count']]
        assert np.array_equal(actual, expected)
        assert np.isfinite(actual).all()
        count += actual.size
    assert dataset['origin'] == origin and dataset['directions'] == directions
    report.append({'dataset': key, 'nativeMatrix': [dataset['width'], dataset['height']], 'slices': dataset['slices'],
                   'pixelsCompared': count, 'allOriginalPixelsExact': True, 'nativeSpatialMetadataPreserved': True,
                   'units': dataset['units'], 'referenceMask': dataset['referenceMask']})
output = Path('D:/workspace/codex_list/output/zhijing-v22/imaging')
output.mkdir(parents=True, exist_ok=True)
(output / 'source-pixel-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
