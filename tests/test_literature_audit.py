import sys
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import literature_audit as audit
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '_tools'))
import audit_literature as runner


class LiteratureAuditTests(unittest.TestCase):
    def test_metadata_comparison_exposes_a_wrong_doi_and_date(self):
        local = {'key': '123', 'pmid': '123', 'title': 'A study of imaging',
                 'authors_full': 'Smith A, Wang B.', 'journal': 'J Imag',
                 'firstdate': '2024-01-01', 'doi': '10.1/wrong'}
        official = {'id': '123', 'title': 'A study of imaging.',
                    'authorString': 'Smith A, Wang B.', 'doi': '10.1/correct',
                    'firstPublicationDate': '2024-02-01',
                    'journalInfo': {'journal': {'medlineAbbreviation': 'J Imag'}}}
        result = audit.compare_metadata(local, official)
        self.assertEqual(result['status'], 'conflict')
        self.assertEqual(result['fields']['title']['status'], 'match')
        self.assertEqual(result['fields']['authors']['status'], 'match')
        self.assertEqual(result['fields']['doi']['official'], '10.1/correct')
        self.assertEqual(result['fields']['publication_date']['status'], 'conflict')

    def test_official_encoded_scientific_markup_does_not_create_title_conflict(self):
        local = {'title': 'Radiomics of 18 F-FDG PET', 'journal': 'J Imag', 'authors': 'Smith A', 'firstdate': '2024-01-01', 'doi': '10.1/study'}
        official = {'title': 'Radiomics of &lt;sup&gt;18&lt;/sup&gt;F-FDG PET.', 'authorString': 'Smith A', 'firstPublicationDate': '2024-01-01', 'doi': '10.1/study', 'journalInfo': {'journal': {'medlineAbbreviation': 'J Imag'}}}
        self.assertEqual(audit.compare_metadata(local, official)['fields']['title']['status'], 'match')

    def test_guide_keeps_actual_methods_results_and_figure_anchors(self):
        document = {'source_url': 'https://europepmc.org/articles/PMC123', 'sections': [
            {'id': 'intro', 'title': 'Introduction', 'paragraphs': [{'id': 'p1', 'en': 'We aimed to predict lung cancer recurrence.'}]},
            {'id': 'methods', 'title': 'Methods', 'paragraphs': [{'id': 'p2', 'en': 'We trained a random forest on 150 CT scans.'}]},
            {'id': 'results', 'title': 'Results', 'paragraphs': [{'id': 'p3', 'en': 'External validation yielded AUC 0.83.'}]},
            {'id': 'data', 'title': 'Data availability', 'paragraphs': [{'id': 'p4', 'en': 'Code is available at https://github.com/example/study.'}]}
        ], 'figures': [{'id': 'f1', 'label': 'Figure 1', 'caption': 'External validation ROC curve.'}]}
        guide = audit.build_guide({'key': '123', 'title': 'Lung cancer CT study'}, document, '')
        sections = {s['id']: s for s in guide['sections']}
        self.assertEqual(guide['basis'], 'fulltext')
        self.assertEqual(guide['review_status'], 'not_reviewed')
        self.assertIn('150 CT scans', sections['methods']['text'])
        self.assertEqual(sections['results']['evidence'][0]['paragraph'], 'p3')
        self.assertEqual(sections['figures']['evidence'][0]['url'], 'https://europepmc.org/articles/PMC123#f1')
        self.assertIn('github.com/example/study', sections['reproduction']['text'])

    def test_abstract_only_guide_does_not_invent_figures_or_reproduction(self):
        guide = audit.build_guide({'key': '124', 'title': 'Validation study'}, None,
                                 '<h4>Methods</h4><p>We enrolled 82 patients.</p><h4>Results</h4><p>AUC was 0.79.</p>')
        sections = {s['id']: s for s in guide['sections']}
        self.assertEqual(guide['basis'], 'abstract')
        self.assertIn('82 patients', sections['methods']['text'])
        self.assertEqual(sections['figures']['status'], 'pending')
        self.assertEqual(sections['figures']['evidence'], [])

    def test_failed_publisher_tls_after_doi_redirect_is_unreachable(self):
        response = CompletedProcess([], 35, stdout='HTTP/1.1 302 Found\n\n{"http_code":302,"url_effective":"https://publisher.example/article","num_redirects":1}', stderr='TLS handshake failed')
        with patch.object(runner.subprocess, 'run', return_value=response):
            result = runner.check_doi('10.1/study', Path('.'))
        self.assertEqual(result['status'], 'unreachable')
        self.assertEqual(result['effective_url'], 'https://publisher.example/article')

    def test_retracted_and_republished_article_retains_replacement_identity(self):
        source = {'pubTypeList': {'pubType': ['Journal Article']}, 'commentCorrectionList': {'commentCorrection': [
            {'type': 'Expression of concern in', 'id': '36436530', 'source': 'MED'},
            {'type': 'Retractedand republished in', 'id': '37307841', 'source': 'MED'}]}}
        notices = audit.publication_notices(source)
        self.assertEqual(notices['status'], 'retracted_and_republished')
        self.assertTrue(notices['retraction_or_correction_flag'])
        self.assertEqual(notices['replacement_pmids'], ['37307841'])


if __name__ == '__main__':
    unittest.main()
