"""Browser bridge uses the same scientific methods and PDF table extraction."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class BrowserComputeTests(unittest.TestCase):
    def test_browser_request_keeps_scientific_result_and_reproduction_export(self):
        from tools.browser_compute import compute
        result = compute('stats', {'mode': 'paired', 'csv': 'subject,before,after\na,12,9\nb,15,11\nc,11,10\nd,18,13\ne,14,12\nf,17,12'})
        self.assertEqual(result['n'], 6)
        self.assertAlmostEqual(result['paired']['mean_difference'], -10 / 3)
        self.assertIn('python_export', result)
        conventional = compute('stats', {'mode': 'correlation', 'csv': 'x,y\n1,2\n2,4\n3,6\n4,8'})
        self.assertAlmostEqual(conventional['pearson']['r'], 1)
        self.assertIn('python_export', conventional)
        json.dumps(conventional, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
