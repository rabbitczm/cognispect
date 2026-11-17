import base64
import gzip
import json
from pathlib import Path
import re
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


class AnatomyDeliveryTest(unittest.TestCase):
    def test_lightweight_entry_and_exact_organ_refinement(self):
        self.assertTrue((ROOT / 'assets/anatomy/manifest-v22.json').exists(), 'progressive anatomy delivery must be built')
        manifest = json.loads((ROOT / 'assets/anatomy/manifest-v22.json').read_text(encoding='utf-8'))
        self.assertLess(manifest['chunks']['lite']['bytes'], 2 * 1024 * 1024)
        self.assertIn('heart', {m['group'] for m in manifest['lite'].values()})
        catalog = json.loads((ROOT / 'data/anatomy-catalog.json').read_text(encoding='utf-8'))
        heart = catalog['parts']['FMA7088']['elements']
        files = {manifest['meshes'][key]['chunk'] for key in heart}
        self.assertTrue(files)
        self.assertLess(sum(manifest['chunks'][name]['bytes'] for name in files), 5 * 1024 * 1024)
        originals = {}
        for key in heart:
            meta = manifest['meshes'][key]
            raw = gzip.decompress((ROOT / manifest['chunks'][meta['chunk']]['file'].lstrip('/')).read_bytes())
            vertices = np.frombuffer(raw, dtype='<f4', count=meta['vertices'] * 3, offset=meta['offset'])
            old = catalog['meshes'][key]
            if old['group'] not in originals:
                source = (ROOT / catalog['packs'][old['group']]['file']).read_text(encoding='utf-8')
                originals[old['group']] = base64.b64decode(re.search(r'=\s*"([A-Za-z0-9+/=]+)"\s*;', source).group(1))
            original = originals[old['group']]
            expected = np.frombuffer(original, dtype='<f4', count=old['vertices'] * 3, offset=old['offset'])
            np.testing.assert_array_equal(vertices, expected)
            normals = np.frombuffer(raw, dtype='<i2', count=meta['vertices'] * 3, offset=meta['offset'] + meta['vertices'] * 12)
            lengths = np.linalg.norm(normals.reshape(-1, 3) / 32767, axis=1)
            self.assertTrue(np.all((lengths < .001) | (np.abs(lengths - 1) < .001)))


if __name__ == '__main__':
    unittest.main()
