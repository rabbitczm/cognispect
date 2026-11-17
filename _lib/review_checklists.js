/* Source-linked, researcher-completed screening items; never calculate compliance. */
var ReviewChecklist=(()=>{
 const sources={
  consort:{guideline:'CONSORT 2025',url:'https://www.equator-network.org/reporting-guidelines/consort/',
   items:[['design','随机试验设计及分配比例是否明确？'],['registration','试验注册、方案及预设结局是否可查？'],['participants','受试者来源、纳排标准及研究场景是否说明？'],['randomization','随机序列生成与分配隐藏是否报告？'],['blinding','盲法对象及实施方法是否说明？'],['outcomes','主要/次要结局及预设时间点是否说明？'],['sample_size','样本量估算依据和目标效应是否报告？'],['flow','筛选、随机、随访和分析人数是否逐组列出？'],['harms','重要不良事件或伤害是否报告？'],['analysis','分析人群、统计方法、效应量与区间是否报告？'],['limitations','偏倚、限制、可推广性及资金来源是否说明？']]},
  strobe:{guideline:'STROBE',url:'https://www.equator-network.org/reporting-guidelines/strobe/',
   items:[['design','研究设计是否在标题或摘要中明确？'],['setting','场景、地点、日期及随访时段是否报告？'],['participants','研究对象、纳排标准、来源和选择过程是否报告？'],['variables','结局、暴露、预测变量及诊断标准是否定义？'],['measurement','各变量的数据来源与测量方法是否可比？'],['bias','潜在偏倚及控制方法是否说明？'],['size','研究样本量如何确定？'],['missing','缺失数据如何处理？'],['statistics','统计方法、混杂控制和亚组/敏感性分析是否报告？'],['flow','参与者人数、排除原因及各阶段流失是否报告？'],['estimates','效应估计、精度/置信区间、局限与外部适用性是否报告？'],['funding','资金来源及其作用是否说明？']]},
  prisma:{guideline:'PRISMA 2020',url:'https://www.equator-network.org/reporting-guidelines/prisma/',
   items:[['question','研究问题、纳入标准及结局是否预先说明？'],['protocol','方案、注册及与方案的偏离是否报告？'],['sources','数据库、注册平台、网站及最后检索日期是否列明？'],['search','完整可复现的各数据库检索式是否提供？'],['selection','筛选流程、全文排除理由及人数是否提供？'],['extraction','数据提取方法与字段是否说明？'],['bias','偏倚风险评价方法与逐研究结果是否报告？'],['synthesis','效应指标、合并方法、异质性与亚组分析是否说明？'],['reporting_bias','报告偏倚评估是否说明？'],['certainty','证据确定性评价方法是否说明？'],['results','纳入研究特征、结果及合成结果是否完整列出？'],['limitations','证据局限、综述流程局限、注册与资金是否说明？']]}
 };
 function evaluate(design,statuses={}){
  const spec=sources[design];if(!spec)throw new Error('请选择支持的研究设计');
  const items=spec.items.map(([id,question])=>{const v=statuses[id]||{};const status=['yes','no','unknown','na'].includes(v.status)?v.status:'unknown';
   return {id,question,status,evidence:String(v.evidence||'').slice(0,2000)};});
  return {design,guideline:spec.guideline,source:spec.url,items,
   recorded:items.filter(x=>x.status==='yes').length,incomplete:items.filter(x=>x.status==='no').length,
   unknown:items.filter(x=>x.status==='unknown').length,notApplicable:items.filter(x=>x.status==='na').length,
   scope:'按官方报告规范整理的人工自查项；不是完整核查清单、质量评分、偏倚风险工具或同行评审。'};
 }
 return {evaluate,definitions:sources};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewChecklist;
