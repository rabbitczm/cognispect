const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ReviewChecklist=require('../_lib/review_checklists.js');
for(const [design,count,label] of [['consort',10,'CONSORT'],['strobe',12,'STROBE'],['prisma',12,'PRISMA 2020']]){
 const fresh=ReviewChecklist.evaluate(design,{});
 assert.equal(fresh.design,design);
 assert.ok(fresh.items.length>=count,`${design} should have the source-informed core items`);
 assert.ok(fresh.items.every(x=>x.status==='unknown'));
 assert.equal(fresh.recorded,0);
 assert.equal(fresh.incomplete,0);
 assert.ok(fresh.guideline.includes(label));
 assert.match(fresh.source,/https:\/\/www\.equator-network\.org\//);
}
assert.equal(ReviewChecklist.evaluate('consort',{}).guideline,'CONSORT 2025');
const reviewed=ReviewChecklist.evaluate('strobe',{participants:{status:'yes',evidence:'纳入流程见 Figure 1'},bias:{status:'no',evidence:'待补失访分析'}});
assert.equal(reviewed.recorded,1);
assert.equal(reviewed.incomplete,1);
assert.equal(reviewed.unknown,reviewed.items.length-2);
assert.equal(reviewed.items.find(x=>x.id==='participants').evidence,'纳入流程见 Figure 1');
assert.ok(!Object.hasOwn(reviewed,'complianceScore'));
assert.throws(()=>ReviewChecklist.evaluate('invented',{}),/研究设计/);
console.log('PASS 3 official-guideline mappings, evidence states, source bounds, and no auto-score');
