"""Run the actual Python exports and compare independent SciPy integration to RK4.

Catches export column/unit/index errors and a resampled time grid that would make
browser CSV rows incomparable to exported results. No clinical validation claim.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'scratch' / 'export-validation'
OUT.mkdir(parents=True, exist_ok=True)
os.environ.update(MPLBACKEND='Agg', MPLCONFIGDIR=str(OUT / 'mpl-cache'))


class SimulationExports(unittest.TestCase):
    def test_exported_scripts_reproduce_times_columns_and_dynamics(self):
        cases = [
            ('pk', {'ke': .25, 'tEnd': 6}),
            ('flow', {'tEnd': 3}),
            ('sir', {'population': 2400, 'infected': 15, 'tEnd': 80}),
            ('ode', {'dx': 'y', 'dy': '-a*x-b*y+sin(t)', 'tEnd': 4}),
            ('ode', {'dx': '-a*x', 'dy': '0', 'tEnd': 1, 'dt': .03}),
        ]
        report = []
        for index, (kind, params) in enumerate(cases):
            with self.subTest(model=kind, parameters=params):
                folder = OUT / str(index)
                folder.mkdir(exist_ok=True)
                js = """const C=require('./_lib/simulation_core.js');
const [id,p]=JSON.parse(process.argv[1]); const r=C.run(id,p);
console.log(JSON.stringify({result:r,python:C.exportCode(r,'python'),matlab:C.exportCode(r,'matlab')}));"""
                data = json.loads(subprocess.check_output(
                    ['node', '-e', js, json.dumps([kind, params])], cwd=ROOT, text=True, encoding='utf-8'))
                script = folder / 'experiment.py'
                script.write_text(data['python'], encoding='utf-8')
                (folder / 'experiment.m').write_text(data['matlab'], encoding='utf-8')
                run = subprocess.run([sys.executable, str(script)], cwd=folder,
                                     capture_output=True, text=True, encoding='utf-8', timeout=45)
                self.assertEqual(run.returncode, 0, run.stderr)
                csv = folder / f'helix-{kind}.csv'
                self.assertEqual(csv.read_text().splitlines()[0], ','.join(data['result']['columns']))
                expected = np.asarray(data['result']['rows'])
                actual = np.loadtxt(csv, delimiter=',', skiprows=1)
                self.assertEqual(actual.shape, expected.shape)
                np.testing.assert_allclose(actual[:, 0], expected[:, 0], rtol=0, atol=1e-12,
                                           err_msg='Export changed requested sample times')
                np.testing.assert_allclose(actual[:, 1:], expected[:, 1:], rtol=2e-5, atol=.004)
                self.assertTrue((folder / f'helix-{kind}.png').stat().st_size > 1000)
                report.append({'model': kind, 'parameters': params, 'points': len(actual),
                               'max_absolute_difference_by_column': np.max(abs(actual-expected), axis=0).tolist(),
                               'columns': data['result']['columns'], 'python_executed': True,
                               'matlab_executed': False})
        (ROOT / 'verification' / 'simulation-export-checks.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    unittest.main()
