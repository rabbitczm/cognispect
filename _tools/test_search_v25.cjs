const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('_lib/aiq.js','utf8')+';globalThis.api=AIQ;',context);
const api=context.api;
const cases=[
 ['diabetic nephropathy','糖尿病肾病','diabetic nephropathy'],
 ['糖尿病肾病','糖尿病肾病','diabetic nephropathy'],
 ['diabetic retinopathy','糖尿病视网膜病变','diabetic retinopathy'],
 ['2型糖尿病','2型糖尿病','type 2 diabetes'],
 ['primary hypertension','原发性高血压','essential hypertension'],
 ['高血压','原发性高血压','essential hypertension'],
 ['pulmonary hypertension','肺动脉高压','pulmonary arterial hypertension'],
 ['肺动脉高压','肺动脉高压','pulmonary arterial hypertension'],
 ['portal hypertension','门静脉高压','portal hypertension'],
 ['IgA肾病','IgA肾病','IgA nephropathy'],
 ['膜性肾病','膜性肾病','membranous nephropathy'],
 ['妊娠期糖尿病','妊娠期糖尿病','gestational diabetes'],
 ['射血分数保留型心力衰竭','射血分数保留型心力衰竭','heart failure with preserved ejection fraction'],
 ['三阴性乳腺癌','三阴性乳腺癌','triple-negative breast cancer'],
 ['肾血管性高血压','肾血管性高血压','renovascular hypertension'],
];
for(const [query,concept,term] of cases){
 const intent=api.aiParse(query),found=intent.concepts.some(item=>item.c===concept);
 assert.ok(found,`${query} must resolve to ${concept}`);
 assert.ok(api.aiQuery(intent).groups.some(group=>group.some(word=>word.toLowerCase().includes(term.toLowerCase()))),`${query} must search its disease-specific synonym`);
}
const parsed=api.aiParse('diabetic nephropathy');
assert.equal(parsed.concepts.filter(item=>item.k==='disease').length,1,'a disease phrase should not degrade into generic words');
assert.ok(!api.aiQuery(parsed).groups.flat().includes('diabetic retinopathy'));
console.log(JSON.stringify({cases:cases.length,checks:['cross-language disease mapping','subtype preservation','systemic vs pulmonary and portal hypertension']}));
