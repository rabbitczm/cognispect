"""知镜 authenticated multi-user website and research API."""
from __future__ import annotations
import ipaddress
import http.client
import json
import mimetypes
from pathlib import Path
import re
import socket
import ssl
import shutil
import threading
from urllib.parse import unquote, urlsplit
import urllib.request

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

try:
    from .web_config import WebConfig, ROOT
    from .web_mail import SMTPMailer
    from .web_store import WebStore, WorkspaceConflict
    from .admin_store import AdminStore
    from .pdf_library import PdfLibrary, open_pdf, official_record
    from .translation_service import translate
    from .research_store import ResearchStore
    from .web_protection import RequestLimits
    from .site_store import SiteStore
except ImportError:
    from web_config import WebConfig, ROOT
    from web_mail import SMTPMailer
    from web_store import WebStore, WorkspaceConflict
    from admin_store import AdminStore
    from pdf_library import PdfLibrary, open_pdf, official_record
    from translation_service import translate
    from research_store import ResearchStore
    from web_protection import RequestLimits
    from site_store import SiteStore

WORKSPACE_KEYS = {'helix.notes.v9', 'helix.reviews.v16', 'helix.review.v12', 'helix.review.active.v16',
                  'helix.clips.v2', 'helix.clip.v1', 'helix.api.v14', 'helix.api.profiles.v17',
                  'helix.stats.draft.v17', 'helix.stats.result.v17', 'helix.math.draft.v17',
                  'helix.analysis.templates.v18', 'helix.medical.draft.v18', 'helix.pk.fit.v18'}
PLOT_LOCK = threading.Lock()


def research_api():
    try:
        from . import research_api as api
    except ImportError:
        import research_api as api
    return api


def public_addresses(config):
    address = str(config.get('url', '')).strip()
    parsed = urlsplit(address)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('网站模型地址必须为公网 HTTPS 地址，不能包含凭据或查询参数')
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise ValueError('无法解析模型服务域名') from None
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('网站不能连接本机或私有网络中的模型地址')
    return parsed, list(dict.fromkeys(item[4][0] for item in addresses))


def pinned_model_opener(config):
    parsed, addresses = public_addresses(config)
    context = ssl.create_default_context()
    class PinnedConnection(http.client.HTTPSConnection):
        def connect(self):
            last_error = None
            for address in addresses:
                connection = None
                try:
                    connection = socket.create_connection((address, self.port), self.timeout, self.source_address)
                    self.sock = context.wrap_socket(connection, server_hostname=parsed.hostname)
                    return
                except OSError as error:
                    if connection is not None:
                        connection.close()
                    last_error = error
            raise last_error
    class PinnedHandler(urllib.request.HTTPSHandler):
        def https_open(self, request):
            if urlsplit(request.full_url).hostname != parsed.hostname:
                raise ValueError('模型请求不能跳转到其他地址')
            return self.do_open(PinnedConnection, request)
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), research_api().NoRedirect(), PinnedHandler())


def workspace_data(data):
    if not isinstance(data, dict):
        raise ValueError('工作区数据必须为对象')
    def contains_secret(value):
        if isinstance(value, dict):
            return any((str(k).lower() in {'key', 'apikey', 'api_key', 'fallbackkey', 'password', 'secret', 'token'} and bool(v)) or contains_secret(v) for k, v in value.items())
        return isinstance(value, list) and any(contains_secret(v) for v in value)
    for key, raw in data.items():
        if key not in WORKSPACE_KEYS and not key.startswith('helix.translation.'):
            raise ValueError('工作区包含不支持的数据项')
        if not isinstance(raw, str):
            raise ValueError('工作区值应为浏览器原始存储字符串')
        if key.startswith('helix.api.') and contains_secret(json.loads(raw)):
            raise ValueError('API 密钥只能保存在当前登录会话中')
    return data


def create_app(data_dir=None, public_url=None, mailer=None):
    config = WebConfig(data_dir, public_url)
    admin = AdminStore(config.data_dir / 'admin')
    store = WebStore(config.data_dir)
    research = ResearchStore(config.data_dir / 'research', ROOT)
    site = SiteStore(config.data_dir / 'site')
    limits = RequestLimits()
    computation = threading.BoundedSemaphore(config.compute_concurrency)
    mail = mailer if mailer is not None else SMTPMailer(config.smtp)
    application = FastAPI(title='知镜', docs_url=None, redoc_url=None, openapi_url=None)
    application.state.store = store
    application.state.config = config
    application.state.research = research
    application.state.site = site
    application.state.mailer = mail
    application.state.translation_keys = {}

    def smtp_configured():
        return bool(getattr(mail, 'configured', True))

    def token(request):
        return request.cookies.get('helix_session', '')

    def user(request, roles=None):
        identity = store.identity(token(request))
        if not identity:
            raise HTTPException(401, '请登录知镜账号')
        if roles and identity['role'] not in roles and identity['role'] != 'owner':
            raise HTTPException(403, '当前账号没有此操作权限')
        return identity

    def session(request, identity=None):
        identity = identity or store.identity(token(request))
        return {'authenticated': bool(identity), 'user': {key: identity[key] for key in ('id', 'email', 'role')} if identity else None,
                'smtp_configured': smtp_configured()}

    def preview(request):
        identity=store.identity(token(request))
        return bool(identity and identity['role']=='owner' and request.query_params.get('preview')=='1')

    def content_allowed(request,kind,key):
        if not preview(request) and not site.visible(kind,key):
            raise HTTPException(404,'该内容暂未公开')

    def editorial_allowed(identity,kind,key):
        if identity['role']!='owner' and not site.visible(kind,key):raise HTTPException(404,'该内容暂未公开')

    @application.get('/api/site')
    def public_site(request: Request):
        return site.state()['draft' if preview(request) else 'published']

    @application.get('/api/admin/site')
    def site_state(request: Request):
        user(request,{'owner'})
        return site.state()

    @application.put('/api/admin/site')
    def save_site(data: dict,request: Request):
        user(request,{'owner'})
        return site.save(data.get('settings',{}))

    @application.post('/api/admin/site/publish')
    def publish_site(request: Request):
        user(request,{'owner'})
        return site.publish()

    @application.post('/api/admin/site/restore')
    def restore_site(request: Request):
        user(request,{'owner'})
        return site.restore()

    @application.post('/api/admin/visibility')
    def visibility(data: dict,request: Request):
        user(request,{'owner'})
        site.set_visibility(data.get('kind'),data.get('key'),bool(data.get('visible')))
        return {'saved':True}

    @application.get('/api/admin/owner')
    def owner_info(request: Request):
        user(request,{'owner'})
        users=store.users()
        return {'admin_limit':site.state()['published']['admin_limit'],'admin_count':sum(r['role']=='admin' and r['active'] for r in users),'users':users}

    @application.post('/api/admin/owner')
    def owner_limit(data: dict,request: Request):
        user(request,{'owner'})
        site.set_limit(data.get('admin_limit'))
        return owner_info(request)

    @application.get('/api/admin/usage')
    def usage(request: Request):
        user(request,{'owner'})
        accounts=store.users()
        files=list((config.data_dir/'users').rglob('*.pdf')) if (config.data_dir/'users').exists() else []
        return {'runtime':'local','users':len(accounts),'pdfs':len(files),'submissions':len(research.submissions()),'storage_bytes':sum(p.stat().st_size for p in files),'storage_scope':'本地个人 PDF','limits':{},'errors':[]}

    def pdfs(identity):
        return PdfLibrary(store.user_directory(identity['id']) / 'pdfs')

    def send_link(email, purpose, value):
        action = 'verify' if purpose == 'verify' else 'reset-password'
        label = '验证邮箱' if purpose == 'verify' else '重置密码'
        mail({'to': email, 'subject': '知镜 · ' + label,
              'text': f'请打开下面的链接{label}：\n{config.public_url}/?action={action}&token={value}\n'})

    @application.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({'error': error.detail}, status_code=error.status_code)

    @application.exception_handler(ValueError)
    async def value_error(request, error):
        return JSONResponse({'error': str(error)}, status_code=400)

    @application.exception_handler(ImportError)
    async def dependency_error(request, error):
        return JSONResponse({'error': '服务运行依赖尚未配置，请联系管理员'}, status_code=503)

    @application.exception_handler(Exception)
    async def service_error(request, error):
        return JSONResponse({'error': f'请求未完成（{type(error).__name__}），请稍后重试'}, status_code=502)

    @application.middleware('http')
    async def origin_and_cache(request, call_next):
        path=request.url.path
        module=next((key for prefix,key in [('/api/stats','stats'),('/api/model-fit','math'),('/api/answer','assist'),('/api/pdf','pdf'),('/api/publications','reader'),('/api/public/submissions','papers'),('/api/submissions','papers'),('/assets/anatomy/','anatomy')] if path.startswith(prefix)),None)
        if module and not site.visible('module',module) and not preview(request):
            return JSONResponse({'error':'该功能暂未公开'},status_code=404)
        host = request.headers.get('host', '').lower()
        local_host = urlsplit('http://' + host).hostname in {'localhost', '127.0.0.1', '::1'}
        if host != urlsplit(config.public_url).netloc.lower() and not local_host:
            return JSONResponse({'error': '网站域名与 PUBLIC_URL 配置不一致'}, status_code=403)
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            origin = request.headers.get('origin')
            if origin and origin.rstrip('/') != config.public_url:
                return JSONResponse({'error': '跨站请求未被接受'}, status_code=403)
            size = config.max_upload_bytes if request.url.path == '/api/pdf/upload' else 3 * 1024 * 1024
            if int(request.headers.get('content-length', '0')) > size:
                return JSONResponse({'error': '文件或请求超过大小限制'}, status_code=413)
            if request.url.path != '/api/pdf/upload':
                chunks=[]
                total=0
                async for chunk in request.stream():
                    total+=len(chunk)
                    if total>size:
                        return JSONResponse({'error':'请求超过大小限制'},status_code=413)
                    chunks.append(chunk)
                request._body=b''.join(chunks)
            path = request.url.path
            category = ('login' if path.endswith('/login') else 'mail' if path in {'/api/auth/register','/api/auth/forgot-password'}
                        else 'upload' if path == '/api/pdf/upload' else 'compute' if path in {'/api/stats','/api/model-fit','/api/answer','/api/pdf/fetch'} else None)
            count = {'login':20,'mail':6,'upload':15,'compute':30}.get(category)
            client = request.client.host if request.client else 'local'
            if config.rate_limit_enabled and count and not limits.allow((client,category),count):
                return JSONResponse({'error':'操作较频繁，请稍后再试'}, status_code=429, headers={'Retry-After':'60'})
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        if request.url.path.startswith('/api/') or request.url.path.startswith('/exports/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @application.get('/api/health')
    def health():
        return {'service': 'helix-web', 'version': '19.0'}

    @application.get('/api/auth/session')
    def auth_session(request: Request):
        return session(request)

    @application.get('/api/admin/session')
    def admin_session(request: Request):
        identity = store.identity(token(request))
        allowed = identity and identity['role'] in {'owner', 'admin', 'editor'}
        return {'configured': any(row['role'] in {'owner','admin'} for row in store.users()), 'authenticated': bool(allowed),
                'username': identity['email'] if allowed else None, 'role': identity['role'] if allowed else None}

    @application.post('/api/auth/register')
    def register(data: dict, request: Request):
        invite = str(data.get('invite', '')).strip()
        if invite:
            identity = store.register_invited(str(data.get('email', '')), str(data.get('password', '')), invite)
            value, identity = store.login(identity['email'], str(data.get('password', '')))
            response = JSONResponse({**session(request, identity), 'username': identity['email'], 'role': identity['role']})
            response.set_cookie('helix_session', value, httponly=True, secure=config.secure, samesite='strict', path='/')
            return response
        if not smtp_configured():
            raise HTTPException(503, '网站邮件服务尚未配置，暂不能注册；请联系管理员')
        value = store.register(str(data.get('email', '')), str(data.get('password', '')))
        try:
            send_link(str(data['email']).strip().lower(), 'verify', value)
        except Exception:
            raise HTTPException(503, '验证邮件未能发出，请稍后重新注册') from None
        return {'sent': True, 'message': '验证邮件已发送，请检查邮箱'}

    @application.post('/api/auth/verify')
    def verify(data: dict):
        store.consume_token(str(data.get('token', '')), 'verify')
        return {'verified': True}

    @application.post('/api/auth/login')
    @application.post('/api/admin/login')
    def login(data: dict, request: Request):
        value, identity = store.login(str(data.get('email') or data.get('username') or ''), str(data.get('password', '')), bool(data.get('remember')))
        if request.url.path.startswith('/api/admin/') and identity['role'] not in {'owner', 'admin', 'editor'}:
            store.logout(value)
            raise HTTPException(403, '请使用管理人员账号')
        response = JSONResponse({**session(request, identity), 'username': identity['email'], 'role': identity['role']})
        response.set_cookie('helix_session', value, httponly=True, secure=config.secure, samesite='strict', path='/',
                            max_age=604800 if data.get('remember') else None)
        return response

    @application.post('/api/auth/logout')
    @application.post('/api/admin/logout')
    def logout(request: Request):
        value = token(request)
        store.logout(value)
        application.state.translation_keys.pop(value, None)
        response = JSONResponse({'authenticated': False})
        response.delete_cookie('helix_session', path='/', secure=config.secure, httponly=True, samesite='strict')
        return response

    @application.post('/api/auth/forgot-password')
    def forgot_password(data: dict):
        if not smtp_configured():
            raise HTTPException(503, '邮件服务尚未配置，请联系管理员')
        email = str(data.get('email', '')).strip().lower()
        identity = store.find(email)
        if identity and identity['active'] and identity['verified']:
            try:
                send_link(email, 'reset', store.issue_token(identity['id'], 'reset'))
            except Exception:
                raise HTTPException(503, '重置邮件暂未发送，请稍后重试') from None
        return {'sent': True, 'message': '如果邮箱已注册，重置链接将发送到该邮箱'}

    @application.post('/api/auth/reset-password')
    def reset_password(data: dict):
        store.consume_token(str(data.get('token', '')), 'reset', str(data.get('password', '')))
        return {'reset': True}

    @application.get('/api/workspace')
    def get_workspace(request: Request):
        return store.workspace(user(request)['id'])

    @application.put('/api/workspace')
    def put_workspace(data: dict, request: Request):
        identity = user(request)
        if data.get('user_id') != identity['id']:
            return JSONResponse({'code': 'ACCOUNT_CHANGED', 'error': '登录账号已切换，请刷新当前页面后继续'}, status_code=409)
        try:
            return store.save_workspace(identity['id'], data.get('revision'), workspace_data(data.get('data')))
        except WorkspaceConflict as conflict:
            return JSONResponse({'error': '工作区已在其他页面更新，请选择保留的版本', **conflict.workspace}, status_code=409)

    @application.get('/api/catalog')
    def catalog(request: Request):
        catalog = admin.catalog()
        audit_file = ROOT / 'data/literature-audit/index.json'
        if audit_file.is_file():
            by_key = {row['key']:row for row in json.loads(audit_file.read_text(encoding='utf-8')).get('records',[])}
            for article in catalog['upserts']:
                row = by_key.get(str(article.get('pmid') or article.get('key')))
                if row:
                    article['audit_status'] = row['status']
                    article['publication_notice'] = row.get('notices',{}).get('status')
                    article['publisher_url'] = row.get('publisher_url')
        for item in research.submissions(public=True):
            article = item['article']
            catalog['upserts'].append({**article,'key':'submission-'+item['id'], 'topics':article.get('topics',[]), 'submission_id':item['id'], 'authors':article.get('authors',''), 'year':article.get('year','')})
        if not preview(request):
            catalog['upserts']=[r for r in catalog['upserts'] if site.visible('article',r['key']) and (not r.get('submission_id') or site.visible('submission',r['submission_id']))]
            catalog['removed']+= [r['key'] for r in site.state()['visibility'] if r['kind']=='article' and not r['visible']]
        return catalog

    @application.get('/api/library')
    def library(request: Request):
        docs=json.loads((ROOT/'_lib/lib.json').read_text(encoding='utf-8'))['docs']
        content=json.loads((ROOT/'data/reader-content.json').read_text(encoding='utf-8'))
        changes=catalog(request)
        by_key={d['key']:d for d in docs}
        for r in changes['upserts']:
            by_key[r['key']]={**by_key.get(r['key'],{}),**r}
            if r.get('abstract'):content['abstracts'][r['key']]=r['abstract']
            if r.get('zh'):content['translations'][r['key']]=r['zh']
        removed=set(changes['removed'])
        docs=[d for d in by_key.values() if d['key'] not in removed and (preview(request) or site.visible('article',d['key']))]
        allowed={d['key'] for d in docs}
        audits=json.loads((ROOT/'data/literature-audit/index.json').read_text(encoding='utf-8'))['records']
        verify={r['key']:{'source':'Europe PMC','checked_on':r.get('checked_at','')} for r in audits if r['key'] in allowed}
        audit_map={r['key']:r for r in audits}
        for d in docs:
            a=audit_map.get(d['key'],{})
            d.update(audit_status=a.get('metadata_status'),doi_status=a.get('doi_status'),publisher_url=a.get('publisher_url'),publication_notice=a.get('notices',{}).get('status'),article_notices=a.get('notices'))
        focus=json.loads((ROOT/'_lib/focus.json').read_text(encoding='utf-8'))
        focus={k:v for k,v in focus.items() if str(v.get('pmid') or v.get('key')) in allowed}
        return {'docs':docs,'abstracts':{k:v for k,v in content['abstracts'].items() if k in allowed},
                'translations':{k:v for k,v in content['translations'].items() if k in allowed},
                'translation_sources':{k:v for k,v in content['translation_sources'].items() if k in allowed},
                'focus':focus,'verify':verify,'sources':json.loads((ROOT/'data/science-sources.json').read_text(encoding='utf-8'))['sources']}

    def publication_document(key):
        directory = ROOT / 'data/publication/documents'
        file = (directory / (key + '.json')).resolve()
        if file.parent != directory.resolve() or not file.is_file():
            raise HTTPException(404, '该文献暂无已发布的全文')
        return json.loads(file.read_text(encoding='utf-8'))

    @application.get('/api/publications/{key}')
    def publication(key: str, request: Request):
        content_allowed(request,'article',key)
        document = publication_document(key)
        if document.get('public') is not True or document.get('publication_status') != 'published' or document.get('license', {}).get('eligibility') not in {'eligible', 'eligible_noncommercial'}:
            raise HTTPException(404, '该文献暂无已发布的全文')
        return document

    @application.get('/api/literature-audit/{key}')
    def audit_record(key: str, request: Request):
        content_allowed(request,'article',key)
        if not re.fullmatch(r'\d{1,12}',key):
            raise HTTPException(404,'核查记录不存在')
        file=ROOT/'data/literature-audit/records'/(key+'.json')
        if not file.is_file():
            raise HTTPException(404,'核查记录不存在')
        return json.loads(file.read_text(encoding='utf-8'))

    @application.get('/api/admin/publications')
    def publication_inventory(request: Request):
        user(request, {'admin'})
        manifest = json.loads((ROOT / 'data/publication/manifest.json').read_text(encoding='utf-8'))
        fields = ('key', 'title', 'title_zh', 'date_status', 'publication_date', 'source_url',
                  'fulltext_status', 'license', 'fulltext_review_status', 'fulltext_translation_status',
                  'body_paragraph_count', 'body_word_count', 'translated_paragraph_count',
                  'table_count', 'figure_count', 'formula_count', 'reference_count')
        return {'summary': manifest['summary'], 'records': [{key: row[key] for key in fields if key in row} for row in manifest['records']]}

    @application.get('/api/admin/publications/{key}')
    def publication_preview(key: str, request: Request):
        user(request, {'admin'})
        return publication_document(key)

    @application.get('/api/admin/users')
    def users(request: Request):
        user(request, {'admin'})
        return {'users': [{**row, 'username': row['email'], 'active': bool(row['active'])} for row in store.users()]}

    @application.get('/api/admin/invites')
    def invites(request: Request):
        user(request, {'admin'})
        return {'invites': store.invites()}

    @application.post('/api/admin/invites')
    def create_invite(data: dict, request: Request):
        identity = user(request, {'admin'})
        uses = int(data.get('uses', 10))
        days = int(data.get('days', 14))
        if not 1 <= uses <= 200 or not 1 <= days <= 90:
            raise ValueError('名额需为 1–200，邀请码有效期需为 1–90 天')
        invite = store.create_invite(identity['email'], uses, days)
        invite['url'] = config.public_url + '/?invite=' + invite['code']
        return invite

    @application.post('/api/admin/users/{operation}')
    def save_user(operation: str, data: dict, request: Request):
        identity = user(request, {'owner'})
        email = str(data.get('username') or data.get('email') or '').strip().lower()
        target=store.find(email)
        if target and target['role']=='owner':
            raise HTTPException(403,'站主身份不能通过人员管理修改')
        if data.get('role')=='owner':
            raise HTTPException(403,'网站仅有一位站主')
        if operation!='remove' and data.get('role')=='admin' and data.get('active',True) and not (target and target['role']=='admin' and target['active']):
            count=sum(r['role']=='admin' and r['active'] for r in store.users())
            maximum=site.state()['published']['admin_limit']
            if maximum is not None and count>=maximum:raise HTTPException(409,'管理员名额已满，请先调整名额或撤销其他管理员')
        if operation == 'remove':
            store.remove_user(email)
        else:
            store.create_staff(email, str(data.get('password', '')), data.get('role', 'editor'), bool(data.get('active', True)))
        return {'saved': True}

    @application.get('/api/admin/ledger')
    @application.get('/data/audit-v9.json')
    def ledger(request: Request):
        identity=user(request, {'admin', 'editor'})
        result=admin.ledger(ROOT)
        if identity['role']!='owner':result['records']=[r for r in result['records'] if site.visible('article',r['key'])]
        return result

    @application.post('/api/admin/review')
    def review(data: dict, request: Request):
        identity = user(request, {'admin', 'editor'})
        editorial_allowed(identity,'article',str(data.get('key','')))
        admin.save_review(str(data.get('key', '')), str(data.get('status', '')), str(data.get('note', '')), identity['email'])
        return {'saved': True}

    @application.post('/api/admin/article/{operation}')
    def article(operation: str, data: dict, request: Request):
        identity = user(request, {'admin', 'editor'})
        editorial_allowed(identity,'article',str(data.get('key','')))
        if operation == 'remove':
            admin.remove_article(str(data.get('key', '')), identity['email'])
            return {'removed': True}
        if operation == 'get':
            return {'article': admin.article(str(data.get('key', '')), ROOT)}
        if operation == 'lookup':
            record, address = official_record(data.get('identifier', ''))
            return {'record': record, 'source_url': address}
        return {'article': admin.save_article(data, identity['email'])}

    @application.post('/api/admin/translation')
    def translation_key(data: dict, request: Request):
        user(request, {'admin'})
        value = str(data.get('key', '')).strip()
        if value:
            application.state.translation_keys[token(request)] = value
        else:
            application.state.translation_keys.pop(token(request), None)
        return {'configured': bool(value), 'provider': 'DeepL'}

    @application.get('/api/translation/status')
    def translation_status(request: Request):
        user(request)
        return {'configured': bool(application.state.translation_keys.get(token(request))), 'provider': 'DeepL'}

    @application.post('/api/translation')
    def translation(data: dict, request: Request):
        user(request)
        return translate(data.get('key') or application.state.translation_keys.get(token(request)), data.get('segments', []), data.get('context', ''), data.get('target', 'ZH'))

    @application.get('/api/pdfs')
    def pdf_list(request: Request):
        return {'documents': pdfs(user(request)).list()}

    def pdf_file(identity, key):
        if not re.fullmatch(r'[a-f0-9]{24}', key):
            raise HTTPException(404, 'PDF 不存在')
        library = pdfs(identity)
        if not library.file(key).exists():
            raise HTTPException(404, 'PDF 不存在')
        return library

    @application.get('/api/pdf/document/{key}')
    def pdf_document(key: str, request: Request):
        return pdf_file(user(request), key).get(key)

    @application.get('/api/pdf/file/{key}')
    def pdf_download(key: str, request: Request):
        library = pdf_file(user(request), key)
        return FileResponse(library.file(key), media_type='application/pdf')

    @application.post('/api/pdf/upload')
    async def pdf_upload(request: Request):
        identity = user(request)
        chunks = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > config.max_upload_bytes:
                raise HTTPException(413, 'PDF 超过上传大小限制')
            chunks.append(chunk)
        if not computation.acquire(blocking=False):
            raise HTTPException(429, '当前正在处理其他文件，请稍后重试')
        try:
            return await run_in_threadpool(pdfs(identity).add, b''.join(chunks), unquote(request.headers.get('X-Filename', 'document.pdf')))
        finally:
            computation.release()

    @application.post('/api/pdf/fetch')
    def pdf_fetch(data: dict, request: Request):
        return open_pdf(pdfs(user(request)), str(data.get('pmid', '')))

    @application.post('/api/pdf/remove')
    def pdf_remove(data: dict, request: Request):
        pdfs(user(request)).remove(str(data.get('id', '')))
        return {'removed': True}

    @application.post('/api/models')
    def models(data: dict, request: Request):
        user(request)
        model = data.get('config', {})
        return {'models': research_api().model_list(model, opener=pinned_model_opener(model))}

    @application.post('/api/model-test')
    def model_test(data: dict, request: Request):
        user(request)
        model = data.get('config', {})
        return research_api().model_complete(model, '请只回复：知镜接口连接成功。', max_tokens=80, opener=pinned_model_opener(model))

    @application.post('/api/answer')
    def answer(data: dict, request: Request):
        user(request)
        configs = [data.get('config', {})]
        if data.get('use_fallback') and data.get('fallback'):
            configs.append(data['fallback'])
        def stream():
            def emit(item):
                return 'data: ' + json.dumps(item, ensure_ascii=False) + '\n\n'
            for index, model in enumerate(configs):
                sent = False
                try:
                    opener = pinned_model_opener(model)
                    yield emit({'provider': str(model.get('model', '')), 'attempt': index + 1})
                    for chunk in research_api().model_stream(model, str(data.get('prompt', '')), opener=opener):
                        sent = True
                        yield emit({'delta': chunk})
                    if not sent:
                        raise ValueError('模型未返回可见回答文本')
                    yield emit({'done': True, 'model': model.get('model', ''), 'fallback_used': index > 0})
                    return
                except Exception as error:
                    message = str(error) if isinstance(error, ValueError) else f'模型请求失败（{type(error).__name__}）'
                    if sent or index == len(configs) - 1:
                        yield emit({'error': message})
                        return
                    yield emit({'notice': '主接口未返回答案，正尝试已启用的备用 API。'})
        return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})

    @application.post('/api/search')
    def search(data: dict, request: Request):
        user(request)
        return research_api().public_search(data.get('groups', []))

    @application.post('/api/stats')
    def statistics(data: dict, request: Request):
        identity = user(request)
        if data.get('mode') in {'paired','longitudinal','survival'}:
            from .medical_analysis import analyze_medical
            if not computation.acquire(blocking=False):
                raise HTTPException(429, '分析任务较多，请稍后重试')
            try:
                return analyze_medical(data)
            finally:
                computation.release()
        if not computation.acquire(blocking=False):
            raise HTTPException(429, '分析任务较多，请稍后重试')
        try:
            api = research_api()
            with PLOT_LOCK:
                result = api.analyze_csv(str(data.get('csv', '')), data.get('mode'), bool(data.get('robustness')), data_kind=data.get('data_kind', 'individual'), provenance=data.get('provenance'), ordered=data.get('ordered', False))
                return api.plot_statistics(result, bool(data.get('synthetic')), export_directory=store.user_directory(identity['id']) / 'exports')
        finally:
            computation.release()

    @application.post('/api/model-fit')
    def model_fit(data: dict, request: Request):
        user(request)
        from .medical_analysis import fit_model
        if not computation.acquire(blocking=False):
            raise HTTPException(429, '分析任务较多，请稍后重试')
        try:
            return fit_model(data)
        finally:
            computation.release()

    @application.get('/api/submissions')
    def my_submissions(request: Request):
        return {'records':research.submissions(user(request)['id'])}

    def owned_submission(key, identity):
        item = research.submission(key, identity['id'])
        if not item:
            raise HTTPException(404, '投稿不存在')
        return item

    def validate_submission_file(data, identity):
        if data.get('pdf_id'):
            pdf_file(identity, str(data['pdf_id']))
        if data.get('share_pdf') and not data.get('sharing_permission'):
            raise ValueError('分享 PDF 前请填写允许公开的来源或授权依据')

    @application.post('/api/submissions')
    def create_submission(data: dict, request: Request):
        identity = user(request)
        validate_submission_file(data,identity)
        return research.save_submission(data,identity['id'])

    @application.get('/api/submissions/{key}')
    def get_submission(key: str, request: Request):
        return owned_submission(key,user(request))

    @application.put('/api/submissions/{key}')
    def update_submission(key: str, data: dict, request: Request):
        identity = user(request)
        owned_submission(key,identity)
        validate_submission_file(data,identity)
        return research.save_submission(data,identity['id'],key)

    @application.post('/api/submissions/{key}/submit')
    def submit_paper(key: str, request: Request):
        identity = user(request)
        owned_submission(key,identity)
        return research.submit(key,identity['id'])

    @application.get('/api/public/submissions')
    def shared_submissions(request: Request):
        return {'records':[r for r in research.submissions(public=True) if preview(request) or site.visible('submission',r['id'])]}

    @application.get('/api/admin/submissions')
    def review_queue(request: Request):
        identity=user(request,{'admin','editor'})
        return {'records':[r for r in research.submissions() if identity['role']=='owner' or site.visible('submission',r['id'])]}

    @application.get('/api/admin/submissions/{key}/pdf')
    def submitted_pdf(key: str, request: Request):
        identity=user(request,{'admin','editor'})
        editorial_allowed(identity,'submission',key)
        item=research.submission(key)
        if not item or not item.get('pdf_id'):
            raise HTTPException(404,'投稿 PDF 不存在')
        file=PdfLibrary(store.user_directory(item['owner'])/'pdfs').file(item['pdf_id'])
        if not file.is_file():
            raise HTTPException(404,'投稿 PDF 不存在')
        return FileResponse(file,media_type='application/pdf')

    @application.post('/api/admin/submissions/{key}/review')
    def review_submission(key: str, data: dict, request: Request):
        identity = user(request,{'admin'})
        editorial_allowed(identity,'submission',key)
        item = research.submission(key)
        if not item:
            raise HTTPException(404,'投稿不存在')
        if data.get('decision')=='approved' and item.get('share_pdf') and item.get('pdf_id'):
            source=PdfLibrary(store.user_directory(item['owner'])/'pdfs').file(item['pdf_id'])
            if not source.is_file():
                raise ValueError('投稿附件已被删除，请退回作者重新上传')
            directory=research.directory/'published-pdfs'
            directory.mkdir(exist_ok=True)
            shutil.copy2(source,directory/(key+'-'+item['pdf_id']+'.pdf'))
        return research.review_submission(key,data.get('decision'),data.get('note',''),identity['email'])

    @application.get('/api/public/submissions/{key}/pdf')
    def shared_pdf(key: str, request: Request):
        content_allowed(request,'submission',key)
        public = next((r for r in research.submissions(public=True) if r['id']==key),None)
        item = research.submission(key)
        if not public or not public.get('share_pdf') or not public.get('pdf_id'):
            raise HTTPException(404,'暂无公开 PDF')
        file = research.directory/'published-pdfs'/(key+'-'+public['pdf_id']+'.pdf')
        if not file.is_file():
            raise HTTPException(404,'PDF 不存在')
        return FileResponse(file,media_type='application/pdf')

    @application.get('/api/guides/{key}')
    def public_guide(key: str, request: Request):
        content_allowed(request,'article',key)
        content_allowed(request,'guide',key)
        if not re.fullmatch(r'[A-Za-z0-9_-]+',key):
            raise HTTPException(404,'讲解不存在')
        guide = research.guide(key)
        return {'guide':guide,'status':'approved' if guide else 'pending','message':'' if guide else '讲解正在整理与审核，可先阅读原文。'}

    @application.get('/api/admin/guides')
    def guide_queue(request: Request):
        identity=user(request,{'admin','editor'})
        return {'records':[r for r in research.guide_index() if identity['role']=='owner' or site.visible('article',r['key']) and site.visible('guide',r['key'])]}

    @application.get('/api/admin/guides/{key}')
    def guide_draft(key: str, request: Request):
        identity=user(request,{'admin','editor'})
        editorial_allowed(identity,'article',key)
        editorial_allowed(identity,'guide',key)
        if not re.fullmatch(r'[A-Za-z0-9_-]+',key):
            raise HTTPException(404,'讲解不存在')
        return {'guide':research.guide(key,editorial=True)}

    @application.post('/api/admin/guides/{key}')
    def save_guide(key: str, data: dict, request: Request):
        identity = user(request,{'admin'} if data.get('publish') else {'admin','editor'})
        editorial_allowed(identity,'article',key)
        editorial_allowed(identity,'guide',key)
        if not re.fullmatch(r'[A-Za-z0-9_-]+',key):
            raise HTTPException(404,'讲解不存在')
        return research.save_guide(key,data.get('guide') or {},identity['email'],bool(data.get('publish')),data.get('note',''))

    @application.get('/api/literature-audit')
    def literature_audit(request: Request):
        file = ROOT / 'data/literature-audit/index.json'
        if not file.exists():
            return {'records':[],'summary':{}}
        data=json.loads(file.read_text(encoding='utf-8'))
        fields=('key','title','metadata_status','doi_status','notices','publisher_url','doi_url','checked_at','status')
        return {**data,'records':[{k:r.get(k) for k in fields} for r in data['records'] if preview(request) or site.visible('article',r['key'])]}

    @application.get('/exports/{name}')
    def export(name: str, request: Request):
        identity = user(request)
        directory = store.user_directory(identity['id']) / 'exports'
        file = (directory / name).resolve()
        if file.parent != directory.resolve() or not file.is_file() or file.suffix not in {'.png', '.svg', '.json'}:
            raise HTTPException(404, '文件不存在')
        return FileResponse(file)

    @application.get('/{path:path}')
    def static(path: str, request: Request):
        if path in {'admin', 'admin/'}:
            path = 'admin.html'
        elif path in {'', 'index.html'}:
            bypass = request.cookies.get('zhijing_intro') == 'done' or request.query_params.get('intro') == 'done' or request.query_params.get('action') or request.query_params.get('invite')
            path = 'helix-demo.html' if bypass else 'intro.html'
        elif path == 'intro':
            path = 'intro.html'
        file = (ROOT / path).resolve()
        allowed = path in {'helix-demo.html', 'intro.html', 'admin.html', 'ATTRIBUTION.md', 'data/science-sources.json'} or path.startswith('assets/')
        if not allowed or not file.is_relative_to(ROOT) or not file.is_file():
            raise HTTPException(404, '页面不存在')
        media = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css'}.get(file.suffix, mimetypes.guess_type(str(file))[0])
        return FileResponse(file, media_type=media)

    return application


class LazyApplication:
    """Keep importing the ASGI entrypoint free of database creation."""
    def __init__(self):
        self.instance = None

    async def __call__(self, scope, receive, send):
        if self.instance is None:
            self.instance = create_app()
        await self.instance(scope, receive, send)


app = LazyApplication()
