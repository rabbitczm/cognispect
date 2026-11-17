"""Regression tests using synthetic inputs only."""
import contextlib
import hashlib
import io
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'code'))
import numpy as np
import helix_lidc as H
import step3_radiomics as s3
import step4_dataset as s4

def annotation(reader, x1, x2):
    contour = H.RoiContour(0.0, 'synthetic-sop', True, [(x1, 2), (x2, 2), (x2, 5), (x1, 5)])
    return H.Annotation('synthetic-case', reader, str(reader), 4, 3, 3, 3, [contour])

class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / 'tests' / 'tmp').mkdir(exist_ok=True)

    def test_four_readers_require_three_votes_for_majority(self):
        group = H.NoduleGroup('synthetic-case', 1, [annotation(0, 2, 5), annotation(1, 2, 5),
                                                  annotation(2, 10, 13), annotation(3, 10, 13)])
        series = {'slice_z': [0.0], 'rows': 20, 'cols': 20, 'n_slices': 1}
        mask, stats = s3.build_mask(group, series, 'majority')
        self.assertEqual(stats['vote_threshold'], 3)
        self.assertEqual(int(mask.sum()), 0, 'Empty majority mask must stay empty.')

    def test_two_readers_can_retain_their_common_consensus(self):
        group = H.NoduleGroup('synthetic-case', 1, [annotation(0, 2, 6), annotation(1, 3, 7)])
        mask, stats = s3.build_mask(group, {'slice_z':[0.0], 'rows':20, 'cols':20, 'n_slices':1}, 'consensus')
        self.assertEqual(stats['vote_threshold'], 2)
        self.assertGreater(int(mask.sum()), 0)

    def test_resume_feature_file_keeps_previously_completed_rows(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'tests' / 'tmp') as tmp:
            path=pathlib.Path(tmp)/'features.csv'
            s3.save_feature_rows(path,[{'patient_id':'synthetic-a','group_id':1,'original_a':1.0}])
            s3.save_feature_rows(path,[{'patient_id':'synthetic-b','group_id':2,'original_a':2.0}],resume=True)
            import csv
            with path.open(encoding='utf-8-sig',newline='') as source:
                rows=list(csv.DictReader(source))
            self.assertEqual([r['patient_id'] for r in rows],['synthetic-a','synthetic-b'])

    def test_resume_rejects_changed_extraction_settings(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'tests' / 'tmp') as tmp:
            path=pathlib.Path(tmp)/'features.csv'
            row={'patient_id':'synthetic-a','group_id':1,'original_a':1.0}
            s3.save_feature_rows(path,[row],signature='majority-settings')
            with self.assertRaisesRegex(ValueError, '参数|来源'):
                s3.save_feature_rows(path,[row],resume=True,signature='consensus-settings')

    def test_anisotropic_spacing_scales_each_contour_axis(self):
        group = H.NoduleGroup('synthetic-case', 1, [annotation(0, 0, 10)])
        # 10 columns by 3 rows; row=2mm, col=0.5mm gives sqrt(25+36).
        self.assertAlmostEqual(group.diameter_mm((2.0, 0.5)), 7.810249675906654)

    def test_nonfinite_features_are_reported(self):
        report = s4.audit(np.array([[1., np.inf], [2., 3.]]), np.array([0, 1]),
                          np.array(['a', 'b']), ['valid', 'broken'])
        self.assertEqual(report['columns_with_inf'], ['broken'])

    def test_input_fingerprint_changes_when_feature_values_change(self):
        with tempfile.TemporaryDirectory(dir=ROOT / 'tests' / 'tmp') as tmp:
            folder = pathlib.Path(tmp)
            hashes = []
            for factor in (1, 100):
                csv_path = folder / f'{factor}.csv'
                csv_path.write_text('patient_id,group_id,label_malignant,original_feature\n' +
                                    '\n'.join(f'synthetic-{i},1,{i % 2},{(i+1)*factor}' for i in range(40)), encoding='utf-8')
                out = folder / str(factor)
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(s4.main(['--features', str(csv_path), '--out', str(out), '--dry-run']), 0)
                report = json.loads((out / 'data_audit.json').read_text(encoding='utf-8'))
                hashes.append(report['input_sha256'])
                self.assertEqual(report['input_sha256'], hashlib.sha256(csv_path.read_bytes()).hexdigest())
            self.assertNotEqual(hashes[0], hashes[1])

    def test_nested_cv_runs_and_keeps_each_patient_in_one_fold(self):
        rng = np.random.default_rng(7)
        groups = np.repeat([f'synthetic-{i}' for i in range(48)], 2)
        y = np.repeat(np.arange(48) % 2, 2)
        X = rng.normal(size=(96, 4))
        X[:, 0] += y * 0.7
        args = s4.parse_args(['--features', 'unused', '--outer', '3', '--inner', '2'])
        result = s4.run_cv(X, y, groups, args)
        self.assertTrue(np.isfinite(result['oof']).all())
        for fold in result['folds']:
            self.assertTrue(set(fold['train_patient_ids']).isdisjoint(fold['test_patient_ids']))
            self.assertEqual(fold['inner_patient_overlap_count'], 0)
        self.assertNotIn('metrics_at_oof_youden', result['summary'])

if __name__ == '__main__':
    (ROOT / 'tests' / 'tmp').mkdir(exist_ok=True)
    unittest.main(verbosity=2)
