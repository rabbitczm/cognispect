const assert = require("assert");
const AIQ = require("./aiq.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra !== undefined ? "  " + extra : "")); }
}

const names = (it) => it.concepts.map(c => c.c).sort();

// 1. 词表自身的完整性
check("词表不少于 80 条", AIQ.LEX.length >= 80, AIQ.LEX.length);
check("每条都有中文名与英文同义词",
  AIQ.LEX.every(x => x.c && x.e && x.e.length));
check("每条类别都在已知集合内",
  AIQ.LEX.every(x => ["disease", "modality", "task", "method", "issue", "guide", "data"].indexOf(x.k) >= 0));
check("中文名不重复",
  new Set(AIQ.LEX.map(x => x.c)).size === AIQ.LEX.length);
check("英文同义词不重复",
  new Set(AIQ.LEX.flatMap(x => x.e.map(e => e.toLowerCase()))).size
  === AIQ.LEX.flatMap(x => x.e).length);

// 2. 中文整句解析
const a = AIQ.aiParse("肺癌CT影像组学的可复现性问题");
check("中文句子认出 4 个概念", names(a).join(",") === ["CT", "可复现", "影像组学", "肺癌"].sort().join(","), names(a).join(","));
check("没认出未收录词", a.free.length === 0, JSON.stringify(a.free));
check("给出解析说明", /我把它拆成/.test(AIQ.aiExplain(a)));

// 3. 英文整句解析
const b = AIQ.aiParse("lung cancer radiomics reproducibility external validation");
check("英文句子认出病种与方法学",
  names(b).indexOf("肺癌") >= 0 && names(b).indexOf("影像组学") >= 0
  && names(b).indexOf("可复现") >= 0 && names(b).indexOf("外部验证") >= 0,
  names(b).join(","));

// 4. 修饰语：年份 / 排序 / 开放获取 / 核实
const c = AIQ.aiParse("近三年乳腺癌MRI外部验证，只要开放获取的");
check("年份限近三年", c.yearFrom === AIQ.CUR_YEAR - 2, c.yearFrom);
check("开放获取生效", c.oa === true);
check("概念含乳腺癌与 MRI", names(c).indexOf("乳腺癌") >= 0 && names(c).indexOf("MRI") >= 0);
const d = AIQ.aiParse("肺癌影像组学 高被引");
check("高被引改排序为 cited", d.sort === "cite", d.sort);
const e2 = AIQ.aiParse("肺癌 核实过的");
check("核实过只取 L3", e2.onlyV === true);

// 5. 未收录词进入 free
const f = AIQ.aiParse("肺癌CT 质子治疗");
check("未收录词单独列出", f.free.indexOf("质子治疗") >= 0, JSON.stringify(f.free));
check("未收录词不污染概念", names(f).join(",") === ["CT", "肺癌"].sort().join(","), names(f).join(","));

// 6. 多轮增量：去掉
const g0 = AIQ.aiParse("肺癌CT深度学习影像组学");
const g1 = AIQ.aiParse("去掉深度学习", g0);
check("去掉后少一个概念", names(g1).length === names(g0).length - 1, names(g1).join(","));
check("去掉的正是深度学习", names(g1).indexOf("深度学习") < 0);
check("解析记录写了移除动作", g1.note.some(n => /移除概念/.test(n)));

// 7. 多轮增量：换病种
const h1 = AIQ.aiParse("换成肝癌", g0);
check("换病种后只剩肝癌", names(h1).indexOf("肝癌") >= 0 && names(h1).indexOf("肺癌") < 0, names(h1).join(","));
check("其他概念保留", names(h1).indexOf("影像组学") >= 0);

// 8. 多轮增量：再窄一点
const i1 = AIQ.aiParse("再窄一点", g0);
check("收紧模式生效", i1.mode === "tight");
const looseQ = AIQ.aiQuery(g0);
const tightQ = AIQ.aiQuery(i1);
check("收紧后每组只用主同义词",
  tightQ.groups.every(g => g.length === 1) && looseQ.groups.some(g => g.length > 1));

// 9. 检索组结构：组内 OR、组间 AND
const q = AIQ.aiQuery(a);
check("每个概念一组", q.groups.length === a.concepts.length);
check("组内是英文同义词", q.groups.every(g => g.every(w => /[a-z]/i.test(w))));

// 10. PubMed 查询串
const pm = AIQ.aiPubmed(a);
check("PubMed 串用 Title/Abstract 字段", /\[Title\/Abstract\]/.test(pm), pm.slice(0, 60));
check("PubMed 串组内用 OR", / OR /.test(pm));
check("PubMed 串组间用 AND", /\) AND \(/.test(pm));
const pm2 = AIQ.aiPubmed(c);
check("带年份时追加日期限定", /\[Date - Publication\]/.test(pm2), pm2.slice(-80));

// 11. 空输入不崩
const z = AIQ.aiParse("");
check("空输入不抛错且概念为空", z.concepts.length === 0 && z.free.length === 0);
check("空输入有兜底说明", /没有认出可检索的概念/.test(AIQ.aiExplain(z)));

// 12. 停用词不进入 free
const s = AIQ.aiParse("帮我找一些关于肺癌的研究文章");
check("停用词被过滤", s.free.length === 0, JSON.stringify(s.free));
check("仍认出肺癌", names(s).indexOf("肺癌") >= 0);

console.log("\n" + (fail === 0 ? "OK: " + pass + "/" + (pass + fail) + " 项通过"
  : "FAILED: " + fail + "/" + (pass + fail) + " 项未通过"));
process.exit(fail === 0 ? 0 : 1);
