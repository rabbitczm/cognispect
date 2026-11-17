const rows = async (db, query, ...values) => (await db.prepare(query).bind(...values).all()).results || [];
const ftsTerm = value => '"' + String(value || '').replace(/["\\\r\n]/g, ' ').trim() + '"';
const queryCounts=new Map();
let countRevision;

export async function searchLiterature(db, input = {}) {
  const field = ['title', 'authors', 'journal'].includes(input.field) ? input.field : '';
  const sourceGroups = (Array.isArray(input.groups) ? input.groups : []).map(group => group.map(term => String(term || '').trim()).filter(Boolean)).filter(group => group.length);
  const where = ["NOT EXISTS (SELECT 1 FROM visibility v WHERE v.visible=0 AND (v.item_key=r.paper_key OR v.item_key=r.pmid OR v.item_key=r.doi OR (r.paper_key LIKE 'submission-%' AND v.kind='submission' AND v.item_key=substr(r.paper_key,12))))"];
  const bind = [];
  if (input.key) {where.push('(r.paper_key=? OR r.pmid=? OR r.doi=?)');bind.push(input.key,input.key,input.key);}
  const cjk = /[\u3400-\u9fff]/;
  for (const group of sourceGroups) {
    const alternatives = [];
    for (const raw of group) {
      if (cjk.test(raw)) {
        const columns = field ? [field] : ['title','authors','journal','abstract','mesh'];
        alternatives.push('(' + columns.map(column => 'instr(r.' + column + ',?)>0').join(' OR ') + ')');
        bind.push(...columns.map(() => raw));
      } else {
        const term = ftsTerm(raw);
        alternatives.push('r.id IN (SELECT rowid FROM literature_search_fts WHERE literature_search_fts MATCH ?)');
        bind.push(field ? field + ' : ' + term : term);
      }
    }
    where.push('(' + alternatives.join(' OR ') + ')');
  }
  const from = Number(input.yearFrom) || 0, to = Number(input.yearTo) || 0;
  const date = input.dateBasis === 'issue' ? 'r.year' : "COALESCE(NULLIF(r.firstdate,''),CAST(r.year AS TEXT))";
  const year = input.dateBasis === 'issue' ? 'r.year' : 'CAST(substr('+date+',1,4) AS INTEGER)';
  where.push("COALESCE(json_extract(r.payload,'$.date_pending'),0)=0");
  if (from) { where.push(date + '>=?'); bind.push(input.dateBasis==='issue'?from:String(from)); }
  if (to) { where.push(date + '<=?'); bind.push(input.dateBasis==='issue'?to:String(to)+'-12-31'); }
  if (input.oa) where.push("json_extract(r.payload,'$.oa')=1");
  if (input.onlyV) where.push("CAST(COALESCE(json_extract(r.payload,'$.level'),1) AS INTEGER)>=3");
  if (input.hasAbstract) where.push("r.abstract!=''");
  if (input.zhOnly) where.push("COALESCE(json_extract(r.payload,'$.has_zh'),0)=1");
  for (const [name, column] of [['years',year],['journals','r.journal']]) if (input[name]?.length) {
    where.push(column+' IN ('+input[name].map(()=>'?').join(',')+')'); bind.push(...input[name]);
  }
  if (input.topics?.length) {where.push("EXISTS (SELECT 1 FROM json_each(r.payload,'$.topics') t WHERE t.value IN ("+input.topics.map(()=>'?').join(',')+'))');bind.push(...input.topics);}
  for (const term of input.exclude || []) {where.push("instr(lower(r.title||' '||r.authors||' '||r.journal),lower(?))=0");bind.push(term);}
  const modules = await db.prepare('SELECT published FROM site_settings WHERE id=1').first();
  if (modules && JSON.parse(modules.published).modules?.some(m=>m.id==='papers'&&m.visible===false)) where.push("r.paper_key NOT LIKE 'submission-%'");
  const condition = where.join(' AND '), limit = Math.max(1, Math.min(100, Number(input.limit) || 20)), page = Math.max(1, Number(input.page) || 1), offset = input.offset == null ? (page - 1) * limit : Number(input.offset);
  const titleTerms=sourceGroups.flat(),sortBind=[];
  const titleRank=titleTerms.length?'('+titleTerms.map(term=>{sortBind.push(term);return '(instr(lower(r.title),lower(?))>0)';}).join('+')+') DESC,':'';
  const relevance=!['oldest','year','cite','title'].includes(input.sort);
  const sort = input.sort === 'oldest' ? date + ' ASC' : input.sort === 'year' ? date + ' DESC' : input.sort === 'cite' ? "CAST(COALESCE(json_extract(r.payload,'$.cited'),0) AS INTEGER) DESC," + date + ' DESC' : input.sort === 'title' ? 'r.title COLLATE NOCASE ASC' : titleRank+date + ' DESC';
  const fromTable = 'literature_search_records r ';
  const revision=await db.prepare('SELECT revision FROM catalog_revision WHERE id=1').first();
  if(countRevision!==revision?.revision){countRevision=revision?.revision;queryCounts.clear();}
  const cacheKey=JSON.stringify([condition,bind,modules?.published]);
  const previous=queryCounts.get(cacheKey);
  const countJob=previous&&Date.now()-previous.time<60000?Promise.resolve({total:previous.total}):db.prepare('SELECT COUNT(*) AS total FROM ' + fromTable + 'WHERE ' + condition).bind(...bind).first().then(value=>{queryCounts.set(cacheKey,{total:value.total,time:Date.now()});return value;});
  const [count, selected] = await Promise.all([
    countJob,
    rows(db, 'SELECT r.* FROM ' + fromTable + 'WHERE ' + condition + ' ORDER BY ' + sort + ',r.paper_key ASC LIMIT ? OFFSET ?', ...bind, ...(relevance?sortBind:[]), limit, offset),
  ]);
  const docs = selected.map(row => {
    const value = JSON.parse(row.payload || '{}'), paper = value.article ? {...value.article,submission_id:value.id} : value;
    Object.assign(paper, {key:String(paper.key||row.paper_key),pmid:String(paper.pmid||row.pmid||''),doi:String(paper.doi||row.doi||''),year:String(paper.year||row.year||''),firstdate:String(paper.firstdate||row.firstdate||''),title:paper.title||row.title,authors:paper.authors||row.authors,journal:paper.journal||row.journal,abstract:paper.abstract||row.abstract,mesh:paper.mesh||row.mesh,has_abstract:!!(paper.abstract||row.abstract)});
    return paper;
  });
  const total = Number(count?.total || 0);
  return {docs,total,page,limit,pages:Math.ceil(total/limit)};
}
