import importlib.util, json, pathlib, sys, unittest, types
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
path=ROOT/'tools/research_api.py'
if path.exists():
 spec=importlib.util.spec_from_file_location('research_api',path);api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
else:api=types.SimpleNamespace()
class ResearchTests(unittest.TestCase):
 def ready(self):self.assertTrue(hasattr(api,'analyze_csv'),'statistical engine not implemented')
 def test_auc_known_value_and_ties(self):
  self.ready();self.assertAlmostEqual(api.auc([0,0,1,1],[.1,.4,.35,.8]),.75);self.assertEqual(api.auc([0,1],[.5,.5]),.5)
 def test_auc_rejects_single_class(self):
  self.ready()
  with self.assertRaises(ValueError):api.auc([1,1],[.2,.3])
 def test_statistics_use_sample_sd_and_report_excluded_rows(self):
  self.ready();v=api.analyze_csv('group,value\nA,1\nA,2\nA,3\nB,2\nB,4\nB,6\nA,\n','groups')
  self.assertEqual(v['excluded_rows'],1);self.assertEqual(v['groups']['A']['mean'],2);self.assertEqual(v['groups']['A']['sd'],1)
 def test_chart_and_export_retain_validated_observations_for_reproduction(self):
  self.ready();result=api.analyze_csv('group,value\nA,1\nA,2\nA,\nB,4\nB,5','groups')
  response=api.plot_statistics(result,synthetic=True)
  self.assertEqual(response['rows'],[{'group':'A','value':1.0},{'group':'A','value':2.0},{'group':'B','value':4.0},{'group':'B','value':5.0}])
  exported=json.loads(api.ROOT.joinpath(*response['artifacts']['json'].lstrip('/').split('/')).read_text(encoding='utf-8'))
  self.assertEqual(exported['rows'],response['rows'])
  self.assertEqual(response['n'],4)
 def test_group_robustness_is_reproducible_and_reports_bootstrap_interval_and_rank_sensitivity(self):
  self.ready();text='group,value\nA,1\nA,2\nA,3\nB,4\nB,5\nB,6'
  a=api.analyze_csv(text,'groups',robustness=True);b=api.analyze_csv(text,'groups',robustness=True)
  self.assertEqual(a['robustness'],b['robustness'])
  self.assertEqual(a['robustness']['method'],'independent stratified percentile bootstrap')
  self.assertEqual(a['robustness']['replicates'],2000)
  self.assertEqual(a['robustness']['mean_difference']['estimate'],3)
  self.assertLessEqual(a['robustness']['mean_difference']['ci95'][0],3)
  self.assertGreaterEqual(a['robustness']['mean_difference']['ci95'][1],3)
  self.assertEqual(a['robustness']['mann_whitney']['u'],0)
  self.assertGreaterEqual(a['robustness']['mann_whitney']['p'],0)
  self.assertLessEqual(a['robustness']['mann_whitney']['p'],1)
 def test_bootstrap_sensitivity_requires_exactly_two_groups_without_silent_fallback(self):
  self.ready()
  with self.assertRaisesRegex(ValueError,'恰好两组'):
   api.analyze_csv('group,value\nA,1\nA,2\nA,3','groups',robustness=True)
 def test_no_infinite_values_silently_enter_statistics(self):
  self.ready()
  with self.assertRaises(ValueError):api.analyze_csv('group,value\nA,inf\nB,2','groups')
 def test_model_url_requires_https_or_loopback_and_no_credentials(self):
  self.ready();self.assertEqual(api.validate_endpoint('https://api.deepseek.com/chat/completions'),'https://api.deepseek.com/chat/completions')
  for url in ['http://example.com/chat','file:///x','https://user:secret@example.com/chat','https://example.com/chat?key=secret']:
   with self.assertRaises(ValueError):api.validate_endpoint(url)
 def test_pubmed_filter_uses_plain_query_not_patient_identifiers(self):
  self.ready();q=api.make_epmc_query([['lung nodule','pulmonary nodule'],['radiomics']]);self.assertIn('TITLE_ABS:',q);self.assertIn(' AND ',q)
 def test_public_search_has_official_pubmed_fallback_query(self):
  self.ready();q=api.make_pubmed_query([['lung nodule','pulmonary nodule'],['radiomics']])
  self.assertIn('"lung nodule"[Title/Abstract]',q);self.assertIn(' OR ',q);self.assertIn(' AND ',q)
  self.assertNotIn('John Smith',q)
 def test_request_normalizes_base_url_without_leaking_key(self):
  self.ready();v=api.model_payload({'url':'https://api.deepseek.com','model':'deepseek-flash','key':'fake-unit-key'},'question')
  self.assertTrue(v['url'].endswith('/chat/completions'));self.assertNotIn('fake-unit-key',str(v['body']));self.assertEqual(v['body']['stream'],True)
if __name__=='__main__':unittest.main(verbosity=2)
