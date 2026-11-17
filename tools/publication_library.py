"""Frozen publication sources and source-paired reading documents."""
from __future__ import annotations
import re
import xml.etree.ElementTree as ET
from copy import deepcopy

XLINK = '{http://www.w3.org/1999/xlink}href'

def plain(node):
    return re.sub(r'\s+', ' ', ''.join(node.itertext())).strip() if node is not None else ''

def classify_license(value, urls=None):
    text = re.sub(r'[-_\s]+', ' ', value.lower())
    joined = text + ' ' + ' '.join(urls or []).lower()
    if '/by-nc-nd/' in joined or '/by-nd/' in joined or re.search(r'\bnd\b', text):
        eligibility = 'permission_required_nd'
    elif any(x in joined for x in ('/by-nc/', '/by-nc-sa/')) or re.search(r'\bnc\b', text):
        eligibility = 'eligible_noncommercial' if ('cc' in text or 'creative' in text or 'creativecommons.org' in joined) else 'license_unknown'
    elif ('creativecommons.org/licenses/by/' in joined or 'creativecommons.org/licenses/by-sa/' in joined or re.search(r'\bcc by\b', text) or 'cc0' in text or 'creativecommons.org/publicdomain/zero/' in joined):
        eligibility = 'eligible'
    else:
        eligibility = 'license_unknown'
    return {'text': value, 'urls': urls or [], 'eligibility': eligibility,
            'share_alike': '/by-sa/' in joined or '/by-nc-sa/' in joined or bool(re.search(r'\bsa\b', text))}

def normalize_jats(xml, key, source_url):
    root = ET.fromstring(xml)
    meta = root.find('./front/article-meta')
    license_nodes = meta.findall('./permissions/license') if meta is not None else []
    license_text = ' '.join(plain(x) for x in license_nodes)
    urls = list(dict.fromkeys(x.get(XLINK) for n in license_nodes for x in n.iter() if x.get(XLINK)))
    license_info = classify_license(license_text, urls)
    notices=[plain(p) for p in root.findall('./back//p') if re.search(r'(this article|this work) is (published|distributed|licensed).*?(creative commons|CC BY)',plain(p),re.I)]
    if notices:
        license_info['additional_notices']=notices
        notice_classes={classify_license(notice)['eligibility'] for notice in notices}
        notice_classes.discard('license_unknown')
        if notice_classes and notice_classes!={license_info['eligibility']}:
            license_info['conflicting_permissions']=True
            license_info['eligibility']='license_conflict'
    document = {'key': key, 'body_available': root.find('body') is not None, 'title': plain(root.find('./front/article-meta/title-group/article-title')),
                'source_url': source_url, 'license': license_info,
                'authors': [' '.join(filter(None,(plain(n.find('name/given-names')),plain(n.find('name/surname'))))) or plain(n.find('collab')) for n in root.findall('./front/article-meta/contrib-group/contrib') if n.get('contrib-type','author')=='author'],
                'copyright': {'statement': plain(root.find('./front/article-meta/permissions/copyright-statement')), 'year': plain(root.find('./front/article-meta/permissions/copyright-year')), 'holder': plain(root.find('./front/article-meta/permissions/copyright-holder'))},
                'source_version': {'article_version': plain(root.find('./front/article-meta/article-version')), 'publication_dates': [{'type': n.get('pub-type', n.get('date-type','')), 'year': plain(n.find('year')), 'month': plain(n.find('month')), 'day': plain(n.find('day'))} for n in root.findall('./front/article-meta/pub-date')]}, 'sections': [], 'tables': [], 'figures': [], 'formulas': [], 'references': [],
                'translation_status': 'missing', 'review_status': 'not_reviewed', 'publication_status': 'draft', 'public': False}
    parents = {child: parent for parent in root.iter() for child in parent}
    def section_of(node):
        while node in parents:
            node = parents[node]
            if node.tag == 'sec': return node
        return None
    excluded = {'table-wrap','fig','ref-list','disp-formula','supplementary-material'}
    def excluded_parent(node, stop):
        while node in parents and node is not stop:
            node = parents[node]
            if node.tag in excluded: return True
        return False
    containers = []
    for zone in ('body','back'):
        zone_node = root.find(zone)
        if zone_node is not None:
            containers.append((zone_node, zone.title()))
            containers.extend((s, plain(s.find('title')) or 'Section') for s in zone_node.iter('sec'))
    for index,(node,title) in enumerate(containers):
        sec_id = node.get('id') or f'section-{index+1}'
        paras=[]
        for p in node.iter('p'):
            if excluded_parent(p,node): continue
            owner=section_of(p)
            if (node.tag=='sec' and owner is not node) or (node.tag!='sec' and owner is not None):continue
            clone=deepcopy(p)
            for parent in list(clone.iter()):
                for child in list(parent):
                    if child.tag in excluded:
                        position=list(parent).index(child);tail=child.tail or ''
                        if position:parent[position-1].tail=(parent[position-1].tail or '')+tail
                        else:parent.text=(parent.text or '')+tail
                        parent.remove(child)
            value=plain(clone)
            if value: paras.append({'id':p.get('id') or f'{sec_id}-p{len(paras)+1}', 'reference_ids':[x.get('rid') for x in p.findall('.//xref') if x.get('rid')], 'en':value,'zh':'','translation_status':'missing','review_status':'not_reviewed'})
        if paras or node.tag=='sec':document['sections'].append({'id':sec_id,'title':title,'title_zh':'','paragraphs':paras})
    for i,node in enumerate(root.findall('.//table-wrap')):
        rows=[[plain(cell) for cell in row if cell.tag in {'td','th'}] for row in node.findall('.//tr')]
        document['tables'].append({'id':node.get('id') or f'table-{i+1}','label':plain(node.find('label')),'caption':plain(node.find('caption')),'caption_zh':'','rows':rows,'footnotes':plain(node.find('table-wrap-foot')),'translation_status':'missing','xml':ET.tostring(node,encoding='unicode')})
    for i,node in enumerate(root.findall('.//fig')):
        document['figures'].append({'id':node.get('id') or f'figure-{i+1}','label':plain(node.find('label')),'caption':plain(node.find('caption')),'caption_zh':'','graphics':[g.get(XLINK,'') for g in node.findall('.//graphic')],'translation_status':'missing'})
    for i,node in enumerate(root.findall('.//disp-formula')):
        document['formulas'].append({'id':node.get('id') or f'formula-{i+1}','text':plain(node),'xml':ET.tostring(node,encoding='unicode')})
    for i,node in enumerate(root.findall('.//ref-list/ref')):
        document['references'].append({'id':node.get('id') or f'ref-{i+1}','text':plain(node),'doi':[plain(x) for x in node.findall('.//pub-id') if x.get('pub-id-type')=='doi']})
    return document

def merge_translations(document, previous):
    if previous.get('title')==document.get('title') and previous.get('title_zh'):
        document['title_zh']=previous['title_zh']
    old_sections={s['id']:s for s in previous.get('sections',[])}
    for section in document['sections']:
        prior=old_sections.get(section['id'],{})
        if prior.get('title')==section['title'] and prior.get('title_zh'):section['title_zh']=prior['title_zh']
    old = {p['id']: p for s in previous.get('sections',[]) for p in s['paragraphs']}
    for sec in document['sections']:
        for p in sec['paragraphs']:
            prior=old.get(p['id'])
            if prior and prior.get('zh'):
                p['zh']=prior['zh']
                p['translation_status']=prior.get('translation_status','draft') if prior.get('en')==p['en'] else 'source_changed'
                p['review_status']=prior.get('review_status','not_reviewed') if prior.get('en')==p['en'] else 'not_reviewed'
    for name in ('tables','figures'):
        old_items={x['id']:x for x in previous.get(name,[])}
        for item in document[name]:
            prior=old_items.get(item['id'])
            if prior and prior.get('caption')==item.get('caption') and prior.get('rows')==item.get('rows') and prior.get('footnotes')==item.get('footnotes'):
                for field in ('caption_zh','rows_zh','footnotes_zh','translation_status','review_status'):
                    if field in prior:item[field]=deepcopy(prior[field])
    old_paragraphs=[p['en'] for section in previous.get('sections',[]) for p in section['paragraphs']]
    new_paragraphs=[p['en'] for section in document['sections'] for p in section['paragraphs']]
    old_captions=[(item.get('caption'),item.get('rows'),item.get('footnotes')) for name in ('tables','figures') for item in previous.get(name,[])]
    new_captions=[(item.get('caption'),item.get('rows'),item.get('footnotes')) for name in ('tables','figures') for item in document[name]]
    if old_paragraphs==new_paragraphs and old_captions==new_captions:
        for field in ('review','review_status','translation_status'):
            if field in previous:document[field]=deepcopy(previous[field])
    return document
