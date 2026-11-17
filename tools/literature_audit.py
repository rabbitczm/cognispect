"""Official bibliography comparison and evidence-linked article reading drafts."""
from __future__ import annotations

import html
import re
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def normalized(value):
    value = re.sub('<[^>]+>', '', html.unescape(str(value or '')))
    value = unicodedata.normalize('NFKD', value).casefold()
    return ''.join(c for c in value if c.isalnum() and not unicodedata.combining(c))


def compare_metadata(local, official):
    journal = official.get('journalInfo', {}).get('journal', {})
    candidates = [journal.get(x, '') for x in ('medlineAbbreviation', 'isoAbbreviation', 'title')]
    official_values = {
        'title': official.get('title', ''), 'authors': official.get('authorString', ''),
        'journal': next((x for x in candidates if normalized(x) == normalized(local.get('journal'))), next((x for x in candidates if x), '')),
        'publication_date': official.get('firstPublicationDate', ''), 'doi': official.get('doi', ''),
    }
    local_values = {'title': local.get('title', ''), 'authors': local.get('authors_full', local.get('authors', '')),
                    'journal': local.get('journal', ''), 'publication_date': local.get('firstdate', ''), 'doi': local.get('doi', '')}
    fields = {}
    for name, source in official_values.items():
        value = local_values[name]
        status = 'match' if normalized(value) == normalized(source) else 'conflict'
        if not value or not source:
            status = 'missing' if value != source or not source else 'match'
        fields[name] = {'local': value, 'official': source, 'status': status}
    return {'status': 'conflict' if any(f['status'] == 'conflict' for f in fields.values()) else 'verified', 'fields': fields}


def publication_notices(official):
    publications = official.get('pubTypeList', {}).get('pubType', [])
    corrections = official.get('commentCorrectionList', {})
    links = corrections.get('commentCorrection', [])
    types = [x.get('type', '').casefold() for x in links]
    replacements = [str(x['id']) for x in links if 'retract' in x.get('type', '').casefold() and 'republish' in x.get('type', '').casefold() and x.get('id')]
    all_types = [x.casefold() for x in publications] + types
    if replacements:
        status = 'retracted_and_republished'
    elif 'retracted publication' in all_types or 'retraction in' in types:
        status = 'retracted'
    elif any('expression of concern' in t for t in all_types):
        status = 'expression_of_concern'
    elif any('retraction of' in t for t in all_types):
        status = 'retraction_notice'
    elif any('errat' in t or 'correct' in t for t in all_types):
        status = 'correction_linked'
    else:
        status = 'no_retraction_or_correction_in_available_metadata'
    return {'source': 'Europe PMC core metadata publication types and comment/correction links',
            'publication_types': publications, 'comment_corrections': corrections,
            'retraction_or_correction_flag': status != 'no_retraction_or_correction_in_available_metadata',
            'status': status, 'replacement_pmids': replacements}


class AbstractParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.heading = 'Abstract'
        self.buffer = ''
        self.in_heading = False
        self.items = []

    def flush(self):
        text = re.sub(r'\s+', ' ', self.buffer).strip()
        if text:
            if self.in_heading:
                self.heading = text
            else:
                self.items.append((self.heading, text))
        self.buffer = ''

    def handle_starttag(self, tag, attrs):
        if tag in {'h2', 'h3', 'h4', 'p', 'br'}:
            self.flush()
        if tag in {'h2', 'h3', 'h4'}:
            self.in_heading = True

    def handle_endtag(self, tag):
        if tag in {'h2', 'h3', 'h4', 'p'}:
            self.flush()
        if tag in {'h2', 'h3', 'h4'}:
            self.in_heading = False

    def handle_data(self, data):
        self.buffer += data


def abstract_paragraphs(value, url):
    parser = AbstractParser()
    parser.feed(value or '')
    parser.flush()
    rows = []
    for n, (heading, text) in enumerate(parser.items, 1):
        # Unstructured abstracts still expose distinct, verbatim sentences.
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text) if heading == 'Abstract' else [text]
        for j, sentence in enumerate(sentences, 1):
            rows.append({'text': sentence, 'section': heading, 'paragraph': f'abstract-{n}-{j}', 'page': None, 'url': url, 'zone': 'abstract'})
    return rows


def build_guide(local, document=None, abstract=''):
    key = str(local.get('key') or local['pmid'])
    source = f'https://europepmc.org/article/MED/{key}'
    paragraphs = []
    if document:
        source = document.get('source_url') or source
        for section in document.get('sections', []):
            for p in section.get('paragraphs', []):
                text = p.get('en', '').strip()
                if text:
                    paragraphs.append({'text': text, 'section': section.get('title', ''),
                                       'paragraph': p.get('id', ''), 'page': None,
                                       'url': source + '#' + p.get('id', section.get('id', '')), 'zone': 'fulltext'})
    abstracts = abstract_paragraphs(abstract, f'https://europepmc.org/article/MED/{key}#abstract')
    basis = 'fulltext' if paragraphs else ('abstract' if abstracts else 'metadata')
    all_rows = paragraphs + abstracts
    specs = [
        ('question', '研究问题', r'introduction|background|objective|purpose|aim', r'\baim(?:ed|s)?\b|\bobjective\b|\bpurpose\b|\binvestigat(?:e|ed)\b|\bwe (?:sought|assess|evaluate)', '研究问题的原文依据'),
        ('methods', '研究方法', r'method|material|design|patient|cohort|data collection|experiment|implementation', r'\b(?:patients?|cohort|trained|training|retrospective|prospective|algorithm|randomized|systematic review)\b', '方法与研究设计的原文依据'),
        ('results', '主要结果', r'^results|finding|conclusion|performance|validation', r'\b(?:AUC|accuracy|sensitivity|specificity|hazard ratio|odds ratio|CI|p\s*[<=>]|achieved|yielded|demonstrat|found|find)\b', '结果的原文依据；数值与适用人群以引文为准'),
        ('figures', '图表阅读', '', '', '图表的原始标题与说明'),
        ('reproduction', '复现线索', r'code avail|data avail|software|reproduc|implementation|availability|accessibility', r'github\.com|gitlab\.com|zenodo|figshare|code (?:is|are|and)|data (?:is|are) available|pyradiomics|\bIBSI\b|\bComBat\b|\bPython\b|\bR version\b', '复现时可直接核对的数据、软件或实现线索'),
    ]
    sections = []
    for ident, title, heading_rx, content_rx, context in specs:
        selected = []
        if ident == 'figures' and document:
            for item in document.get('figures', []) + document.get('tables', []):
                caption = ' '.join(filter(None, (item.get('label'), item.get('caption'))))
                if caption:
                    selected.append({'text': caption, 'section': item.get('label') or 'Figure/Table',
                                     'paragraph': item.get('id', ''), 'page': None,
                                     'url': source + '#' + item.get('id', ''), 'zone': 'fulltext'})
            selected = selected[:3]
        elif ident != 'figures':
            ranked = []
            for position, row in enumerate(all_rows):
                heading_match = bool(re.search(heading_rx, row['section'], re.I))
                content_match = bool(re.search(content_rx, row['text'], re.I))
                # Resource claims require explicit resource text even in broad Methods sections.
                if ident == 'reproduction' and not (content_match or heading_match):
                    continue
                if heading_match or content_match:
                    score = (4 if heading_match else 0) + (2 if content_match else 0) + (1 if row['zone'] == 'fulltext' else 0)
                    ranked.append((-score, position, row))
            selected = [row for _, _, row in sorted(ranked)[:2]]
            if not selected and ident == 'question' and abstracts:
                selected = abstracts[:1]
        if selected:
            rendered = '\n\n'.join(f'【{e["section"]} · {e["paragraph"]}】{e["text"]}' for e in selected)
            text = f'《{local.get("title", "")}》：{context}。\n\n{rendered}'
        else:
            missing = {'question': '研究问题段落', 'methods': '研究设计或方法段落', 'results': '明确结果段落', 'figures': '图表与图注', 'reproduction': '数据、代码或参数的明确可用性说明'}[ident]
            text = f'《{local.get("title", "")}》当前取得的{("全文" if basis == "fulltext" else "摘要" if basis == "abstract" else "元数据")}证据中，尚未提取到{missing}；本节待补充原文依据。'
        sections.append({'id': ident, 'title': title, 'text': text, 'status': 'draft' if selected else 'pending', 'evidence': selected})
    return {'schema_version': 1, 'id': key, 'key': key, 'title': local.get('title', ''),
            'basis': basis, 'status': 'draft' if all_rows else 'pending', 'review_status': 'not_reviewed',
            'generation_method': 'extractive_source_linked_draft', 'language': 'zh-context-with-source-excerpts',
            'generated_at': utc_now(), 'source_url': source, 'sections': sections}
