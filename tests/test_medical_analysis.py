import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
path = ROOT / 'tools' / 'medical_analysis.py'
if path.exists():
    spec = importlib.util.spec_from_file_location('medical_analysis', path)
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
else:
    api = types.SimpleNamespace()


class MedicalAnalysisTests(unittest.TestCase):
    def run_downloaded_script(self, result):
        self.assertIn('python_export', result, 'analysis must provide a standalone downloadable script')
        with tempfile.TemporaryDirectory(dir=ROOT / 'scratch') as directory:
            script = pathlib.Path(directory) / 'analysis.py'
            script.write_text(result['python_export'], encoding='utf-8')
            completed = subprocess.run([sys.executable, str(script)], cwd=directory,
                                       capture_output=True, text=True, encoding='utf-8', timeout=30)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            return json.loads(completed.stdout)

    def test_paired_before_after_keeps_subject_pairs_and_uses_paired_difference(self):
        self.assertTrue(hasattr(api, 'analyze_medical'), 'medical analysis not implemented')
        result = api.analyze_medical({
            'mode': 'paired',
            'csv': '编号,治疗前,治疗后\np1,10,12\np2,20,24\np3,30,36\np4,40,48\np5,50,\n',
            'column_mapping': {'subject': '编号', 'before': '治疗前', 'after': '治疗后'},
        })
        self.assertEqual(result['n'], 4)
        self.assertEqual(result['excluded_rows'], 1)
        self.assertEqual(result['paired']['mean_difference'], 5)
        self.assertAlmostEqual(result['paired']['statistic'], 3.872983346207417)
        self.assertEqual(result['rows'][0]['subject'], 'p1')
        self.assertEqual(len(result['series'][0]['y']), 4)
        json.dumps(result, allow_nan=False)
        downloaded = self.run_downloaded_script(result)
        self.assertEqual(downloaded['paired']['mean_difference'], 5)
        self.assertEqual(downloaded['excluded_rows'], 1)

    def test_wilcoxon_uses_each_subjects_after_minus_before(self):
        self.assertTrue(hasattr(api, 'analyze_medical'), 'medical analysis not implemented')
        result = api.analyze_medical({'mode': 'paired', 'paired_test': 'wilcoxon',
            'csv': 'subject,before,after\na,10,11\nb,10,12\nc,10,13\nd,10,14\ne,10,15\nf,10,16'})
        self.assertEqual(result['paired']['method'], 'Wilcoxon signed-rank')
        self.assertEqual(result['paired']['statistic'], 0)
        self.assertAlmostEqual(result['paired']['p'], .03125)

    def test_longitudinal_estimates_group_time_interaction_with_subject_intercepts(self):
        self.assertTrue(hasattr(api, 'analyze_medical'), 'medical analysis not implemented')
        lines = ['subject,time,group,value']
        for group, slope in [('A', 1), ('B', 3)]:
            for subject, offset in enumerate([-2, -1, .5, 2, 3, 4]):
                for time, noise in enumerate([0, .2, -.1, .1]):
                    value = 10 + offset + (slope + (subject - 2.5) * .04) * time + noise
                    lines.append(f'{group}{subject},{time},{group},{value}')
        result = api.analyze_medical({'mode': 'longitudinal', 'csv': '\n'.join(lines)})
        model = result['mixed_model']
        self.assertEqual(model['subjects'], 12)
        interaction = next(row for row in model['coefficients'] if ':time' in row['term'] or 'time:' in row['term'])
        self.assertAlmostEqual(interaction['estimate'], 2, places=5)
        self.assertTrue(model['converged'])
        self.assertGreater(model['random_intercept_variance'], 0)
        self.assertEqual(len(result['rows']), 48)
        json.dumps(result, allow_nan=False)
        downloaded = self.run_downloaded_script(result)
        interaction = next(row for row in downloaded['mixed_model']['coefficients'] if ':time' in row['term'] or 'time:' in row['term'])
        self.assertAlmostEqual(interaction['estimate'], 2, places=5)

    def test_survival_uses_first_event_and_counts_censoring_in_kaplan_meier(self):
        self.assertTrue(hasattr(api, 'analyze_medical'), 'medical analysis not implemented')
        result = api.analyze_medical({'mode': 'survival', 'csv':
            'subject,time,event,group\na1,2,1,A\na1,6,1,A\na2,4,0,A\na3,4,1,A\nb1,3,1,B\nb2,5,1,B\nb3,5,0,B'})
        self.assertEqual(result['n'], 6)
        a = result['survival']['groups']['A']
        self.assertEqual(a['events'], 2)
        self.assertEqual(a['censored'], 1)
        self.assertAlmostEqual(a['table'][0]['survival'], 2 / 3)
        self.assertAlmostEqual(a['table'][1]['survival'], 1 / 3)
        self.assertEqual(a['table'][1]['at_risk'], 2)
        self.assertAlmostEqual(result['survival']['logrank']['statistic'], .36 / .74)
        self.assertIn('Log-rank', result['summary'])
        self.assertTrue(any('P值' in row for row in result['result_rows']))
        json.dumps(result, allow_nan=False)
        downloaded = self.run_downloaded_script(result)
        self.assertAlmostEqual(downloaded['survival']['logrank']['statistic'], .36 / .74)

    def test_pk_fit_recovers_rates_and_export_reproduces_fitted_curve(self):
        self.assertTrue(hasattr(api, 'fit_model'), 'PK fitting not implemented')
        import math
        csv = 'time,concentration\n' + '\n'.join(
            f'{time},{10 * (4 / 7 * math.exp(-.8 * time) + 3 / 7 * math.exp(-.1 * time))}'
            for time in [0, .25, .5, 1, 2, 3, 4, 6, 8, 12, 18, 24])
        result = api.fit_model({'csv': csv, 'dose': 100, 'v1': 10, 'v2': 20,
            'parameters': {'k12': .2, 'k21': .2, 'ke': .1},
            'fit_parameters': ['k12', 'k21', 'ke']})
        for name, expected in [('k12', .3), ('k21', .4), ('ke', .2)]:
            self.assertAlmostEqual(result['parameters'][name], expected, places=5)
        self.assertLess(result['metrics']['rmse'], 1e-6)
        self.assertEqual(len(result['rows']), 12)
        namespace = {'__name__': 'export_verification'}
        exec(result['python_export'], namespace)
        self.assertAlmostEqual(float(namespace['predicted'][4]), result['rows'][4]['predicted'], places=6)
        json.dumps(result, allow_nan=False)


if __name__ == '__main__':
    unittest.main(verbosity=2)
