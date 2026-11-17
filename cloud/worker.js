import { libraryPage, libraryIndex, libraryMeta } from './library.js';
import { providerRoute } from './providers.js';
import { createPrivateStorage, CHUNK_SIZE, MAX_FILE_BYTES } from './free-storage.js';
import { passwordRoute, secretHash } from './auth-password.js';
import { noteRoute, sharedPdfAllowed } from './collaboration.js';
import { summaryRoute } from './ai-summary.js';
import { searchLiterature } from './literature-search.js';
import { TRANSLATION_VERSION, translationModel } from './medical-translation.js';
import { GLOSSARY_VERSION } from './medical-glossary.js';
import {databaseIssue} from './availability.js';
import {publicManifest,publicState,staticLibraryPage,staticLibraryResource,moduleAllowed} from './public-library.js';

const OWNER = 'owner';
const STAFF = new Set(['owner', 'admin', 'editor']);
const ADMIN = new Set(['owner', 'admin']);
const ROLE_ACCESS = { owner: ADMIN, admin: new Set(['admin']), editor: new Set(['editor']), user: new Set(['user']) };
const DEFAULT_SITE = {
  name: '知镜', subtitle: '医学研究工作台', hero_title: '从人体出发，找到研究方向。',
  hero_description: '旋转人体或选择器官，连接文献、理论与可复现的研究。', announcement: '',
  resource_links: [], admin_limit: null,
  modules: Object.entries({ search:'文献检索', assist:'AI 证据问答', reader:'文献精读', pdf:'PDF 文献', papers:'论文投稿与复现', stats:'统计与绘图', math:'数学建模', anatomy:'人体 3D 导航', lab:'模拟实验室', review:'论文复盘', models:'模型与翻译', res:'官方资源', intro:'人体导览' })
    .map(([id, label], order) => ({ id, label, visible: true, order })),
};
const now = () => Date.now();
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const cookie = (request, name) => (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
const uid = () => crypto.randomUUID().replaceAll('-', '');
const bytesHex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
async function digest(value) { return bytesHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function body(request) { try { return await request.json(); } catch { throw new Error('请求内容格式无效'); } }
function validateEmail(email) { const v = String(email || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('请输入有效邮箱'); return v; }
function validKey(key) { return /^(?:[A-Za-z0-9_-]{1,120}|10\.\d{4,9}\/[-._;()/:+A-Z0-9]{1,150})$/i.test(String(key)); }
function sql(db, query, ...args) { return db.prepare(query).bind(...args); }
async function first(db, query, ...args) { return sql(db, query, ...args).first(); }
async function all(db, query, ...args) { return (await sql(db, query, ...args).all()).results || []; }
async function requireUser(request, env, allowed = null) {
  const raw = cookie(request, 'helix_session');
  if (!raw) throw Object.assign(new Error('请登录知镜账号'), { status: 401 });
  const identity = await first(env.DB, `SELECT users.id,users.email,users.role,users.active,users.verified,account_credentials.username
    FROM sessions JOIN users ON users.id=sessions.user_id LEFT JOIN account_credentials ON account_credentials.user_id=users.id
    WHERE sessions.token_hash=? AND sessions.expires>? AND users.active=1 AND users.verified=1`, await digest(raw), now());
  if (!identity) throw Object.assign(new Error('登录状态已失效，请重新登录'), { status: 401 });
  if (allowed && !allowed.has(identity.role)) throw Object.assign(new Error('当前账号没有此操作权限'), { status: 403 });
  return identity;
}
async function optionalUser(request, env) { try { return await requireUser(request, env); } catch { return null; } }
function setSession(token, remember) {
  return `helix_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${remember ? '; Max-Age=604800' : ''}`;
}
function clearSession() { return 'helix_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'; }
function cleanResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}
async function putJson(bucket, key, value) { await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json; charset=utf-8' } }); }
async function getJson(bucket, key) { const object = await bucket.get(key); return object ? object.json() : null; }
async function settings(db) {
  const row = await first(db, 'SELECT draft,published,previous,admin_limit FROM site_settings WHERE id=1');
  if (!row) return { draft: DEFAULT_SITE, published: DEFAULT_SITE, previous: null, admin_limit: null };
  return { draft: JSON.parse(row.draft), published: JSON.parse(row.published), previous: row.previous ? JSON.parse(row.previous) : null, admin_limit: row.admin_limit };
}
async function isVisible(db, kind, key) {
  const row = await first(db, 'SELECT visible FROM visibility WHERE kind=? AND item_key=?', kind, String(key));
  return !row || !!row.visible;
}
async function visibleModule(db, id) {
  const site = await settings(db);
  return site.published.modules?.find(m => m.id === id)?.visible !== false;
}
async function articleIdentifier(env, identifier) {
  const index = await getJson(env.PRIVATE, 'runtime/identifiers.json');
  let identifiers = Array.isArray(index?.[identifier]) ? index[identifier].map(String) : [];
  if (!identifiers.length) {
    const catalog = await getJson(env.PRIVATE, 'runtime/catalog.json');
    const doc = (catalog?.docs || []).find(item => [item.key, item.pmid, item.doi].some(value => String(value || '') === identifier));
    if (doc) identifiers = [doc.key, doc.pmid, doc.doi].filter(Boolean).map(String);
  }
  const override = await first(env.DB, `SELECT key,payload,removed FROM articles
    WHERE key=? OR json_extract(payload,'$.pmid')=? OR json_extract(payload,'$.doi')=? LIMIT 1`, identifier, identifier, identifier);
  if (override?.removed) return [];
  if (override) {
    const record = JSON.parse(override.payload);
    identifiers = [override.key, record.pmid, record.doi, ...identifiers].filter(Boolean).map(String);
  }
  return [...new Set(identifiers.length ? identifiers : [identifier])];
}
async function articleIsPublic(env, key) {
  const identifiers = await articleIdentifier(env, String(key));
  return identifiers.length > 0 && (await Promise.all(identifiers.map(id => isVisible(env.DB, 'article', id)))).every(Boolean);
}
async function filterVisibleArticles(env, records) {
  const hidden = new Set((await all(env.DB, "SELECT item_key FROM visibility WHERE kind='article' AND visible=0")).map(row => row.item_key));
  const identifiers = await getJson(env.PRIVATE, 'runtime/identifiers.json') || {};
  return records.filter(record => {
    const aliases = new Set([record.key, record.pmid, record.doi].filter(Boolean).map(String));
    for (const id of [...aliases]) for (const alias of identifiers[id] || []) aliases.add(String(alias));
    return [...aliases].every(id => !hidden.has(id));
  });
}
async function library(env, includePrivate = false, offsetValue = null, limitValue = null) {
  return libraryPage(env, includePrivate, offsetValue, limitValue);
}
async function allCatalogDocs(env) {
  const ledger = await getJson(env.PRIVATE, 'runtime/ledger.json');
  if (Array.isArray(ledger?.records)) return ledger.records.map(({ review, removed, ...record }) => record);
  return (await getJson(env.PRIVATE, 'runtime/catalog.json'))?.docs || [];
}
async function submissions(db, owner = null, publicOnly = false) {
  const rows = await all(db, `SELECT * FROM submissions ${publicOnly ? 'WHERE published IS NOT NULL' : owner ? 'WHERE owner=?' : ''} ORDER BY updated DESC`, ...(owner && !publicOnly ? [owner] : []));
  return rows.map(row => publicOnly ? JSON.parse(row.published) : ({
    ...JSON.parse(row.payload), id: row.id, owner: row.owner, status: row.status, review_note: row.review_note,
    created: row.created, updated: row.updated, reviewer: row.reviewer, has_published: !!row.published,
  }));
}
async function emitCode(env, email) {
  if (!env.TEST_OTP && !env.RESEND_API_KEY) throw Object.assign(new Error('邮箱登录尚未配置，站主需连接免费发信服务后启用。文献检索和本机分析可以直接使用。'), { status: 503 });
  const existing = await first(env.DB, 'SELECT expires FROM login_codes WHERE email=?', email);
  if (existing && existing.expires > now() + 9 * 60_000) throw Object.assign(new Error('验证码已发送，请一分钟后重试'), { status: 429, retryAfter: 60 });
  const code = env.TEST_OTP || String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await sql(env.DB, 'INSERT OR REPLACE INTO login_codes(email,code_hash,expires,attempts) VALUES(?,?,?,0)', email, await digest(email + ':' + code), now() + 600_000).run();
  if (env.TEST_OTP) return;
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM || '知镜 <login@cognispect.tech>', to: [email], subject: '知镜登录验证码', text: `你的登录验证码是 ${code}，10 分钟内有效。` }),
  });
  if (!result.ok) { await sql(env.DB, 'DELETE FROM login_codes WHERE email=?', email).run(); throw new Error('验证码邮件暂未发送，请稍后重试'); }
}
async function verifyCode(env, email, code) {
  const row = await first(env.DB, 'SELECT * FROM login_codes WHERE email=? AND expires>?', email, now());
  if (!row || row.attempts >= 5 || await digest(email + ':' + String(code || '')) !== row.code_hash) {
    if (row) await sql(env.DB, 'UPDATE login_codes SET attempts=attempts+1 WHERE email=?', email).run();
    throw Object.assign(new Error('验证码无效或已过期'), { status: 400 });
  }
  await sql(env.DB, 'DELETE FROM login_codes WHERE email=?', email).run();
}
async function publicPdf(request, env, id) {
  if (!await visibleModule(env.DB, 'papers')) return json({ error: '投稿模块暂未公开' }, 404);
  const row = await first(env.DB, 'SELECT published FROM submissions WHERE id=?', id);
  const item = row?.published && await isVisible(env.DB, 'submission', id) ? JSON.parse(row.published) : null;
  if (!item?.pdf_id || !item.share_pdf || !item.sharing_permission) return json({ error: 'PDF 尚未获准公开' }, 404);
  const expectedSnapshot = `published-pdfs/${id}-${item.pdf_id}.pdf`;
  return item.pdf_snapshot_key === expectedSnapshot ? pdfResponse(request, env.PRIVATE, expectedSnapshot, id) : json({ error: 'PDF 不存在' }, 404);
}
async function pdfResponse(request, storage, key, name) {
  let file = await storage.get(key);
  if (!file) return json({ error: 'PDF 不存在' }, 404);
  const size = file.size, headers = new Headers({ 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}.pdf"`, 'accept-ranges': 'bytes' });
  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2] || size));
    const end = match?.[1] && match?.[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    if (!match || start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    file = await storage.get(key, { range: { offset: start, length: end - start + 1 } });
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(file.body, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  return new Response(file.body, { headers });
}
async function auditedNotice(env, key) {
  const doc = await library(env);
  const article = doc.docs.find(x => String(x.key) === String(key) || String(x.pmid) === String(key));
  const record = article?.pmid ? await getJson(env.PRIVATE, `runtime/audit/${article.pmid}.json`) : null;
  return record?.notices || {};
}
async function migrateClaim(request, env) {
  const input = await body(request), email = validateEmail(input.email), code = String(input.code || '');
  await verifyCode(env, email, code);
  const claimHash = await digest(String(input.claim_token || ''));
  const claim = await first(env.DB, 'SELECT * FROM claims WHERE token_hash=? AND expires>?', claimHash, now());
  if (!claim) throw Object.assign(new Error('迁移认领链接无效或已过期'), { status: 400 });
  if (claim.target_email && claim.target_email !== email) throw Object.assign(new Error('此迁移认领码绑定了其他邮箱'), { status: 403 });
  const duplicate = await first(env.DB, 'SELECT id FROM users WHERE email=? AND id<>?', email, claim.user_id);
  if (duplicate) throw Object.assign(new Error('该邮箱已绑定其他账号'), { status: 409 });
  const role = claim.role || (await first(env.DB, 'SELECT role FROM users WHERE id=?', claim.user_id))?.role || 'user';
  if (role === 'admin') {
    const site = await settings(env.DB), count = await first(env.DB, "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1");
    if (site.admin_limit !== null && count.n >= site.admin_limit) throw Object.assign(new Error('管理员名额已满，请联系站主'), { status: 403 });
  }
  await env.DB.batch([
    sql(env.DB, 'UPDATE users SET email=?,role=?,verified=1,active=1 WHERE id=?', email, role, claim.user_id),
    sql(env.DB, 'DELETE FROM claims WHERE token_hash=?', claimHash),
  ]);
  const token = uid() + uid();
  await sql(env.DB, 'INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)', await digest(token), claim.user_id, now() + 604_800_000).run();
  return json({ authenticated: true, user: { id: claim.user_id, email, role, active: true, verified: true }, auth_mode: 'otp' }, 200, { 'set-cookie': setSession(token, true) });
}

async function api(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (!['GET','HEAD','OPTIONS'].includes(method)) {
    if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return json({ error: '跨站请求未被接受' }, 403);
    const limit = path === '/api/pdf/upload' ? 30 * 1024 * 1024 : 3 * 1024 * 1024;
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > limit) return json({ error: '请求超过大小限制' }, 413);
  }
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': url.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS' } });
  const routeContext={json,body,requireUser,optionalUser,settings};
  const accountResponse=await passwordRoute(request,env,routeContext);if(accountResponse)return accountResponse;
  const sharedNotePdf=path.match(/^\/api\/notes\/([a-f0-9]+)\/pdf$/);
  if(sharedNotePdf&&method==='GET'){
    const viewer=await requireUser(request,env),note=await first(env.DB,'SELECT owner_id,source_pdf_id FROM research_notes WHERE id=?',sharedNotePdf[1]);
    if(!note?.source_pdf_id||note.owner_id!==viewer.id&&!await sharedPdfAllowed(env.DB,note.source_pdf_id,viewer.id))return json({error:'没有查看这份 PDF 的权限'},404);
    const pdf=await first(env.DB,'SELECT object_key FROM user_pdfs WHERE id=? AND owner=?',note.source_pdf_id,note.owner_id);
    return pdf?pdfResponse(request,env.PRIVATE,pdf.object_key,note.source_pdf_id):json({error:'PDF 不存在'},404);
  }
  const noteResponse=await noteRoute(request,env,routeContext);if(noteResponse)return noteResponse;
  const summaryResponse=await summaryRoute(request,env,routeContext);if(summaryResponse)return summaryResponse;
  if (path === '/api/health') return json({ service: 'zhijing-cloud', version: 'cloud-free-v2', storage: 'pages-d1', billing: 'free' });
  if (path === '/api/auth/session') {
    let identity = null; try { identity = await requireUser(request, env); } catch {}
    return json({ authenticated: !!identity, user: identity && { ...identity, active: !!identity.active, verified: !!identity.verified }, smtp_configured: !!env.RESEND_API_KEY, auth_mode: 'otp' });
  }
  if (path === '/api/auth/login' || path === '/api/auth/register') {
    const input = await body(request), email = validateEmail(input.email);
    await emitCode(env, email);
    return json({ sent: true, message: '验证码已发送，请检查邮箱。' });
  }
  if (path === '/api/auth/claim' && method === 'POST') return migrateClaim(request, env);
  if ((path === '/api/auth/verify' || path === '/api/auth/confirm') && method === 'POST') {
    const input = await body(request), email = validateEmail(input.email);
    await verifyCode(env, email, input.code);
    let identity = await first(env.DB, 'SELECT * FROM users WHERE email=?', email);
    const staffInvite = await first(env.DB, 'SELECT role FROM staff_invites WHERE email=? AND expires>?', email, now());
    if (!identity) {
      identity = { id: uid(), email, role: staffInvite?.role || 'user', active: 1, verified: 1 };
      await sql(env.DB, 'INSERT INTO users(id,email,role,active,verified,created_at) VALUES(?,?,?,?,?,?)', identity.id, email, identity.role, 1, 1, now()).run();
    } else if (staffInvite) {
      await sql(env.DB, 'UPDATE users SET role=?,active=1,verified=1 WHERE id=?', staffInvite.role, identity.id).run();
      identity.role = staffInvite.role; identity.active = 1; identity.verified = 1;
    }
    if (staffInvite) await sql(env.DB, 'DELETE FROM staff_invites WHERE email=?', email).run();
    if (!identity.active) throw Object.assign(new Error('账号已停用，请联系站主'), { status: 403 });
    const token = uid() + uid(), remember = !!input.remember;
    await sql(env.DB, 'INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)', await digest(token), identity.id, now() + (remember ? 604_800_000 : 86_400_000)).run();
    return json({ authenticated: true, user: { id: identity.id, email, role: identity.role, active: true, verified: true }, username: email, role: identity.role, auth_mode: 'otp' }, 200, { 'set-cookie': setSession(token, remember) });
  }
  if (path === '/api/auth/logout' || path === '/api/admin/logout') {
    const raw = cookie(request, 'helix_session'); if (raw) await sql(env.DB, 'DELETE FROM sessions WHERE token_hash=?', await digest(raw)).run();
    return json({ authenticated: false }, 200, { 'set-cookie': clearSession() });
  }
  if (path === '/api/auth/forgot-password') return json({ sent: true, message: '邮箱验证码登录无需重置密码，请重新获取验证码。' });

  if (path === '/api/admin/session') {
    const identity = await optionalUser(request, env), allowed = !!identity && STAFF.has(identity.role);
    return json({ configured: !!env.OWNER_EMAIL, authenticated: allowed, username: allowed ? identity.email : null, role: allowed ? identity.role : null, auth_mode: 'otp' });
  }
  const publicPdfMatch = path.match(/^\/api\/public\/submissions\/([a-f0-9]{24})\/pdf$/);
  if (publicPdfMatch && method === 'GET') return publicPdf(request, env, publicPdfMatch[1]);
  if (path === '/api/public/submissions') {
    const ownerPreview = url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER;
    if (!ownerPreview && !await visibleModule(env.DB, 'papers')) return json({ records: [] });
    const hidden = ownerPreview ? new Set() : new Set((await all(env.DB, "SELECT item_key FROM visibility WHERE kind='submission' AND visible=0")).map(row => row.item_key));
    const records = (await submissions(env.DB, null, true)).filter(item => !hidden.has(String(item.id)));
    return json({ records });
  }
  if (path === '/api/site') {
    const data = await settings(env.DB);
    if (url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER) return json(data.draft);
    return json(data.published);
  }
  if (path === '/api/bootstrap') {
    if(!url.searchParams.has('preview')){
      try{
        const state=await publicState(env);
        if(state){const sessionResponse=await passwordRoute(new Request(new URL('/api/auth/session',request.url),{headers:request.headers}),env,routeContext);const session=await sessionResponse.json();const library=moduleAllowed(state,'search')?await staticLibraryPage(env,state,0,20):{docs:[],total:0,version:state.version,next:null};return json({version:state.version,site:state.site||DEFAULT_SITE,session,library,public_state:state,services:{database:{available:true},account:{available:true}},backup_url:'/demo/'});}
        await settings(env.DB);
      }catch(error){const issue=databaseIssue(error);return json({version:'unavailable',site:DEFAULT_SITE,session:{authenticated:false,user:null,unavailable:true},library:null,public_state:null,services:{database:{available:false,...issue},account:{available:false}},backup_url:'/demo/'});}
    }
    const sessionRequest = new Request(new URL('/api/auth/session', request.url), { headers: request.headers });
    const firstPage = !url.searchParams.has('version') && !url.searchParams.has('preview') ? libraryPage(env, false, 0, 20) : null;
    const [site, meta, sessionResponse, initialLibrary] = await Promise.all([settings(env.DB), libraryMeta(env), passwordRoute(sessionRequest, env, routeContext), firstPage]);
    const session = await sessionResponse.json();
    const preview = url.searchParams.has('preview') && session.user?.role === OWNER;
    const library = !preview && url.searchParams.get('version') === meta.version ? null : initialLibrary || await libraryPage(env, preview, 0, 20);
    return json({version:meta.version, site:preview ? site.draft : site.published, session, library});
  }
  if(path==='/api/library/state'){const state=await publicState(env);return state?json(state):json({backend:'database',verified:true});}
  if(path.startsWith('/api/library/static/'))return staticLibraryResource(request,env,path.slice('/api/library/static/'.length));
  if (path === '/api/library/meta') return json(await libraryMeta(env));
  if (path === '/api/library/search' && method === 'POST') {
    if(await publicManifest(env))return json({error:'检索方式已更新，请刷新网页后继续使用分片检索。',code:'CLIENT_UPDATE_REQUIRED'},409);
    if (!await visibleModule(env.DB, 'search')) return json({ error: '文献检索模块暂未公开' }, 404);
    const input = await body(request);
    const result = await searchLiterature(env.DB, input);
    return json(result);
  }
  if (path === '/api/library/online' && method === 'POST') {
    if (!await visibleModule(env.DB, 'search')) return json({ error: '文献检索模块暂未公开' }, 404);
    const input = await body(request), groups = (Array.isArray(input.groups) ? input.groups : []).map(group => group.map(term => String(term).replace(/["\\\r\n]/g, ' ').trim()).filter(Boolean)).filter(group => group.length);
    if (!groups.length) return json({ error: '请输入疾病、检查方式或研究问题' }, 400);
    const escapeTerm = term => '"' + term.replace(/["\\]/g, ' ') + '"';
    let query = groups.map(group => '(' + group.map(term => 'TITLE_ABS:' + escapeTerm(term)).join(' OR ') + ')').join(' AND ') + ' AND SRC:MED';
    const from = Number(input.yearFrom) || 0, to = Number(input.yearTo) || 0;
    query += ' AND FIRST_PDATE:[' + (from || 1800) + '-01-01 TO ' + (to ? to + '-12-31' : new Date().toISOString().slice(0,10)) + ']';
    const endpoint = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    endpoint.search = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: '20', cursorMark: String(input.cursor || '*') });
    if (input.sort === 'year' || input.sort === 'oldest') endpoint.searchParams.set('sort','FIRST_PDATE_D '+(input.sort==='oldest'?'asc':'desc'));
    const upstream = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (!upstream.ok) return json({ error: 'Europe PMC 在线检索暂不可用，请稍后重试。' }, 502);
    const value = await upstream.json();
    return json({ query, source: 'Europe PMC', source_url: endpoint.href, retrieved_at: new Date().toISOString(), hit_count: Number(value.hitCount || 0), cursor: input.cursor || '*', next_cursor: value.nextCursorMark || null, records: value.resultList?.result || [] });
  }
  const onlineDocument = path.match(/^\/api\/library\/online\/document\/([A-Za-z0-9._-]{1,100})$/);
  if (onlineDocument && method === 'GET') {
    if (!await visibleModule(env.DB, 'search')) return json({ error: '文献检索模块暂未公开' }, 404);
    const endpoint = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    endpoint.search = new URLSearchParams({ query: 'EXT_ID:' + onlineDocument[1] + ' AND SRC:MED', format: 'json', resultType: 'core', pageSize: '1' });
    const upstream = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (!upstream.ok) return json({ error: 'Europe PMC 暂未响应' }, 502);
    const record = (await upstream.json()).resultList?.result?.[0];
    return record ? json({ record }) : json({ error: '未找到该文献' }, 404);
  }
  if (path === '/api/library/index') {
    const owner = url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER;
    return json(await libraryIndex(env, !!owner));
  }
  const libraryDocument = path.match(/^\/api\/library\/document\/([^/]+)$/);
  if (libraryDocument) {
    const owner = url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER;
    const result = await libraryPage(env, !!owner, 0, 1, decodeURIComponent(libraryDocument[1]));
    return result.docs.length ? json(result) : json({error:'该文献暂未公开'},404);
  }
  if (path === '/api/library') {
    const owner = url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER;
    return json(await library(env, !!owner, url.searchParams.get('offset'), url.searchParams.get('limit')));
  }
  if (path === '/api/catalog') {
    const owner = url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER;
    const byKey = new Map();
    const articleRows = await all(env.DB, 'SELECT key,payload,removed FROM articles'), removed = [];
    const hiddenArticles = new Set((await all(env.DB, "SELECT item_key FROM visibility WHERE kind='article' AND visible=0")).map(row => row.item_key));
    const identifiers = owner ? {} : await getJson(env.PRIVATE, 'runtime/identifiers.json') || {};
    if (!owner) {
      for (const hidden of hiddenArticles) {
        removed.push(hidden);
        if (Array.isArray(identifiers[hidden])) removed.push(String(identifiers[hidden][0]));
      }
    }
    for (const row of articleRows) {
      const record = JSON.parse(row.payload), key = String(row.key), aliases = [row.key, record.pmid, record.doi].filter(Boolean).map(String);
      if (row.removed || (!owner && aliases.some(id => hiddenArticles.has(id)))) { byKey.delete(key); removed.push(key); continue; }
      byKey.set(key, { ...(byKey.get(key) || {}), ...record, key });
    }
    if (owner || await visibleModule(env.DB, 'papers')) {
      const hiddenSubmissions = new Set((await all(env.DB, "SELECT item_key FROM visibility WHERE kind='submission' AND visible=0")).map(row => row.item_key));
      for (const item of await submissions(env.DB, null, true)) {
        const key = 'submission-' + item.id;
        if (!owner && hiddenSubmissions.has(item.id)) { byKey.delete(key); removed.push(key); continue; }
        byKey.set(key, { ...item.article, key, submission_id: item.id, topics: item.article.topics || [] });
      }
    }
    for (const key of removed) byKey.delete(String(key));
    return json({ upserts: [...byKey.values()], removed: [...new Set(removed.map(String))] });
  }
  const publicPublication = path.match(/^\/api\/publications\/([A-Za-z0-9_-]+)$/);
  if (publicPublication) {
    const requestedKey = publicPublication[1], owner = url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER;
    const identifiers = await articleIdentifier(env, requestedKey), key = identifiers[0];
    if (!owner && (!identifiers.length || !(await Promise.all(identifiers.map(id => isVisible(env.DB, 'article', id)))).every(Boolean) || !await visibleModule(env.DB, 'reader'))) return json({ error: '该文献暂无已发布的全文' }, 404);
    const doc = await getJson(env.PRIVATE, `runtime/publications/${key}.json`);
    return doc?.public === true && doc?.publication_status === 'published' && ['eligible','eligible_noncommercial'].includes(doc?.license?.eligibility) ? json(doc) : json({ error: '该文献暂无已发布的全文' }, 404);
  }
  const publicGuide = path.match(/^\/api\/guides\/([A-Za-z0-9_-]+)$/);
  if (publicGuide) {
    const key = publicGuide[1], owner = url.searchParams.has('preview') && (await optionalUser(request, env))?.role === OWNER;
    const identifiers = await articleIdentifier(env, key);
    if (!owner && (!await isVisible(env.DB, 'guide', key) || !identifiers.length || !(await Promise.all(identifiers.map(id => isVisible(env.DB, 'article', id)))).every(Boolean) || !await visibleModule(env.DB, 'reader'))) return json({ guide: null, status: 'pending', message: '讲解未公开。' });
    const row = await first(env.DB, 'SELECT published,draft FROM guides WHERE key=?', key), data = row?.published ? JSON.parse(row.published) : await getJson(env.PRIVATE, `runtime/guides/${key}.json`);
    const guide = row && owner && url.searchParams.has('preview') ? JSON.parse(row.draft) : data;
    return json({ guide: guide?.status === 'approved' || owner ? guide : null, status: guide?.status === 'approved' || owner ? guide?.status || 'draft' : 'pending', message: guide?.status === 'approved' || owner ? '' : '讲解正在整理与审核，可先阅读原文。' });
  }

  if (path === '/api/translation/status' && method === 'GET') return await visibleModule(env.DB, 'reader') ? json({ configured: !!env.AI?.run, provider: 'Cloudflare AI', model:translationModel(env),version:TRANSLATION_VERSION,glossary_version:GLOSSARY_VERSION }) : json({ error: '该功能模块暂未公开' }, 404);
  const translationUser=path==='/api/translation'?await requireUser(request,env):null;
  const providerModule = { '/api/search': 'search', '/api/answer': 'assist', '/api/translation': 'reader', '/api/models': 'models', '/api/model-test': 'models' }[path];
  if (providerModule && !await visibleModule(env.DB, providerModule)) return json({ error: '该功能模块暂未公开' }, 404);
  const providerResponse = await providerRoute(request, env, fetch, translationUser?.id||'');
  if (providerResponse) return providerResponse;

  const identity = await requireUser(request, env);
  if (path.startsWith('/api/submissions') && !await visibleModule(env.DB, 'papers')) return json({ error: '投稿模块暂未公开' }, 404);
  if (path === '/api/workspace' && method === 'GET') {
    const row = await first(env.DB, 'SELECT revision,data FROM workspaces WHERE user_id=?', identity.id);
    return json(row ? { revision: row.revision, data: JSON.parse(row.data) } : { revision: 0, data: {} });
  }
  if (path === '/api/workspace' && method === 'PUT') {
    const input = await body(request);
    if (input.user_id !== identity.id) return json({ code: 'ACCOUNT_CHANGED', error: '登录账号已切换，请刷新当前页面后继续' }, 409);
    if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data) || JSON.stringify(input.data).length > 2_000_000) throw new Error('工作区数据无效或过大');
    const old = await first(env.DB, 'SELECT revision,data FROM workspaces WHERE user_id=?', identity.id), revision = old?.revision || 0;
    if (Number(input.revision) !== revision) return json({ error: '工作区已在其他页面更新，请选择保留的版本', revision, data: old ? JSON.parse(old.data) : {} }, 409);
    const next = revision + 1;
    await sql(env.DB, 'INSERT OR REPLACE INTO workspaces(user_id,revision,data) VALUES(?,?,?)', identity.id, next, JSON.stringify(input.data)).run();
    return json({ revision: next, data: input.data });
  }
  if (path === '/api/admin/session') {
    const isStaff = STAFF.has(identity.role);
    return json({ configured: true, authenticated: isStaff, username: isStaff ? identity.email : null, role: isStaff ? identity.role : null, auth_mode: 'otp' });
  }
  if (path === '/api/literature-audit' && method === 'GET') {
    if (!STAFF.has(identity.role)) throw Object.assign(new Error('当前账号没有此操作权限'), { status: 403 });
    if (identity.role !== OWNER && !await visibleModule(env.DB, 'res')) return json({ summary: {}, records: [] });
    const data = await getJson(env.PRIVATE, 'runtime/audit/index.json') || { summary: {}, records: [] };
    if (identity.role !== OWNER) data.records = await filterVisibleArticles(env, data.records || []);
    return json(data);
  }
  let match = path.match(/^\/api\/literature-audit\/([0-9]{1,12})$/);
  if (match) {
    if (!STAFF.has(identity.role)) throw Object.assign(new Error('当前账号没有此操作权限'), { status: 403 });
    if (identity.role !== OWNER && !await visibleModule(env.DB, 'res')) return json({ error: '资源导航模块暂未公开' }, 404);
    const record = await getJson(env.PRIVATE, `runtime/audit/${match[1]}.json`);
    if (record && identity.role !== OWNER && !await articleIsPublic(env, record.key || record.pmid || match[1])) return json({ error: '核查记录不存在' }, 404);
    return record ? json(record) : json({ error: '核查记录不存在' }, 404);
  }
  match = path.match(/^\/api\/publications\/([A-Za-z0-9_-]+)$/);
  if (match) {
    const key = match[1];
    if (!await isVisible(env.DB, 'article', key) || !await visibleModule(env.DB, 'reader')) return json({ error: '该文献暂无已发布的全文' }, 404);
    const doc = await getJson(env.PRIVATE, `runtime/publications/${key}.json`);
    return doc?.public === true && doc?.publication_status === 'published' && ['eligible','eligible_noncommercial'].includes(doc?.license?.eligibility) ? json(doc) : json({ error: '该文献暂无已发布的全文' }, 404);
  }
  match = path.match(/^\/api\/guides\/([A-Za-z0-9_-]+)$/);
  if (match) {
    const key = match[1];
    if (!await isVisible(env.DB, 'guide', key) || !await visibleModule(env.DB, 'reader')) return json({ guide: null, status: 'pending', message: '讲解未公开。' });
    const row = await first(env.DB, 'SELECT published FROM guides WHERE key=?', key);
    const guide = row?.published ? JSON.parse(row.published) : await getJson(env.PRIVATE, `runtime/guides/${key}.json`);
    return json({ guide: guide?.status === 'approved' ? guide : null, status: guide?.status === 'approved' ? 'approved' : 'pending', message: guide?.status === 'approved' ? '' : '讲解正在整理与审核，可先阅读原文。' });
  }
  if (path === '/api/admin/guides') {
    if (!STAFF.has(identity.role)) throw Object.assign(new Error('当前账号没有此操作权限'), { status: 403 });
    const base = await getJson(env.PRIVATE, 'runtime/guides/index.json') || { records: [] };
    const edits = new Map((await all(env.DB, 'SELECT key,status,updated FROM guides')).map(r => [r.key,r]));
    const records = [];
    const articleRecords = identity.role === OWNER ? base.records || [] : await filterVisibleArticles(env, base.records || []);
    const hiddenGuides = identity.role === OWNER ? new Set() : new Set((await all(env.DB, "SELECT item_key FROM visibility WHERE kind='guide' AND visible=0")).map(row => row.item_key));
    for (const record of articleRecords) {
      if (hiddenGuides.has(String(record.key))) continue;
      records.push({ ...record, ...(edits.has(record.key) ? { status: edits.get(record.key).status, updated: edits.get(record.key).updated } : {}) });
    }
    return json({ records });
  }
  match = path.match(/^\/api\/admin\/guides\/([A-Za-z0-9_-]+)$/);
  if (match && method === 'GET') {
    await requireUser(request, env, STAFF);
    if (identity.role !== OWNER && (!await isVisible(env.DB, 'guide', match[1]) || !await articleIsPublic(env, match[1]))) return json({ error: '讲解不存在' }, 404);
    const row = await first(env.DB, 'SELECT draft,status,note FROM guides WHERE key=?', match[1]);
    return json({ guide: row ? { ...JSON.parse(row.draft), status: row.status, review_note: row.note } : await getJson(env.PRIVATE, `runtime/guides/${match[1]}.json`) });
  }
  if (match && method === 'POST') {
    const input = await body(request), guide = input.guide || {};
    await requireUser(request, env, input.publish ? ADMIN : STAFF);
    if (identity.role !== OWNER && (!await isVisible(env.DB, 'guide', match[1]) || !await articleIsPublic(env, match[1]))) return json({ error: '讲解不存在' }, 404);
    const published = input.publish ? { ...guide, key: match[1], status: 'approved', updated: new Date().toISOString(), reviewer: identity.email, published_at: new Date().toISOString() } : null;
    if (input.publish && !(guide.sections || []).length) throw new Error('请先填写讲解内容');
    const draft = { ...guide, key: match[1], status: input.publish ? 'approved' : 'draft', updated: new Date().toISOString() };
    await sql(env.DB, 'INSERT INTO guides(key,draft,published,status,note,editor,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET draft=excluded.draft,published=COALESCE(excluded.published,guides.published),status=excluded.status,note=excluded.note,editor=excluded.editor,updated=excluded.updated', match[1], JSON.stringify(draft), published ? JSON.stringify(published) : null, draft.status, String(input.note || ''), identity.email, draft.updated).run();
    return json(draft);
  }
  if (path === '/api/admin/users' && method === 'GET') {
    await requireUser(request, env, ADMIN);
    return json({ users: await all(env.DB, 'SELECT id,email,role,active,verified FROM users ORDER BY role,email') });
  }
  if (path === '/api/admin/owner' && method === 'GET') {
    await requireUser(request, env, new Set([OWNER]));
    const site = await settings(env.DB), users = await all(env.DB, 'SELECT id,email,role,active,verified FROM users ORDER BY role,email');
    return json({ admin_limit: site.admin_limit, admin_count: users.filter(u => u.role === 'admin' && u.active).length, users });
  }
  if (path === '/api/admin/owner' && method === 'POST') {
    await requireUser(request, env, new Set([OWNER]));
    const input = await body(request), limit = input.admin_limit === null || input.admin_limit === '' ? null : Number(input.admin_limit);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 500)) throw new Error('管理员名额须为 0–500 或不设上限');
    const count = await first(env.DB, "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1");
    if (limit !== null && count.n > limit) throw new Error('当前管理员人数超过新上限，请先调整管理员账号');
    const site = await settings(env.DB); await sql(env.DB, 'INSERT OR REPLACE INTO site_settings(id,draft,published,previous,admin_limit) VALUES(1,?,?,?,?)', JSON.stringify(site.draft), JSON.stringify(site.published), site.previous ? JSON.stringify(site.previous) : null, limit).run();
    return json({ saved: true, admin_limit: limit, admin_count: count.n });
  }
  if (path === '/api/admin/owner/admins' && method === 'POST') {
    await requireUser(request, env, new Set([OWNER]));
    const input = await body(request), email = validateEmail(input.email), role = input.role || 'admin';
    if (role !== 'admin') throw new Error('仅可通过专用站主账号管理管理员');
    const site = await settings(env.DB), count = await first(env.DB, "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1"), pending = await first(env.DB, "SELECT COUNT(*) n FROM staff_invites i LEFT JOIN users u ON u.email=i.email AND u.role='admin' AND u.active=1 WHERE i.role='admin' AND i.expires>?", now());
    if (site.admin_limit !== null && count.n + pending.n >= site.admin_limit) throw new Error('管理员名额已满');
    await sql(env.DB, 'INSERT INTO staff_invites(email,role,token_hash,created_by,expires) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role,token_hash=excluded.token_hash,created_by=excluded.created_by,expires=excluded.expires', email, 'admin', await digest(uid()), identity.email, now() + 7 * 86_400_000).run();
    await emitCode(env, email);
    return json({ invited: true, email, message: '管理员邮箱验证码已发送；对方完成验证后生效。' });
  }
  match = path.match(/^\/api\/admin\/owner\/admins\/([^/]+)$/);
  if (match && method === 'DELETE') {
    await requireUser(request, env, new Set([OWNER]));
    const email = decodeURIComponent(match[1]).toLowerCase();
    if (email === identity.email) throw new Error('站主不能撤销自己的管理身份');
    await sql(env.DB, "UPDATE users SET role='user',active=0 WHERE email=? AND role='admin'", email).run();
    await sql(env.DB, 'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)', email).run();
    return json({ removed: true });
  }
  if (path === '/api/admin/site' && method === 'GET') {
    await requireUser(request, env, new Set([OWNER])); const site = await settings(env.DB);
    return json({ ...site, visibility: await all(env.DB, 'SELECT kind,item_key AS key,visible FROM visibility ORDER BY kind,item_key') });
  }
  if (path === '/api/admin/site' && method === 'PUT') {
    await requireUser(request, env, new Set([OWNER])); const input = await body(request), site = { ...DEFAULT_SITE, ...(input.settings || {}) };
    if (!Array.isArray(site.modules) || !Array.isArray(site.resource_links)) throw new Error('页面配置格式不完整');
    const old = await settings(env.DB);
    await sql(env.DB, 'INSERT OR REPLACE INTO site_settings(id,draft,published,previous,admin_limit) VALUES(1,?,?,?,?)', JSON.stringify(site), JSON.stringify(old.published), old.previous ? JSON.stringify(old.previous) : null, old.admin_limit).run();
    return json({ saved: true, draft: site });
  }
  if (path === '/api/admin/site/publish' && method === 'POST') {
    await requireUser(request, env, new Set([OWNER])); const site = await settings(env.DB);
    await sql(env.DB, 'INSERT OR REPLACE INTO site_settings(id,draft,published,previous,admin_limit) VALUES(1,?,?,?,?)', JSON.stringify(site.draft), JSON.stringify(site.draft), JSON.stringify(site.published), site.admin_limit).run();
    return json({ published: true, settings: site.draft });
  }
  if (path === '/api/admin/site/restore' && method === 'POST') {
    await requireUser(request, env, new Set([OWNER])); const site = await settings(env.DB);
    if (!site.previous) throw new Error('没有可恢复的上一版本');
    await sql(env.DB, 'INSERT OR REPLACE INTO site_settings(id,draft,published,previous,admin_limit) VALUES(1,?,?,?,?)', JSON.stringify(site.previous), JSON.stringify(site.previous), JSON.stringify(site.published), site.admin_limit).run();
    return json({ restored: true, settings: site.previous });
  }
  if (path === '/api/admin/visibility' && method === 'POST') {
    await requireUser(request, env, new Set([OWNER])); const input = await body(request);
    if (!['article','guide','submission','module'].includes(input.kind) || !validKey(input.key)) throw new Error('公开状态设置无效');
    if (input.kind === 'module') {
      const site = await settings(env.DB), modules = site.draft.modules.map(m => m.id === input.key ? { ...m, visible: !!input.visible } : m);
      if (!modules.some(m => m.id === input.key)) throw new Error('功能模块不存在');
      await sql(env.DB, 'INSERT OR REPLACE INTO site_settings(id,draft,published,previous,admin_limit) VALUES(1,?,?,?,?)', JSON.stringify({ ...site.draft, modules }), JSON.stringify(site.published), site.previous ? JSON.stringify(site.previous) : null, site.admin_limit).run();
    } else await sql(env.DB, 'INSERT OR REPLACE INTO visibility(kind,item_key,visible) VALUES(?,?,?)', input.kind, input.key, input.visible ? 1 : 0).run();
    return json({ saved: true });
  }
  if (path === '/api/admin/owner/preview') { await requireUser(request, env, new Set([OWNER])); return json({ preview: true }); }

  if (path === '/api/admin/invites' && method === 'GET') { await requireUser(request, env, ADMIN); return json({ invites: (await all(env.DB, 'SELECT created_by,created_at,expires,max_uses,used FROM invites ORDER BY created_at DESC')).map(x => ({ ...x, active: x.expires > now() && x.used < x.max_uses })) }); }
  if (path === '/api/admin/invites' && method === 'POST') {
    await requireUser(request, env, ADMIN); const input = await body(request), uses = Number(input.uses || 10), days = Number(input.days || 14);
    if (!Number.isInteger(uses) || uses < 1 || uses > 200 || !Number.isInteger(days) || days < 1 || days > 90) throw new Error('名额需为 1–200，邀请码有效期需为 1–90 天');
    const code = uid().slice(0, 18), stamp = now(); await sql(env.DB, 'INSERT INTO invites VALUES(?,?,?,?,?,0)', await digest(code), identity.email, stamp, stamp + days * 86_400_000, uses).run();
    return json({ code, created_at: stamp, expires: stamp + days * 86_400_000, max_uses: uses, used: 0, url: `${url.origin}/?invite=${code}` });
  }
  if (path === '/api/admin/users/save' && method === 'POST') {
    await requireUser(request, env, new Set([OWNER])); const input = await body(request), email = validateEmail(input.username || input.email), role = input.role || 'user';
    if (!['user','editor','admin'].includes(role)) throw new Error('人员角色无效');
    const old = await first(env.DB, 'SELECT id,role,active FROM users WHERE email=?', email);
    if (old?.role === OWNER) throw Object.assign(new Error('不能通过人员管理修改站主账号'), { status: 403 });
    const active = input.active === false || input.active === 'false' ? 0 : 1;
    const site = await settings(env.DB), count = await first(env.DB, "SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1");
    if (role === 'admin' && active && (old?.role !== 'admin' || !old.active) && site.admin_limit !== null && count.n >= site.admin_limit) throw new Error('管理员名额已满');
    if (old) await sql(env.DB, 'UPDATE users SET role=?,active=? WHERE email=?', role, active, email).run();
    else await sql(env.DB, 'INSERT INTO users(id,email,role,active,verified,created_at) VALUES(?,?,?,?,?,?)', uid(), email, role, active, 1, now()).run();
    return json({ saved: true });
  }
  if (path === '/api/admin/users/remove' && method === 'POST') {
    await requireUser(request, env, new Set([OWNER])); const input = await body(request), email = validateEmail(input.username || input.email);
    if (email === identity.email) throw new Error('请保留当前站主权限');
    const target = await first(env.DB, 'SELECT role FROM users WHERE email=?', email);
    if (target?.role === OWNER || (target?.role === 'admin' && identity.role !== OWNER)) throw Object.assign(new Error('只有站主可管理管理员账号'), { status: 403 });
    await sql(env.DB, "UPDATE users SET role='user',active=0 WHERE email=? AND role<>'owner'", email).run();
    await sql(env.DB, 'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)', email).run(); return json({ removed: true });
  }
  if (path === '/api/admin/ledger' || path === '/data/audit-v9.json') {
    await requireUser(request, env, STAFF);
    const base = await getJson(env.PRIVATE, 'runtime/ledger.json') || { total: 0, records: [], audit: {} };
    const records = new Map((Array.isArray(base.records) ? base.records : await allCatalogDocs(env)).map(doc => [String(doc.key), doc]));
    for (const item of await all(env.DB, 'SELECT key,payload,removed FROM articles')) {
      const article = JSON.parse(item.payload);
      records.set(String(item.key), { ...(records.get(String(item.key)) || {}), ...article, key: String(item.key), removed: !!item.removed });
    }
    const reviews = new Map((await all(env.DB, 'SELECT key,status,note,updated,reviewer FROM reviews')).map(x => [x.key, x]));
    base.records = [...records.values()].map(d => ({ ...d, removed: !!d.removed, review: reviews.get(String(d.key)) || { status: 'pending', note: '' } }));
    if (identity.role !== OWNER) base.records = await filterVisibleArticles(env, base.records);
    base.total = base.records.length; return json(base);
  }
  if (path === '/api/admin/review' && method === 'POST') {
    await requireUser(request, env, STAFF); const input = await body(request);
    if (!['pending','reviewed','followup'].includes(input.status)) throw new Error('请选择复核状态');
    await sql(env.DB, 'INSERT OR REPLACE INTO reviews(key,status,note,updated,reviewer) VALUES(?,?,?,?,?)', String(input.key), input.status, String(input.note || ''), new Date().toISOString(), identity.email).run(); return json({ saved: true });
  }
  match = path.match(/^\/api\/admin\/article\/(get|save|remove|lookup)$/);
  if (match && method === 'POST') {
    await requireUser(request, env, STAFF); const input = await body(request), op = match[1];
    if (op === 'lookup') {
      const identifier = String(input.identifier || '').trim();
      if (!/^(?:[0-9]{1,12}|10\.\d{4,9}\/[-._;()/:A-Z0-9]+)$/i.test(identifier)) throw new Error('请输入有效 PMID 或 DOI');
      const query = /^\d+$/.test(identifier) ? `EXT_ID:${identifier} AND SRC:MED` : `DOI:"${identifier}"`;
      const lookupUrl = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
      lookupUrl.search = new URLSearchParams({ query, format: 'json', resultType: 'core', pageSize: '1' });
      const response = await fetch(lookupUrl, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Europe PMC 当前不可用，请稍后重试');
      const record = (await response.json()).resultList?.result?.[0];
      return record ? json({ record }) : json({ error: 'Europe PMC 未找到该论文' }, 404);
    }
    const key = String(input.key || input.pmid || input.doi || ''); if (!validKey(key)) throw new Error('文章编号无效');
    if (identity.role !== OWNER && !await articleIsPublic(env, key)) return json({ error: '文献不存在' }, 404);
    if (op === 'remove') { const old = await first(env.DB, 'SELECT payload FROM articles WHERE key=?', key); await sql(env.DB, 'INSERT OR REPLACE INTO articles(key,payload,removed,editor,updated) VALUES(?,?,1,?,?)', key, old?.payload || '{}', identity.email, new Date().toISOString()).run(); return json({ removed: true }); }
    if (op === 'get') {
      const base = await getJson(env.PRIVATE, 'runtime/catalog.json') || {}, article = (base.docs || []).find(d => String(d.key) === key || String(d.pmid) === key || String(d.doi) === key) || {};
      const contentKey = String(article.pmid || article.key || key), seeded = { ...article, abstract: base.abstracts?.[contentKey] || '', zh: base.translations?.[contentKey] || '' };
      const edited = await first(env.DB, 'SELECT payload FROM articles WHERE key=?', article.key || key);
      return json({ article: edited ? { ...seeded, ...JSON.parse(edited.payload) } : seeded });
    }
    const record = { ...input, key, topics: Array.isArray(input.topics) ? input.topics : String(input.topics || '').split(',').filter(Boolean) };
    await sql(env.DB, 'INSERT OR REPLACE INTO articles(key,payload,removed,editor,updated) VALUES(?,?,0,?,?)', key, JSON.stringify(record), identity.email, new Date().toISOString()).run(); return json({ article: record });
  }
  if (path === '/api/admin/publications' && method === 'GET') {
    await requireUser(request, env, ADMIN);
    const manifest = await getJson(env.PRIVATE, 'runtime/publications/manifest.json') || { summary: {}, records: [] };
    if (identity.role !== OWNER) manifest.records = await filterVisibleArticles(env, manifest.records || []);
    return json(manifest);
  }
  match = path.match(/^\/api\/admin\/publications\/([A-Za-z0-9_-]+)$/);
  if (match && method === 'GET') {
    await requireUser(request, env, ADMIN);
    if (identity.role !== OWNER && !await articleIsPublic(env, match[1])) return json({ error: '全文记录不存在' }, 404);
    const document = await getJson(env.PRIVATE, `runtime/publications/${match[1]}.json`);
    return document ? json(document) : json({ error: '全文记录不存在' }, 404);
  }

  if ((path === '/api/pdfs' || path.startsWith('/api/pdf/')) && !await visibleModule(env.DB, 'pdf')) return json({ error: 'PDF 模块暂未公开' }, 404);
  if (path === '/api/admin/usage' && method === 'GET') {
    await requireUser(request, env, new Set([OWNER]));
    const [users, pdfs, submissionsCount, storage] = await Promise.all([
      first(env.DB, 'SELECT COUNT(*) n FROM users'), first(env.DB, 'SELECT COUNT(*) n FROM user_pdfs'),
      first(env.DB, 'SELECT COUNT(*) n FROM submissions'), first(env.DB, "SELECT COALESCE(SUM(CAST(json_extract(metadata,'$.bytes') AS INTEGER)),0) n FROM user_pdfs"),
    ]);
    return json({ runtime: 'cloudflare', users: users.n, pdfs: pdfs.n, submissions: submissionsCount.n, storage_bytes: storage.n, storage_scope: 'D1 免费版个人 PDF；已公开附件使用独立引用保留', limits: { database_mb: 500, worker_requests_day: 100000, billing: 'free' }, errors: [] });
  }
  if (path === '/api/pdfs' && method === 'GET') {
    const rows = await all(env.DB, 'SELECT id,metadata FROM user_pdfs WHERE owner=? ORDER BY created DESC', identity.id).catch(() => []);
    return json({ documents: rows.map(r => { const { pages, tables, text, ...summary } = JSON.parse(r.metadata); return { ...summary, id: r.id, url: '/api/pdf/file/' + r.id }; }) });
  }
  if (path === '/api/pdf/uploads' && method === 'POST') {
    const input = await body(request), total = Number(input.bytes), name = String(input.name || 'document.pdf').slice(0,240);
    if (!Number.isInteger(total) || total < 5 || total > MAX_FILE_BYTES) return json({ error: 'PDF 大小需在 5 字节至 30 MB 之间' }, 413);
    const id = uid().slice(0,24), key = `users/${identity.id}/pdfs/${id}.pdf`;
    const upload = await env.PRIVATE.startUpload(key, total, 'application/pdf');
    await sql(env.DB, 'INSERT INTO pdf_uploads(id,owner,object_key,name,bytes,created) VALUES(?,?,?,?,?,?)', id, identity.id, key, name, total, new Date().toISOString()).run();
    return json({ id, chunk_size: upload.chunkSize, chunks: upload.chunks });
  }
  match = path.match(/^\/api\/pdf\/uploads\/([a-f0-9]{24})$/);
  if (match && method === 'DELETE') {
    const row = await first(env.DB, 'SELECT object_key FROM pdf_uploads WHERE id=? AND owner=?', match[1], identity.id);
    if (row) {
      await env.PRIVATE.delete(row.object_key);
      await sql(env.DB, 'DELETE FROM pdf_uploads WHERE id=? AND owner=?', match[1], identity.id).run();
    }
    return json({ removed: true });
  }
  match = path.match(/^\/api\/pdf\/uploads\/([a-f0-9]{24})\/(?:chunks\/(\d+)|(complete))$/);
  if (match && ((match[2] !== undefined && method === 'PUT') || (match[3] && method === 'POST'))) {
    const row = await first(env.DB, 'SELECT * FROM pdf_uploads WHERE id=? AND owner=?', match[1], identity.id);
    if (!row) return json({ error: '上传记录不存在' }, 404);
    if (match[2] !== undefined) {
      const raw = await request.arrayBuffer();
      if (raw.byteLength > CHUNK_SIZE) return json({ error: '文件分块超过大小限制' }, 413);
      if (Number(match[2]) === 0 && new TextDecoder().decode(raw.slice(0,5)) !== '%PDF-') return json({ error: '文件不是 PDF 格式' }, 400);
      await env.PRIVATE.putChunk(row.object_key, Number(match[2]), raw);
      return json({ saved: true });
    }
    await env.PRIVATE.completeUpload(row.object_key);
    const metadata = { id: row.id, name: row.name, title: row.name, page_count: 0, table_count: 0, created: row.created, bytes: row.bytes, url: '/api/pdf/file/' + row.id };
    await env.DB.batch([
      sql(env.DB, 'INSERT INTO user_pdfs(id,owner,object_key,metadata,created) VALUES(?,?,?,?,?)', row.id, identity.id, row.object_key, JSON.stringify(metadata), row.created),
      sql(env.DB, 'DELETE FROM pdf_uploads WHERE id=?', row.id),
    ]);
    return json(metadata);
  }
  if (path === '/api/pdf/upload' && method === 'POST') {
    const raw = await request.arrayBuffer(); if (raw.byteLength > 30 * 1024 * 1024) return json({ error: 'PDF 超过 30 MiB 上传限制' }, 413);
    if (new Uint8Array(raw,0,Math.min(5,raw.byteLength)).length < 5 || new TextDecoder().decode(raw.slice(0,5)) !== '%PDF-') throw new Error('文件内容不是 PDF');
    const id = uid().slice(0,24), name = decodeURIComponent(request.headers.get('x-filename') || 'document.pdf').slice(0,240), key = `users/${identity.id}/pdfs/${id}.pdf`;
    await env.PRIVATE.put(key, raw, { httpMetadata: { contentType: 'application/pdf' } });
    const metadata = { id, name, title: name, page_count: 0, table_count: 0, created: new Date().toISOString(), bytes: raw.byteLength, url: '/api/pdf/file/' + id };
    await sql(env.DB, 'INSERT INTO user_pdfs(id,owner,object_key,metadata,created) VALUES(?,?,?,?,?)', id, identity.id, key, JSON.stringify(metadata), metadata.created).run();
    return json(metadata);
  }
  match = path.match(/^\/api\/pdf\/(?:document|file)\/([a-f0-9]{24})$/);
  if (match && method === 'GET') {
    const row = await first(env.DB, 'SELECT object_key,metadata,owner FROM user_pdfs WHERE id=?', match[1]);
    if (!row) return json({ error: 'PDF 不存在' }, 404);
    if (row.owner!==identity.id&&!await sharedPdfAllowed(env.DB,match[1],identity.id)) return json({error:'PDF 不存在'},404);
    if (path.includes('/file/')) return pdfResponse(request, env.PRIVATE, row.object_key, match[1]);
    return json({ ...JSON.parse(row.metadata), id: match[1], url: '/api/pdf/file/' + match[1] });
  }
  match = path.match(/^\/api\/pdf\/document\/([a-f0-9]{24})$/);
  if (match && method === 'POST') {
    const row = await first(env.DB, 'SELECT metadata FROM user_pdfs WHERE id=? AND owner=?', match[1], identity.id); if (!row) return json({ error: 'PDF 不存在' }, 404);
    const extracted = await body(request), metadata = { ...JSON.parse(row.metadata), ...extracted, id: match[1], url: '/api/pdf/file/' + match[1] };
    await sql(env.DB, 'UPDATE user_pdfs SET metadata=? WHERE id=? AND owner=?', JSON.stringify(metadata), match[1], identity.id).run(); return json(metadata);
  }
  if (path === '/api/pdf/fetch' && method === 'POST') {
    const input = await body(request), pmid = String(input.pmid || '');
    const record = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent('EXT_ID:' + pmid + ' AND SRC:MED')}&format=json&resultType=core&pageSize=1`).then(r => r.ok ? r.json() : null);
    const source = record?.resultList?.result?.[0]; if (!source) return json({ unavailable: true, message: '未找到公开全文', source_url: `https://europepmc.org/article/MED/${encodeURIComponent(pmid)}` });
    const pdfUrl = (source.fullTextUrlList?.fullTextUrl || []).find(x => x.documentStyle === 'pdf' && x.availabilityCode === 'OA')?.url || (source.pmcid ? `https://europepmc.org/articles/${encodeURIComponent(source.pmcid)}?pdf=render` : null);
    if (!pdfUrl) return json({ unavailable: true, message: '出版方没有提供公开 PDF', source_url: source.doi ? 'https://doi.org/' + source.doi : `https://europepmc.org/article/MED/${pmid}` });
    const response = await fetch(pdfUrl); if (!response.ok || !(response.headers.get('content-type') || '').includes('pdf')) return json({ unavailable: true, message: '本次未取得 PDF', source_url: pdfUrl });
    if (url.searchParams.get('download') === '1') return new Response(response.body, { headers: {
      'content-type': 'application/pdf',
      'x-pdf-metadata': encodeURIComponent(JSON.stringify({ title: String(source.title || ''), doi: source.doi || '', source: { pmid, url: pdfUrl } })),
    } });
    const raw = await response.arrayBuffer(); if (raw.byteLength > 30 * 1024 * 1024 || new TextDecoder().decode(raw.slice(0,5)) !== '%PDF-') return json({ unavailable: true, message: '公开 PDF 超出大小限制或格式不正确', source_url: pdfUrl });
    const id = uid().slice(0,24), key = `users/${identity.id}/pdfs/${id}.pdf`; await env.PRIVATE.put(key,raw,{httpMetadata:{contentType:'application/pdf'}});
    const metadata = { id, name: `PMID-${pmid}.pdf`, title: String(source.title || ''), doi: source.doi || '', source: { pmid, url: pdfUrl }, created: new Date().toISOString(), bytes: raw.byteLength, url: '/api/pdf/file/' + id };
    await sql(env.DB,'INSERT INTO user_pdfs(id,owner,object_key,metadata,created) VALUES(?,?,?,?,?)',id,identity.id,key,JSON.stringify(metadata),metadata.created).run(); return json(metadata);
  }
  if (path === '/api/pdf/remove' && method === 'POST') {
    const input = await body(request), row = await first(env.DB, 'SELECT object_key FROM user_pdfs WHERE id=? AND owner=?', input.id, identity.id);
    if (row) { await env.PRIVATE.delete(row.object_key); await sql(env.DB, 'DELETE FROM user_pdfs WHERE id=? AND owner=?', input.id, identity.id).run(); }
    return json({ removed: true });
  }

  if (path === '/api/submissions' && method === 'GET') return json({ records: await submissions(env.DB, identity.id) });
  if (path === '/api/submissions' && method === 'POST') {
    const input = await body(request), article = input.article || {};
    if (!String(article.title || '').trim() || !(article.doi || article.pmid || article.source_url)) throw new Error('请填写已发表论文题名及 DOI、PMID 或原文链接');
    const id = uid().slice(0,24), payload = { ...input, id, article, pdf_id: input.pdf_id || '' }, stamp = new Date().toISOString();
    if (payload.pdf_id) { const pdf = await first(env.DB, 'SELECT id FROM user_pdfs WHERE id=? AND owner=?', payload.pdf_id, identity.id); if (!pdf) throw new Error('所选 PDF 不属于此账号'); }
    if (payload.share_pdf && !payload.sharing_permission) throw new Error('分享 PDF 前请填写允许公开的来源或授权依据');
    await sql(env.DB, 'INSERT INTO submissions(id,owner,payload,status,created,updated) VALUES(?,?,? ,\'draft\',?,?)', id, identity.id, JSON.stringify(payload), stamp, stamp).run(); return json({ id, status: 'draft', ...payload });
  }
  match = path.match(/^\/api\/submissions\/([a-f0-9]{24})(?:\/(submit))?$/);
  if (match && method === 'GET') { const row = await first(env.DB, 'SELECT * FROM submissions WHERE id=? AND owner=?', match[1], identity.id); return row ? json({ ...JSON.parse(row.payload), id: row.id, status: row.status, review_note: row.review_note }) : json({ error: '投稿不存在' }, 404); }
  if (match && method === 'PUT' && !match[2]) {
    const input = await body(request), row = await first(env.DB, 'SELECT * FROM submissions WHERE id=? AND owner=?', match[1], identity.id); if (!row) return json({ error: '投稿不存在' }, 404);
    const payload = { ...JSON.parse(row.payload), ...input, id: row.id }, stamp = new Date().toISOString();
    if (payload.share_pdf && !payload.sharing_permission) throw new Error('分享 PDF 前请填写允许公开的来源或授权依据');
    await sql(env.DB, 'UPDATE submissions SET payload=?,status=\'draft\',updated=? WHERE id=? AND owner=?', JSON.stringify(payload), stamp, row.id, identity.id).run(); return json({ id: row.id, status: 'draft', ...payload });
  }
  if (match && match[2] && method === 'POST') {
    const row = await first(env.DB, 'SELECT id FROM submissions WHERE id=? AND owner=?', match[1], identity.id); if (!row) return json({ error: '投稿不存在' }, 404);
    await sql(env.DB, 'UPDATE submissions SET status=\'pending\',updated=? WHERE id=? AND owner=?', new Date().toISOString(), match[1], identity.id).run(); return json({ submitted: true, status: 'pending' });
  }
  if (path === '/api/public/submissions') {
    const records = [];
    for (const item of await submissions(env.DB, null, true)) if (await isVisible(env.DB,'submission',item.id)) records.push(item);
    return json({ records });
  }
  if (path === '/api/admin/submissions') {
    await requireUser(request, env, STAFF);
    const records = await submissions(env.DB), hidden = identity.role === OWNER ? new Set() : new Set((await all(env.DB, "SELECT item_key FROM visibility WHERE kind='submission' AND visible=0")).map(row => row.item_key));
    const visible = records.filter(item => !item.has_published || !hidden.has(String(item.id)));
    return json({ records: visible });
  }
  match = path.match(/^\/api\/(admin|public)\/submissions\/([a-f0-9]{24})\/pdf$/);
  if (match && method === 'GET') {
    const id = match[2]; await requireUser(request, env, STAFF);
    if (identity.role !== OWNER && !await isVisible(env.DB, 'submission', id)) return json({ error: '该投稿已隐藏' }, 404);
    const row = await first(env.DB, 'SELECT payload,owner FROM submissions WHERE id=?', id), item = row && JSON.parse(row.payload);
    if (!item?.pdf_id) return json({ error: 'PDF 不存在' }, 404);
    const pdf = await first(env.DB, 'SELECT object_key FROM user_pdfs WHERE id=? AND owner=?', item.pdf_id, row.owner);
    return pdf ? pdfResponse(request, env.PRIVATE, pdf.object_key, id) : json({error:'PDF 不存在'},404);
  }
  match = path.match(/^\/api\/admin\/submissions\/([a-f0-9]{24})\/review$/);
  if (match && method === 'POST') {
    await requireUser(request, env, ADMIN); const input = await body(request), row = await first(env.DB, 'SELECT * FROM submissions WHERE id=?', match[1]); if (!row) return json({error:'投稿不存在'},404);
    if (!['approved','returned'].includes(input.decision) || row.status !== 'pending') throw new Error('投稿状态不允许此审核操作');
    const payload = JSON.parse(row.payload), published = input.decision === 'approved' ? { ...payload, id: row.id, article: payload.article, status: 'approved', published_at: new Date().toISOString() } : null;
    if (published?.share_pdf) {
      if (!published.sharing_permission) throw new Error('分享 PDF 前请填写允许公开的来源或授权依据');
      const source = await first(env.DB, 'SELECT object_key FROM user_pdfs WHERE id=? AND owner=?', payload.pdf_id, row.owner);
      const sourceFile = source && await env.PRIVATE.get(source.object_key);
      if (!sourceFile) throw new Error('投稿关联的 PDF 已不存在，无法公开');
      published.pdf_snapshot_key = `published-pdfs/${row.id}-${payload.pdf_id}.pdf`;
      await env.PRIVATE.copy(source.object_key, published.pdf_snapshot_key);
    }
    await sql(env.DB, 'UPDATE submissions SET status=?,review_note=?,reviewer=?,updated=?,published=COALESCE(?,published) WHERE id=?', input.decision, String(input.note || ''), identity.email, new Date().toISOString(), published ? JSON.stringify(published) : null, row.id).run(); return json({ reviewed: true });
  }
  if (['/api/stats','/api/model-fit'].includes(path)) return json({ error: '请更新网页后使用浏览器本地分析引擎。' }, 410);
  return json({ error: '接口不存在' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      env = { ...env, PRIVATE: createPrivateStorage(env, new URL(request.url).origin) };
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return cleanResponse(await api(request, env));
      if (url.pathname.startsWith('/content/')) {
        const identity = await requireUser(request, env);
        const raw = url.pathname.slice('/content/'.length), key = decodeURIComponent(raw);
        if (!key || key.includes('..') || !key.startsWith(`users/${identity.id}/pdfs/`) || !key.endsWith('.pdf')) return json({ error: '资源不存在' }, 404);
        const object = await env.PRIVATE.get(key); if (!object) return json({ error: '资源不存在' }, 404);
        const headers = new Headers(); object.writeHttpMetadata(headers);
        return cleanResponse(new Response(object.body, { headers }));
      }
      return json({ error: '接口不存在' }, 404);
    } catch (error) {
      if (/D1|SQLITE_FULL|database or disk is full/i.test(error.message || '')) {const issue=databaseIssue(error);return cleanResponse(json(issue,issue.status));}
      return cleanResponse(json({ error: error.message || '请求未完成' }, error.status || 400, error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {}));
    }
  },
};
