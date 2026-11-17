"""Independent DeepL translation for selected literature passages."""
import json
import urllib.request


def translate(key, segments, context='', target='ZH'):
    key = str(key or '').strip()
    if not key:
        raise ValueError('请填写独立翻译密钥')
    if target not in ('ZH', 'EN'):
        raise ValueError('请选择中译英或英译中')
    if not isinstance(segments, list) or not segments or len(segments) > 8:
        raise ValueError('请选择需要翻译的文字')
    texts = [str(item.get('text') or item.get('en') or '').strip() for item in segments]
    if any(not text for text in texts):
        raise ValueError('翻译文字不能为空')
    endpoint = 'https://api-free.deepl.com/v2/translate' if key.endswith(':fx') else 'https://api.deepl.com/v2/translate'
    payload = json.dumps({'text': texts, 'source_lang': 'EN' if target == 'ZH' else 'ZH',
                          'target_lang': target, 'context': str(context or '')[:8000]}).encode('utf-8')
    request = urllib.request.Request(endpoint, data=payload, headers={
        'Authorization': 'DeepL-Auth-Key ' + key, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            translated = json.load(response)['translations']
    except urllib.error.HTTPError as error:
        raise ValueError('翻译服务返回 HTTP ' + str(error.code)) from None
    if len(translated) != len(segments):
        raise ValueError('翻译结果与选段数量不一致')
    return {'segments': [{'id': str(item.get('id', i)), 'zh' if target == 'ZH' else 'en': result['text']}
                         for i, (item, result) in enumerate(zip(segments, translated))], 'provider': 'DeepL'}
