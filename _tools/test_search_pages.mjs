import assert from 'node:assert/strict';
import {paperPage,sitemapPage} from '../cloud/search-pages.js';
const docs=[{key:'123',pmid:'123',title:'Research <title>',authors:'医学团队',journal:'Medical Journal',year:'2024',firstdate:'2024-01-01',doi:'10.1/test'},{key:'pending',title:'待核',date_pending:true}];
const result={docs,abstracts:{123:'Original abstract & methods.'}};
const page=await paperPage(new Request('https://cognispect.tech/papers/123'),async()=>result,'123');
assert.equal(page.status,200);const html=await page.text();assert.match(html,/Research &lt;title&gt;/);assert.match(html,/Original abstract &amp; methods/);assert.match(html,/ScholarlyArticle/);assert.match(html,/rel="canonical" href="https:\/\/cognispect.tech\/papers\/123"/);
assert.equal((await paperPage(new Request('https://cognispect.tech/papers/hidden'),async()=>({docs:[]}),'hidden')).status,404);
const map=await sitemapPage(async()=>result);const xml=await map.text();assert.match(xml,/papers\/123/);assert.doesNotMatch(xml,/pending/);
console.log('PASS search engine paper HTML, provenance, hidden paper404 and visible sitemap');
