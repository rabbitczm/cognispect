"""Normal research workflows: summary tables must not become patient observations."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from research_api import analyze_csv

class FinalStatisticsTests(unittest.TestCase):
    def test_paper_summary_is_plotted_without_individual_level_inference(self):
        source={'document_id':'paper-1','page':3,'table':2,'value_column':'mean'}
        result=analyze_csv('group,value\nControl,12\nTreatment,15\nFollow-up,13','summary',data_kind='aggregate',provenance=source)
        self.assertEqual(result['n'],3)
        self.assertEqual(result['provenance'],source)
        self.assertNotIn('welch',result)
        self.assertNotIn('pearson',result)
        self.assertEqual([r['value'] for r in result['rows']],[12,15,13])

    def test_summary_cannot_silently_enter_patient_level_test(self):
        with self.assertRaisesRegex(ValueError,'汇总'):
            analyze_csv('group,value\nA,12\nA,15\nB,13\nB,16','groups',data_kind='aggregate')

if __name__=='__main__':unittest.main()
