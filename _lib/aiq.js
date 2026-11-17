/* HELIX 本地检索意图解析器。
 *
 * 不调用任何外部模型：词表是人工维护的，规则是可读的，结果可解释、可测试。
 * 已登记术语可解释；相对年份（近两年）以运行时年份为准。
 *
 * 对外：LEX / aiParse(text, prev) / aiQuery(intent) / aiExplain(intent) / aiPubmed(intent)
 */
var AIQ = (function () {
  "use strict";

  // c=中文主名 k=类别 e=英文同义词 a=中文别名
  var LEX = [
    // 经人工审阅的检索术语；症状和未定性结节不升级为癌症诊断。
    {"c": "肺癌", "k": "disease", "e": ["lung cancer", "lung carcinoma", "pulmonary carcinoma"], "a": ["肺部恶性肿瘤"]},
    {"c": "非小细胞肺癌", "k": "disease", "e": ["non-small cell lung cancer", "non-small-cell lung cancer", "NSCLC"], "a": []},
    {"c": "小细胞肺癌", "k": "disease", "e": ["small cell lung cancer", "SCLC"], "a": []},
    {"c": "肺腺癌", "k": "disease", "e": ["lung adenocarcinoma", "pulmonary adenocarcinoma"], "a": []},
    {"c": "肺鳞癌", "k": "disease", "e": ["lung squamous cell carcinoma"], "a": ["肺鳞状细胞癌"]},
    {"c": "肺结节", "k": "disease", "e": ["pulmonary nodule", "lung nodule", "pulmonary nodules", "lung nodules"], "a": ["肺部结节", "孤立性肺结节", "肺上有个结节", "肺上有个小结节"]},
    {"c": "磨玻璃结节", "k": "disease", "e": ["ground-glass nodule", "ground glass nodule", "ground-glass nodules"], "a": ["磨玻璃样结节", "磨玻璃肺结节"]},
    {"c": "乳腺癌", "k": "disease", "e": ["breast cancer", "breast carcinoma"], "a": ["乳癌"]},
    {"c": "乳腺结节", "k": "disease", "e": ["breast nodule", "breast mass", "breast lesion"], "a": ["乳房结节", "乳腺肿块"]},
    {"c": "肝癌", "k": "disease", "e": ["liver cancer", "hepatic cancer"], "a": ["原发性肝癌"]},
    {"c": "肝细胞癌", "k": "disease", "e": ["hepatocellular carcinoma", "HCC"], "a": []},
    {"c": "胶质瘤", "k": "disease", "e": ["glioma", "gliomas"], "a": ["脑胶质瘤"]},
    {"c": "胶质母细胞瘤", "k": "disease", "e": ["glioblastoma", "GBM"], "a": []},
    {"c": "脑转移", "k": "disease", "e": ["brain metastasis", "brain metastases"], "a": ["脑转移瘤"]},
    {"c": "前列腺癌", "k": "disease", "e": ["prostate cancer", "prostate carcinoma", "prostatic neoplasms"], "a": ["前列腺恶性肿瘤"]},
    {"c": "结直肠癌", "k": "disease", "e": ["colorectal cancer", "colorectal carcinoma"], "a": ["大肠癌"]},
    {"c": "结肠癌", "k": "disease", "e": ["colon cancer", "colon carcinoma"], "a": []},
    {"c": "直肠癌", "k": "disease", "e": ["rectal cancer", "rectal carcinoma"], "a": []},
    {"c": "胃癌", "k": "disease", "e": ["gastric cancer", "stomach cancer"], "a": []},
    {"c": "食管癌", "k": "disease", "e": ["esophageal cancer", "oesophageal cancer"], "a": ["食道癌"]},
    {"c": "宫颈癌", "k": "disease", "e": ["cervical cancer", "cervical carcinoma"], "a": ["子宫颈癌"]},
    {"c": "胰腺癌", "k": "disease", "e": ["pancreatic cancer", "pancreatic carcinoma"], "a": []},
    {"c": "肾癌", "k": "disease", "e": ["renal cell carcinoma", "kidney cancer"], "a": ["肾细胞癌"]},
    {"c": "甲状腺结节", "k": "disease", "e": ["thyroid nodule", "thyroid nodules"], "a": []},
    {"c": "甲状腺癌", "k": "disease", "e": ["thyroid cancer", "thyroid carcinoma"], "a": []},
    {"c": "骨肉瘤", "k": "disease", "e": ["osteosarcoma"], "a": []},
    {"c": "淋巴瘤", "k": "disease", "e": ["lymphoma"], "a": []},
    {"c": "脑卒中", "k": "disease", "e": ["stroke", "cerebrovascular accident"], "a": ["中风"]},
    {"c": "脑梗死", "k": "disease", "e": ["cerebral infarction", "ischemic stroke", "ischaemic stroke"], "a": ["脑梗", "缺血性脑卒中"]},
    {"c": "阿尔茨海默病", "k": "disease", "e": ["Alzheimer", "Alzheimer disease"], "a": ["阿尔兹海默病"]},
    {"c": "痴呆", "k": "disease", "e": ["dementia"], "a": []},
    {"c": "新冠肺炎", "k": "disease", "e": ["COVID-19", "SARS-CoV-2"], "a": ["新冠"]},
    {"c": "骨折", "k": "disease", "e": ["fracture", "fractures"], "a": ["骨裂"]},
    {"c": "肝纤维化", "k": "disease", "e": ["liver fibrosis", "hepatic fibrosis"], "a": []},
    {"c": "肝硬化", "k": "disease", "e": ["liver cirrhosis", "hepatic cirrhosis", "cirrhosis"], "a": []},
    {"c": "肺炎", "k": "disease", "e": ["pneumonia"], "a": []},
    {"c": "肺结核", "k": "disease", "e": ["pulmonary tuberculosis"], "a": ["肺部结核"]},
    {"c": "慢阻肺", "k": "disease", "e": ["chronic obstructive pulmonary disease", "COPD"], "a": ["慢性阻塞性肺疾病", "慢阻肺病"]},
    {"c": "哮喘", "k": "disease", "e": ["asthma"], "a": ["支气管哮喘"]},
    {"c": "糖尿病肾病", "k": "disease", "e": ["diabetic nephropathy", "diabetic kidney disease", "diabetic renal disease"], "a": ["糖肾"]},
    {"c": "糖尿病视网膜病变", "k": "disease", "e": ["diabetic retinopathy"], "a": ["糖网"]},
    {"c": "1型糖尿病", "k": "disease", "e": ["type 1 diabetes", "type 1 diabetes mellitus", "type i diabetes"], "a": ["1型糖尿病", "一型糖尿病"]},
    {"c": "2型糖尿病", "k": "disease", "e": ["type 2 diabetes", "type 2 diabetes mellitus", "type ii diabetes"], "a": ["二型糖尿病"]},
    {"c": "糖尿病", "k": "disease", "e": ["diabetes", "diabetes mellitus"], "a": []},
    {"c": "妊娠期糖尿病", "k": "disease", "e": ["gestational diabetes", "gestational diabetes mellitus"], "a": ["妊娠糖尿病"]},
    {"c": "糖尿病神经病变", "k": "disease", "e": ["diabetic neuropathy", "diabetic neuropathies"], "a": ["糖尿病周围神经病变"]},
    {"c": "糖尿病足", "k": "disease", "e": ["diabetic foot", "diabetic foot ulcer"], "a": []},
    {"c": "IgA肾病", "k": "disease", "e": ["IgA nephropathy", "immunoglobulin A nephropathy"], "a": ["IgA 肾病", "免疫球蛋白A肾病"]},
    {"c": "膜性肾病", "k": "disease", "e": ["membranous nephropathy", "membranous glomerulonephritis"], "a": []},
    {"c": "局灶节段性肾小球硬化", "k": "disease", "e": ["focal segmental glomerulosclerosis", "FSGS"], "a": ["局灶性节段性肾小球硬化"]},
    {"c": "微小病变肾病", "k": "disease", "e": ["minimal change disease", "minimal change nephropathy"], "a": ["微小病变型肾病"]},
    {"c": "狼疮性肾炎", "k": "disease", "e": ["lupus nephritis"], "a": []},
    {"c": "急性肾损伤", "k": "disease", "e": ["acute kidney injury", "acute renal injury"], "a": ["AKI"]},
    {"c": "慢性肾病", "k": "disease", "e": ["chronic kidney disease", "chronic renal disease"], "a": ["慢性肾脏病", "CKD"]},
    {"c": "肾病综合征", "k": "disease", "e": ["nephrotic syndrome"], "a": []},
    {"c": "高血压肾病", "k": "disease", "e": ["hypertensive nephropathy", "hypertensive nephrosclerosis"], "a": ["高血压性肾病"]},
    {"c": "原发性高血压", "k": "disease", "e": ["essential hypertension", "primary hypertension", "systemic arterial hypertension", "primary systemic hypertension"], "a": ["高血压", "原发性高血压", "hypertension"]},
    {"c": "继发性高血压", "k": "disease", "e": ["secondary hypertension"], "a": ["继发性高血压"]},
    {"c": "肾血管性高血压", "k": "disease", "e": ["renovascular hypertension"], "a": []},
    {"c": "原发性醛固酮增多症", "k": "disease", "e": ["primary aldosteronism", "primary hyperaldosteronism"], "a": ["原醛症"]},
    {"c": "心力衰竭", "k": "disease", "e": ["heart failure", "cardiac failure"], "a": ["心衰"]},
    {"c": "射血分数保留型心力衰竭", "k": "disease", "e": ["heart failure with preserved ejection fraction", "HFpEF"], "a": ["射血分数保留的心力衰竭", "射血分数保留型心衰"]},
    {"c": "射血分数降低型心力衰竭", "k": "disease", "e": ["heart failure with reduced ejection fraction", "HFrEF"], "a": ["射血分数降低的心力衰竭", "射血分数降低型心衰"]},
    {"c": "三阴性乳腺癌", "k": "disease", "e": ["triple-negative breast cancer", "triple negative breast cancer", "TNBC"], "a": []},
    {"c": "克罗恩病", "k": "disease", "e": ["Crohn disease", "Crohn's disease"], "a": ["克隆病"]},
    {"c": "溃疡性结肠炎", "k": "disease", "e": ["ulcerative colitis"], "a": []},
    {"c": "肺动脉高压", "k": "disease", "e": ["pulmonary arterial hypertension", "pulmonary hypertension", "PAH"], "a": ["肺动脉高压", "肺高压"]},
    {"c": "门静脉高压", "k": "disease", "e": ["portal hypertension"], "a": ["门静脉高压"]},
    {"c": "冠心病", "k": "disease", "e": ["coronary artery disease", "coronary heart disease"], "a": []},
    {"c": "帕金森病", "k": "disease", "e": ["Parkinson disease", "Parkinson's disease"], "a": ["帕金森"]},
    {"c": "咳嗽", "k": "disease", "e": ["cough", "coughing"], "a": []},
    {"c": "胸痛", "k": "disease", "e": ["chest pain"], "a": ["胸口痛"]},
    {"c": "呼吸困难", "k": "disease", "e": ["dyspnea", "dyspnoea", "shortness of breath"], "a": ["气短", "喘不上气"]},
    {"c": "头痛", "k": "disease", "e": ["headache"], "a": ["头疼"]},
    {"c": "发热", "k": "disease", "e": ["fever", "pyrexia"], "a": ["发烧"]},
    {"c": "腹痛", "k": "disease", "e": ["abdominal pain"], "a": ["肚子疼"]},

    // 影像模态与数据类型
    { c: "CT", k: "modality", e: ["computed tomography", "CT"], a: ["计算机断层", "增强CT", "低剂量CT"] },
    { c: "MRI", k: "modality", e: ["magnetic resonance imaging", "MRI", "MR imaging"], a: ["核磁", "磁共振", "核磁共振"] },
    { c: "PET", k: "modality", e: ["positron emission tomography", "PET", "FDG-PET"], a: ["PET-CT", "派特"] },
    { c: "超声", k: "modality", e: ["ultrasound", "ultrasonography", "sonography"], a: ["彩超", "B超", "超声造影"] },
    { c: "钼靶", k: "modality", e: ["mammography", "mammogram"], a: ["乳腺钼靶", "乳腺X线"] },
    { c: "X线", k: "modality", e: ["radiography", "X-ray", "chest radiograph"], a: ["平片", "胸片"] },
    { c: "病理切片", k: "modality", e: ["whole slide image", "histopathology", "digital pathology", "WSI"], a: ["全切片", "数字病理", "病理图像"] },
    { c: "内镜", k: "modality", e: ["endoscopy", "endoscopic imaging"], a: ["胃镜", "肠镜"] },
    { c: "OCT", k: "modality", e: ["optical coherence tomography", "OCT"], a: [] },
    { c: "多模态", k: "modality", e: ["multimodal", "multi-modal", "multimodality"], a: ["多模式", "影像组学联合临床"] },

    // 任务
    { c: "分割", k: "task", e: ["segmentation", "delineation", "contouring"], a: ["勾画", "靶区勾画"] },
    { c: "分类", k: "task", e: ["classification"], a: ["分型"] },
    { c: "检测", k: "task", e: ["detection"], a: ["检出"] },
    { c: "预后", k: "task", e: ["prognosis", "prognostic", "prognostic model"], a: ["预后模型"] },
    { c: "生存分析", k: "task", e: ["survival analysis", "overall survival", "progression-free survival"], a: ["生存期", "OS", "PFS"] },
    { c: "疗效预测", k: "task", e: ["treatment response", "response prediction", "neoadjuvant"], a: ["新辅助", "化疗反应"] },
    { c: "复发预测", k: "task", e: ["recurrence prediction", "recurrence"], a: ["复发"] },
    { c: "分级", k: "task", e: ["grading", "histological grade"], a: ["分级诊断"] },
    { c: "分期", k: "task", e: ["staging", "TNM"], a: ["TNM分期"] },
    { c: "筛查", k: "task", e: ["screening", "early detection"], a: ["早筛", "早期筛查"] },
    { c: "诊断", k: "task", e: ["diagnosis", "diagnostic"], a: ["鉴别诊断"] },
    { c: "风险预测", k: "task", e: ["risk prediction", "risk stratification"], a: ["危险分层"] },
    { c: "标注", k: "task", e: ["annotation", "labelling", "ground truth"], a: ["标注数据", "金标准"] },

    // 方法与模型
    { c: "深度学习", k: "method", e: ["deep learning", "neural network"], a: ["神经网络", "CNN", "端到端"] },
    { c: "影像组学", k: "method", e: ["radiomics", "radiomic"], a: ["放射组学", "纹理分析"] },
    { c: "基础模型", k: "method", e: ["foundation model", "pretrained model", "self-supervised pretraining"], a: ["大模型", "预训练模型"] },
    { c: "迁移学习", k: "method", e: ["transfer learning", "fine-tuning"], a: ["微调"] },
    { c: "联邦学习", k: "method", e: ["federated learning"], a: ["分布式学习"] },
    { c: "Transformer", k: "method", e: ["transformer", "vision transformer"], a: ["注意力"] },
    { c: "卷积神经网络", k: "method", e: ["convolutional neural network", "CNN", "U-Net"], a: ["U型网络"] },
    { c: "自监督", k: "method", e: ["self-supervised", "contrastive learning"], a: ["对比学习"] },
    { c: "大语言模型", k: "method", e: ["large language model", "LLM", "GPT"], a: ["语言模型", "聊天机器人"] },
    { c: "图神经网络", k: "method", e: ["graph neural network", "GNN"], a: [] },
    { c: "机器学习", k: "method", e: ["machine learning", "random forest", "SVM", "XGBoost"], a: ["随机森林", "支持向量机"] },
    { c: "可解释性", k: "method", e: ["explainable", "interpretability", "SHAP", "saliency"], a: ["可解释", "解释性"] },

    // 方法学议题
    { c: "可复现", k: "issue", e: ["reproducibility", "reproducible", "repeatability", "reproducibility crisis"], a: ["重复性", "复现", "可重复"] },
    { c: "外部验证", k: "issue", e: ["external validation", "independent validation", "validation cohort"], a: ["独立验证", "外部测试"] },
    { c: "过拟合", k: "issue", e: ["overfitting", "overfit"], a: ["过适配"] },
    { c: "校准", k: "issue", e: ["calibration", "calibration curve", "Brier score"], a: ["校准曲线", "校准度"] },
    { c: "决策曲线", k: "issue", e: ["decision curve analysis", "DCA", "net benefit"], a: ["临床决策曲线", "净收益"] },
    { c: "类别不平衡", k: "issue", e: ["class imbalance", "imbalanced dataset"], a: ["样本不平衡"] },
    { c: "标注一致性", k: "issue", e: ["inter-observer", "intra-observer", "interobserver agreement", "observer variability", "Dice"], a: ["观察者间", "观察者内", "一致性", "标注者差异"] },
    { c: "批次效应", k: "issue", e: ["batch effect", "harmonization", "ComBat", "scanner variability"], a: ["扫描仪差异", "设备差异", "中心效应"] },
    { c: "数据泄漏", k: "issue", e: ["data leakage", "feature selection bias", "selection bias"], a: ["信息泄漏", "泄漏"] },
    { c: "样本量", k: "issue", e: ["sample size", "small sample", "power calculation"], a: ["样本估算", "小样本"] },
    { c: "偏倚", k: "issue", e: ["risk of bias", "bias assessment", "QUADAS"], a: ["偏倚风险"] },
    { c: "泛化能力", k: "issue", e: ["generalization", "generalizability", "domain shift"], a: ["泛化", "跨中心泛化"] },
    { c: "质量评价", k: "issue", e: ["quality assessment", "radiomics quality score", "RQS", "METRICS"], a: ["质量评分", "方法学质量"] },
    { c: "统计效能", k: "issue", e: ["statistical power", "confidence interval"], a: ["置信区间", "效能"] },

    // 报告规范
    { c: "TRIPOD", k: "guide", e: ["TRIPOD", "TRIPOD+AI", "TRIPOD-AI"], a: ["TRIPOD声明"] },
    { c: "CLAIM", k: "guide", e: ["CLAIM", "checklist for artificial intelligence in medical imaging"], a: ["CLAIM清单"] },
    { c: "STARD", k: "guide", e: ["STARD"], a: [] },
    { c: "CLEAR", k: "guide", e: ["CLEAR", "checklist for evaluation of radiomics"], a: [] },
    { c: "IBSI", k: "guide", e: ["IBSI", "image biomarker standardization initiative"], a: ["影像生物标志物标准化"] },
    { c: "PICO", k: "guide", e: ["PICO", "PICOS"], a: [] },

    // 数据类型与研究设计
    { c: "公开数据集", k: "data", e: ["public dataset", "open dataset", "benchmark dataset", "data availability"], a: ["开源数据集", "公开数据"] },
    { c: "多中心", k: "data", e: ["multicenter", "multi-centre", "multicentric", "multi-institutional"], a: ["多个中心", "跨中心"] },
    { c: "单中心", k: "data", e: ["single-center", "single-centre"], a: ["单家医院"] },
    { c: "LIDC", k: "data", e: ["LIDC", "LIDC-IDRI"], a: ["LIDC数据集"] },
    { c: "TCGA", k: "data", e: ["TCGA", "the cancer genome atlas"], a: [] },
    { c: "队列", k: "data", e: ["cohort", "retrospective cohort", "prospective cohort"], a: ["回顾性队列", "前瞻性队列"] },
    { c: "前瞻性", k: "data", e: ["prospective", "prospectively"], a: ["前瞻"] },
    { c: "回顾性", k: "data", e: ["retrospective", "retrospectively"], a: ["回顾"] },
    { c: "系统综述", k: "data", e: ["systematic review", "meta-analysis", "meta analysis"], a: ["荟萃分析", "元分析", "综述"] },
    { c: "指南共识", k: "data", e: ["guideline", "consensus statement", "recommendation"], a: ["专家共识", "指南"] }
  ];

  // 只调排序/筛选、不参与语义匹配的修饰语
  var MODS = [
    { re: /(近|最近|过去)\s*(两|二|2)\s*年/, act: function (it) { it.yearFrom = CUR_YEAR - 1; it.note.push("年份限近两年（≥" + it.yearFrom + "）"); } },
    { re: /(近|最近|过去)\s*(三|3)\s*年/, act: function (it) { it.yearFrom = CUR_YEAR - 2; it.note.push("年份限近三年（≥" + it.yearFrom + "）"); } },
    { re: /(近|最近|过去)\s*(五|5)\s*年/, act: function (it) { it.yearFrom = CUR_YEAR - 4; it.note.push("年份限近五年（≥" + it.yearFrom + "）"); } },
    { re: /(近|最近|过去)\s*(十|10)\s*年/, act: function (it) { it.yearFrom = CUR_YEAR - 9; it.note.push("年份限近十年（≥" + it.yearFrom + "）"); } },
    { re: /20(\d\d)\s*年?(以后|之后|起)/, act: function (it, m) { it.yearFrom = 2000 + parseInt(m[1], 10); it.note.push("年份限 ≥" + it.yearFrom); } },
    { re: /(高被引|被引最多|最经典|引用最多|经典)/, act: function (it) { it.sort = "cite"; it.note.push("按被引数降序"); } },
    { re: /(最新|最近发表|新近|前沿)/, act: function (it) { it.sort = "year"; it.note.push("按年份降序"); } },
    { re: /(开放获取|免费全文|能下载全文|公开全文)/, act: function (it) { it.oa = true; it.note.push("只要开放获取"); } },
    { re: /(核实过|逐字核实|确认过|已核对|不能瞎编|可信的)/, act: function (it) { it.onlyV = true; it.note.push("只要重点题录已核对的记录（不代表内容已验证）"); } },
    { re: /(有摘要|带摘要|能看摘要)/, act: function (it) { it.hasAbs = true; it.note.push("只要有摘要的"); } },
    { re: /(再窄|更窄|更精确|收窄|精确一点|缩小范围)/, act: function (it) { it.mode = "tight"; it.note.push("收紧：要求标题里出现主概念"); } },
    { re: /(放宽|多一点|多些|扩大范围|宽松)/, act: function (it) { it.mode = "loose"; it.note.push("放宽：组内同义词全部启用"); } }
  ];

  var CUR_YEAR = new Date().getFullYear();

  // 中文里不承载检索意义的词。中文没有空格分词，靠这张表把句子的骨架刮掉。
  var STOP_CN = /(我检查出来有|检查出来|检查发现|医生说|我有|我的|有没有|想了解|了解|帮忙|最近总是|相关的|相关论文|相应论文|给出|简述|证据|怎么办|是什么|多少位患者|多少个结节|有多大风险|帮我|给我|我想|想要|我要|找一些|找点|找找|查一下|查查|检索|搜索|搜一下|搜搜|关于|有关|相关|以及|或者|一些|哪些|什么|如何|怎么|多少|一下|看看|需要|可以|请|文献|文章|论文|研究|资料|内容|报告|进展|现状|应用|技术|方法|分析|问题)/g;

  // 残留虚字：刮完停用词后常见的尾巴，剥掉再看长度
  function cleanFree(w) {
    return String(w)
      .replace(/^(的|了|和|与|及|是|在|对|从|把|被)+/, "")
      .replace(/(的|性|了|化|度)+$/, "");
  }

  function norm(s) {
    return String(s || "")
      .replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
      .replace(/\s+/g, " ")
      .trim();
  }

  function findConcept(tok) {
    var low = tok.toLowerCase();
    for (var i = 0; i < LEX.length; i++) {
      var it = LEX[i];
      if (it.c.toLowerCase() === low) return it;
      for (var j = 0; j < it.a.length; j++) {
        if (it.a[j].toLowerCase() === low) return it;
      }
      for (var m = 0; m < it.e.length; m++) {
        if (it.e[m].toLowerCase() === low) return it;
      }
    }
    return null;
  }

  function hitConcept(text, item) {
    var low = text.toLowerCase();
    if (item.c && text.indexOf(item.c) >= 0) return item.c;
    for (var i = 0; i < item.a.length; i++) {
      if (text.indexOf(item.a[i]) >= 0) return item.a[i];
    }
    for (var j = 0; j < item.e.length; j++) {
      var en = item.e[j].toLowerCase();
      // 英文按词边界匹配，避免 "CT" 命中 "reconstruction"
      var re = new RegExp("(^|[^a-z0-9])" + en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)");
      if (re.test(low)) return item.e[j];
    }
    return null;
  }

  function emptyIntent() {
    return {
      concepts: [],   // [{c,k,e}] 去重后的概念
      free: [],       // 未识别的原词
      yearFrom: 0,
      oa: false, onlyV: false, hasAbs: false,
      sort: "rel",
      mode: "loose",
      note: []
    };
  }

  function addConcept(it, item) {
    for (var i = 0; i < it.concepts.length; i++) {
      if (it.concepts[i].c === item.c) return false;
    }
    it.concepts.push({ c: item.c, k: item.k, e: item.e.slice() });
    return true;
  }

  // 拆词：中文按非汉字边界切，英文按空白与标点切
  function tokens(text) {
    var parts = text.split(/[\s,，、;；。.!?？!]+/).filter(Boolean);
    return parts;
  }

  function aiParse(text, prev) {
    var raw = norm(text), corrections=[];
    var typoMap={"肺结接":"肺结节","肺节结":"肺结节","甲状现":"甲状腺","糖尿并":"糖尿病","肺部结接":"肺部结节","radiomcis":"radiomics","lung cnacer":"lung cancer"};
    Object.keys(typoMap).sort(function(a,b){return b.length-a.length;}).forEach(function(from){
      if(raw.indexOf(from)>=0){raw=raw.split(from).join(typoMap[from]);corrections.push({from:from,to:typoMap[from]});}
    });
    var it = prev ? JSON.parse(JSON.stringify(prev)) : emptyIntent();
    if (!prev) it.note = [];
    it.corrections=corrections;
    it.normalized=raw;
    var used = raw;

    // 增量指令：去掉 / 不要 / 排除
    var dropRe = /(?:去掉|不要|排除|删掉|除了|不含)\s*([^\s,，。、;；]+)/g, dm;
    var dropped = [];
    while ((dm = dropRe.exec(raw))) {
      var dItem = findConcept(dm[1]);
      if (dItem) {
        var before = it.concepts.length;
        it.concepts = it.concepts.filter(function (x) { return x.c !== dItem.c; });
        if (it.concepts.length < before) dropped.push(dItem.c);
        used = used.replace(dm[0], " ");
      }
    }
    if (dropped.length) it.note.push("移除概念：" + dropped.join("、"));

    // 增量指令：换成 X（替换同一类别下的概念）
    var swapRe = /(?:换成|改成|改为|只看)\s*([^\s,，。、;；]+)/g, sm;
    while ((sm = swapRe.exec(raw))) {
      var sItem = findConcept(sm[1]);
      if (sItem) {
        it.concepts = it.concepts.filter(function (x) { return x.k !== sItem.k; });
        addConcept(it, sItem);
        it.note.push("把「" + sItem.k + "」类换成：" + sItem.c);
        used = used.replace(sm[0], " ");
      }
    }

    // 修饰语
    for (var i = 0; i < MODS.length; i++) {
      var m = raw.match(MODS[i].re);
      if (m) {
        MODS[i].act(it, m);
        used = used.replace(m[0], " ");
      }
    }

    // 概念命中
    var added = [];
    var candidates=[];
    LEX.forEach(function(item){[item.c].concat(item.a,item.e).forEach(function(term){
      var escaped=term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      var reg=new RegExp(escaped,"gi"),m;
      while((m=reg.exec(used))){
        if(/[a-z0-9]/i.test(term[0]) && m.index>0 && /[a-z0-9]/i.test(used[m.index-1])) continue;
        if(/[a-z0-9]/i.test(term[term.length-1]) && /[a-z0-9]/i.test(used[m.index+term.length]||"")) continue;
        candidates.push({item:item,start:m.index,end:m.index+term.length});
      }
    });});
    candidates.sort(function(a,b){return (b.end-b.start)-(a.end-a.start);});
    var selected=[];
    candidates.forEach(function(hit){
      if(selected.some(function(x){return x.start<hit.end && hit.start<x.end;})) return;
      selected.push(hit);
      if(addConcept(it,hit.item))added.push(hit.item.c);
    });
    if (added.length) it.note.push("识别出概念：" + added.join("、"));

    // 剩余未识别词：先把已命中概念的词面抹掉，剩下的才是真正没收录的
    var leftover = used;
    selected.sort(function(a,b){return b.start-a.start;}).forEach(function(hit){leftover=leftover.slice(0,hit.start)+" "+leftover.slice(hit.end);});
    var rest = leftover
      .replace(STOP_CN, " ")
      .replace(/[、，,;；。.!?？!"'()（）]/g, " ")
      .split(/\s+/)
      .map(cleanFree)
      .filter(function (w) {
        return w.length > 1 && !/^\d+$/.test(w);
      });
    var freeAdd = [];
    for (var k = 0; k < rest.length; k++) {
      var w = rest[k];
      if (findConcept(w)) continue;
      if (it.free.indexOf(w) < 0) { it.free.push(w); freeAdd.push(w); }
    }
    if (freeAdd.length) it.note.push("未收录词按原样检索：" + freeAdd.join(" "));

    return it;
  }

  // 概念 → 检索组。组内 OR，组间 AND。
  function aiQuery(it) {
    var groups = [];
    for (var i = 0; i < it.concepts.length; i++) {
      var c = it.concepts[i];
      var words = it.mode === "tight" ? [c.e[0]] : c.e.slice(0, 4);
      groups.push(words);
    }
    it.free.forEach(function(w){groups.push([w]);});
    return {
      groups: groups,
      yearFrom: it.yearFrom || 0,
      oa: !!it.oa,
      onlyV: !!it.onlyV,
      hasAbs: !!it.hasAbs,
      sort: it.sort || "rel"
    };
  }

  function aiExplain(it) {
    if (!it.concepts.length && !it.free.length) {
      return "这句话里我没有认出可检索的概念。可以把病种、模态、任务或方法学议题说得更具体些，例如「肺癌 CT 影像组学 外部验证」。";
    }
    var byKind = { disease: "病种", modality: "模态", task: "任务", method: "方法", issue: "方法学议题", guide: "报告规范", data: "研究设计" };
    var parts = [];
    for (var i = 0; i < it.concepts.length; i++) {
      var c = it.concepts[i];
      parts.push(c.c + "（" + (byKind[c.k] || c.k) + "，英文取 " + c.e[0] + "）");
    }
    var s = "我把它拆成 " + it.concepts.length + " 个概念：" + parts.join("；") + "。";
    s += " 组内同义词取「或」，组间取「与」——意思是这几层意思都要同时出现，措辞可以不一样。";
    if (it.free.length) s += " 未收录的词（" + it.free.join("、") + "）按原样参与检索，可能命中很少，可以删掉或换成本词典里的说法。";
    return s;
  }

  function aiPubmed(it) {
    var q = aiQuery(it);
    var bits = [];
    for (var i = 0; i < q.groups.length; i++) {
      var terms = q.groups[i].map(function (w) { return '"' + w + '"[Title/Abstract]'; });
      bits.push("(" + terms.join(" OR ") + ")");
    }
    if (!bits.length) return "";
    var tail = bits.join(" AND ");
    if (q.yearFrom) tail += ' AND ("' + q.yearFrom + '"[Date - Publication] : "3000"[Date - Publication])';
    return tail;
  }

  return { LEX: LEX, aiParse: aiParse, aiQuery: aiQuery, aiExplain: aiExplain, aiPubmed: aiPubmed, CUR_YEAR: CUR_YEAR };
})();

if (typeof module !== "undefined" && module.exports) module.exports = AIQ;
