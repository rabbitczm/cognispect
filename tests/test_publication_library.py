import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import publication_library as publication

class PublicationReaderTests(unittest.TestCase):
    def test_reader_preserves_sections_tables_and_source_paired_translation(self):
        xml = '''<article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta><title-group><article-title>Imaging study</article-title></title-group><permissions><license xlink:href="https://creativecommons.org/licenses/by/4.0/"><license-p>CC BY 4.0</license-p></license></permissions></article-meta></front><body><sec id="s1"><title>Results</title><p id="p1">The AUC was <bold>0.89</bold> (95% CI 0.81–0.94).<table-wrap id="t1"><label>Table 1</label><caption><p>Validation results</p></caption><table><tbody><tr><td>AUC</td><td>0.89</td></tr></tbody></table></table-wrap></p><fig id="f1"><label>Figure 1</label><caption><p>ROC curve</p></caption><graphic xlink:href="fig1.jpg"/></fig><disp-formula id="eq1"><tex-math>AUC=0.89</tex-math></disp-formula><sec id="s2"><title>External validation</title><p>Independent cohort.</p></sec></sec></body><back><ref-list><ref id="r1"><mixed-citation>Smith 2024.</mixed-citation></ref></ref-list></back></article>'''
        document = publication.normalize_jats(xml, '123', 'https://europepmc.org/articles/PMC123')
        self.assertEqual(document['sections'][0]['paragraphs'][0]['en'], 'The AUC was 0.89 (95% CI 0.81–0.94).')
        self.assertEqual(len(document['sections']), 2)
        self.assertEqual(document['tables'][0]['rows'], [['AUC', '0.89']])
        self.assertEqual(document['figures'][0]['caption'], 'ROC curve')
        self.assertEqual(document['references'][0]['text'], 'Smith 2024.')
        self.assertEqual(document['formulas'][0]['text'], 'AUC=0.89')
        self.assertEqual(document['license']['eligibility'], 'eligible')
        translated = {'sections': [{'id': 's1', 'title': 'Results', 'paragraphs': [{'id': 'p1', 'en': 'The AUC was 0.89 (95% CI 0.81–0.94).', 'zh': 'AUC 为 0.89（95% CI 0.81–0.94）。', 'translation_status': 'draft'}]}]}
        publication.merge_translations(document, translated)
        self.assertEqual(document['sections'][0]['paragraphs'][0]['translation_status'], 'draft')
        changed = publication.normalize_jats(xml.replace('0.89', '0.90'), '123', 'https://europepmc.org/articles/PMC123')
        publication.merge_translations(changed, document)
        self.assertEqual(changed['sections'][0]['paragraphs'][0]['translation_status'], 'source_changed')
        self.assertEqual(publication.classify_license('CC BY-NC-ND 4.0')['eligibility'], 'permission_required_nd')

if __name__ == '__main__': unittest.main()

