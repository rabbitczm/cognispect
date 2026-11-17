const baseCache = new WeakMap();
import {publicState,staticLibraryPage,moduleAllowed} from './public-library.js';
const metaCache = new WeakMap();
async function read(env, key) { const object = await env.PRIVATE.get(key); return object ? object.json() : null; }
const rows = async (db, query) => (await db.prepare(query).all()).results || [];
async function base(env) {
  const key = env.ASSETS || env.PRIVATE;
  if (!baseCache.has(key)) baseCache.set(key, (async () => {
    const manifest = await read(env, 'runtime/library-pages/index.json');
    let index = await read(env, 'runtime/library-index.json');
    if (!index) index = await read(env, 'runtime/catalog.json') || {docs: []};
    return {manifest, index};
  })().catch(error => { baseCache.delete(key); throw error; }));
  return baseCache.get(key);
}
export async function libraryMeta(env) {
  const key = env.ASSETS || env.PRIVATE;
  if (!metaCache.has(key)) metaCache.set(key, read(env, 'runtime/library-pages/index.json').catch(error => { metaCache.delete(key); throw error; }));
  const [manifest, revision] = await Promise.all([metaCache.get(key), env.DB.prepare('SELECT revision FROM catalog_revision WHERE id=1').first()]);
  return {version: String(manifest?.version || 'legacy') + ':' + (revision?.revision || 0)};
}
export async function libraryIndex(env, includePrivate = false) {
  const {index} = await base(env);
  const [edits, hidden, published, settings] = await Promise.all([
    rows(env.DB, 'SELECT key,payload,removed FROM articles'),
    rows(env.DB, 'SELECT kind,item_key FROM visibility WHERE visible=0'),
    rows(env.DB, 'SELECT id,published FROM submissions WHERE published IS NOT NULL'),
    env.DB.prepare('SELECT published FROM site_settings WHERE id=1').first(),
  ]);
  const blocked = new Set(hidden.filter(x => x.kind === 'article').map(x => String(x.item_key)));
  const hiddenSubmissions = new Set(hidden.filter(x => x.kind === 'submission').map(x => String(x.item_key)));
  const modules = settings ? JSON.parse(settings.published).modules || [] : [];
  const map = new Map((index.docs || []).map(d => [String(d.key), {...d}]));
  for (const row of edits) {
    if (row.removed) { map.delete(String(row.key)); continue; }
    const value = JSON.parse(row.payload), old = map.get(String(row.key)) || {};
    map.set(String(row.key), {...old, ...value, key: String(row.key),
      has_abstract: Object.hasOwn(value, 'abstract') ? !!value.abstract : old.has_abstract,
      has_zh: Object.hasOwn(value, 'zh') ? !!value.zh : old.has_zh});
  }
  if (includePrivate || !modules.some(m => m.id === 'papers' && m.visible === false)) for (const row of published) {
    if (!includePrivate && hiddenSubmissions.has(row.id)) continue;
    const value = JSON.parse(row.published), article = value.article || value;
    map.set('submission-' + row.id, {...article, key: 'submission-' + row.id, submission_id: row.id, topics: article.topics || [], has_abstract: !!article.abstract, has_zh: !!article.zh});
  }
  const docs = [...map.values()].filter(d => includePrivate || ![d.key,d.pmid,d.doi].filter(Boolean).some(k => blocked.has(String(k))));
  return {docs, total: docs.length, ...(await libraryMeta(env))};
}
export async function libraryPage(env, includePrivate = false, offsetValue = 0, limitValue = 40, onlyKey = null) {
  if(!includePrivate){const state=await publicState(env);if(state){if(!moduleAllowed(state,'search'))return {docs:[],total:0,version:state.version,next:null};const value=await staticLibraryPage(env,state,offsetValue,limitValue,onlyKey);return {...value,abstracts:Object.fromEntries(value.docs.filter(d=>d.abstract).map(d=>[d.key,d.abstract])),translations:Object.fromEntries(value.docs.filter(d=>d.zh).map(d=>[d.key,d.zh])),translation_sources:Object.fromEntries(value.docs.filter(d=>d.zh).map(d=>[d.key,d.translation_source||''])),focus:{},verify:{},sources:[]};}}
  const indexed=await env.DB.prepare('SELECT paper_key FROM literature_search_records LIMIT 1').first();
  if(indexed&&!includePrivate){
    const offset=Math.max(0,Number(offsetValue)||0),limit=Math.max(1,Math.min(100,Number(limitValue)||40));
    const value=await searchLiterature(env.DB,{offset,limit,key:onlyKey}),docs=value.docs;
    const extras=await read(env,'runtime/reading-extras.json')||{};
    const keys=new Set(docs.flatMap(d=>[d.key,d.pmid].filter(Boolean).map(String)));
    return {docs,abstracts:Object.fromEntries(docs.filter(d=>Object.hasOwn(d,'abstract')).flatMap(d=>[...new Set([d.key,d.pmid].filter(Boolean))].map(k=>[k,d.abstract]))),translations:Object.fromEntries(docs.filter(d=>Object.hasOwn(d,'zh')).flatMap(d=>[...new Set([d.key,d.pmid].filter(Boolean))].map(k=>[k,d.zh]))),translation_sources:Object.fromEntries(docs.filter(d=>d.zh).map(d=>[d.key,d.translation_source||''])),focus:Object.fromEntries(Object.entries(extras.focus||{}).filter(([,d])=>keys.has(String(d.pmid||d.key)))),verify:Object.fromEntries(Object.entries(extras.verify||{}).filter(([key])=>keys.has(key))),sources:extras.sources||[],total:value.total,...await libraryMeta(env),next:offset+docs.length<value.total?offset+docs.length:null};
  }
  const {manifest, index} = await base(env);
  const all = await libraryIndex(env, includePrivate);
  const offset = Math.max(0, Number(offsetValue) || 0), limit = Math.max(1, Math.min(100, Number(limitValue) || 40));
  const selected = onlyKey ? all.docs.filter(d => [d.key,d.pmid,d.doi].map(String).includes(String(onlyKey))) : all.docs.slice(offset, offset + limit);
  const positions = new Map((index.docs || []).map((d,i) => [String(d.key), i]));
  const pages = [...new Set(selected.filter(d => positions.has(String(d.key))).map(d => Math.floor(positions.get(String(d.key)) / (manifest?.chunk_size || 100))))];
  const content = manifest ? await Promise.all(pages.map(i => read(env, `runtime/library-pages/${String(i).padStart(4,'0')}.json`))) : [index];
  const maps = {abstracts:{},translations:{},translation_sources:{},focus:{},verify:{}};
  const keys = new Set(selected.flatMap(d => [d.key,d.pmid].filter(Boolean).map(String)));
  for (const page of content.filter(Boolean)) for (const name of Object.keys(maps)) {
    Object.assign(maps[name], Object.fromEntries(Object.entries(page[name] || {}).filter(([key,value]) => name === 'focus' ? keys.has(String(value?.pmid || value?.key)) : keys.has(key))));
  }
  for (const doc of selected) {
    const key = String(doc.pmid || doc.key);
    if (Object.hasOwn(doc,'abstract')) maps.abstracts[key] = doc.abstract;
    if (Object.hasOwn(doc,'zh')) { maps.translations[key] = doc.zh; maps.translation_sources[key] = doc.translation_source ?? doc.abstract ?? ''; }
  }
  return {docs:selected, ...maps, sources:content.find(p => p?.sources?.length)?.sources || [], total:all.total, version:all.version, next:offset + selected.length < all.total ? offset + selected.length : null};
}
import { searchLiterature } from './literature-search.js';
