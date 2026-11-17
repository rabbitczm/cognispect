export const GLOSSARY_VERSION='medical-2026-11-17';
const terms=[
 ['diabetic nephropathy','糖尿病肾病'],['diabetic kidney disease','糖尿病肾脏病'],['diabetic retinopathy','糖尿病视网膜病变'],
 ['essential hypertension','原发性高血压'],['primary hypertension','原发性高血压'],['pulmonary arterial hypertension','肺动脉高压'],['portal hypertension','门静脉高压'],
 ['IgA nephropathy','IgA肾病'],['membranous nephropathy','膜性肾病'],['glomerular filtration rate','肾小球滤过率'],['chronic kidney disease','慢性肾脏病'],
 ['hazard ratio','风险比'],['odds ratio','比值比'],['relative risk','相对风险'],['confidence interval','置信区间'],['heart rate','心率'],['cardiac index','心脏指数'],
 ['overall survival','总生存期'],['progression-free survival','无进展生存期'],['randomized controlled trial','随机对照试验'],['non-inferiority','非劣效性'],
 ['statistically significant','具有统计学意义'],['sensitivity','敏感度'],['specificity','特异度'],['adverse event','不良事件'],
 ['computed tomography','计算机断层成像'],['magnetic resonance imaging','磁共振成像'],['glomerulus','肾小球'],['myocardium','心肌'],
 ['metformin','二甲双胍'],['dapagliflozin','达格列净'],['canagliflozin','卡格列净'],['insulin','胰岛素'],['placebo','安慰剂'],
 ['albuminuria','白蛋白尿'],['proteinuria','蛋白尿'],['end-stage kidney disease','终末期肾脏病'],['retrospective cohort','回顾性队列'],['prospective cohort','前瞻性队列'],
];
export const medicalTerms=terms.map(([en,zh])=>({en,zh,source_url:'https://www.ncbi.nlm.nih.gov/mesh/?term='+encodeURIComponent(en),chinese_reference:'https://www.termonline.cn/'}));
export function relevantTerms(text){const lower=String(text).toLowerCase();return medicalTerms.filter(t=>lower.includes(t.en.toLowerCase())||text.includes(t.zh));}
