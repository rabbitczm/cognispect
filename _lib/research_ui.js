/* Research workbench. Data claims link to saved records or named official sources. */
var ResearchUI=(()=>{
  'use strict';
  const R=ResearchCore,G=ReviewChecklist;
  const $=s=>document.querySelector(s);
  const safe=s=>esc(String(s??''));
  const ui={question:'',answer:'',error:'',notice:'',pending:false,refs:[],intent:null,preparedQuestion:'',
    stats:null,statsError:'',review:null,reviewDesign:'strobe',reviewDraft:null,reviewPaper:null,
    lab:null,points:[],mask:null,readerKey:'21452728',readerMarkColor:'red',readerSelection:null,
    filterOpen:false,dataKind:'individual',provenance:null,ordered:false,mode:'groups',chartData:'',chartType:'combo',robustness:false,modelError:'',modelStatus:''};
  const settings=ApiModels.settings;
  function saveWorkspace(){const keys=['chartData','mode','dataKind','provenance','ordered','chartType','robustness'];PersonalStore.setItem('helix.stats.draft.v17',JSON.stringify(Object.fromEntries(keys.map(k=>[k,ui[k]]))));PersonalStore.setItem('helix.stats.result.v17',JSON.stringify(ui.stats));}
  function restoreWorkspace(){const draft=JSON.parse(PersonalStore.getItem('helix.stats.draft.v17')||'{}');Object.assign(ui,draft);ui.stats=JSON.parse(PersonalStore.getItem('helix.stats.result.v17')||'null');ui.reviewDraft=null;ui.reviewStorageKey=null;}
  let activeRequest=null,requestVersion=0;
  const head=(title,desc,section)=>`<div class="work-head"><div><div class="overline">${safe(section)}</div><h1>${safe(title)}</h1>${desc?`<p>${safe(desc)}</p>`:''}</div><span class="stamp">知镜 / 研究工具</span></div>`;
  const sourceLinks=(ids)=>`<div class="source-links">${ids.map(id=>{
    const d=SCIENCE_SOURCES.find(x=>x.id===id);return d?`<a href="${safe(d.url)}" target="_blank" rel="noopener noreferrer">${safe(d.name)} ↗</a><a href="${safe(d.paper_url)}" target="_blank" rel="noopener noreferrer">PMID ${safe(d.pmid)} ↗</a>`:'';
  }).join('')}</div>`;
  const note=(s)=>`<div class="warning-strip">${s}</div>`;
  function refsHtml(refs){return `<ol class="context-list">${refs.map((d,i)=>`<li><button ${d.pdfId?'data-pdf-record':'data-record'}="${safe(d.pdfId||d.key)}">[${i+1}] ${safe(d.title)}</button><small>${safe(d.authors)} · ${safe(d.journal)} · ${safe(d.year)} · PMID ${safe(d.pmid)}</small><a href="${d.pdfId?'/api/pdf/file/'+encodeURIComponent(d.pdfId):'https://europepmc.org/article/MED/'+encodeURIComponent(d.pmid)}" target="_blank" rel="noopener noreferrer">${d.pdfId?'导入 PDF':'官方记录'} ↗</a> · ${d.qaExcerpt?(d.pdfId?'已提供带页码正文':'摘要节选已提供'):'仅题录'}</li>`).join('')}</ol>`;}
  function assistant(){
    const refs=ui.refs;
    return `<div class="work-page">${head('AI 证据问答','','文献辅助')}
      <div class="assistant-model-status"><span class="status-dot"></span>${safe(ApiModels.label())} · ${safe(settings.model)}<span class="connection-status">${safe(ApiModels.connectionStatus())}</span><button class="textlink" data-go="models">设置</button></div><div class="work-grid evidence-layout${refs.length?' has-evidence':''}"><section class="glass panel question-panel">
        ${ui.document||ui.paperKey?`<div class="question-source"><span>当前文献 · ${safe(ui.document?.title||LIB.find(d=>d.key===ui.paperKey)?.title)}</span><button class="textlink" id="clearQuestionSource">移除</button></div>`:''}<div class="work-field"><label for="researchQuestion">病症、影像或研究问题</label><textarea id="researchQuestion" placeholder="例如：肺上有个小结节，影像组学研究有哪些标注一致性问题？">${safe(ui.question)}</textarea></div>
        <div class="question-examples">${['肺结节影像组学有哪些局限？','乳腺癌 MRI 相关研究','脑卒中 CT 影像'].map(q=>`<button data-question="${safe(q)}" class="expchip">${safe(q)}</button>`).join('')}</div>
        <div class="row"><button class="btn" id="researchAsk" ${ui.pending?'disabled':''}>生成简述</button><button class="btn ghost" id="researchPreview" ${ui.pending?'disabled':''}>先看匹配文献</button>${ui.pending?'<button class="btn ghost" id="researchStop">停止生成</button>':''}</div>
        ${ui.intent?`<div class="intent-strip"><span>理解为</span>${ui.intent.concepts.map(c=>`<span class="chip">${safe(c.c)}</span>`).join('')||'<span>按原词检索</span>'}${(ui.intent.corrections||[]).length?'<small>检测到常见拼写变化，请核对主题。</small>':''}</div>`:''}
        ${ui.pending?'<div class="loading-bar"></div><div class="hint">正在查找材料并请求模型...</div>':''}
        ${ui.notice?`<div class="work-success">${safe(ui.notice)}</div>`:''}${ui.error?`<div class="work-error">${safe(ui.error)}</div>`:''}
        ${ui.pending?`<div class="streaming" id="researchResponse">${safe(ui.answer)}</div>`:ui.answer?`${answerBlock()}`:''}
        <div class="assistant-secondary"><button class="textlink" id="researchDesktop">复制材料并打开 DeepSeek ↗</button><a href="mailto:210438161@qq.com" class="contact-link">联系与反馈 · 210438161@qq.com</a><button class="textlink" id="copyContact">复制邮箱</button></div>
      </section><aside class="work-stack">${refs.length?`<div class="glass panel"><h2>本次论文依据</h2>${refsHtml(refs)}</div>`:''}
</aside></div></div>`;
  }
  function answerBlock(){
    const answer=safe(ui.answer).replace(/\[(\d+)\]/g,(token,n)=>ui.refs[Number(n)-1]?`<button class="citation-link" ${ui.refs[Number(n)-1].pdfId?'data-pdf-record':'data-record'}="${safe(ui.refs[Number(n)-1].pdfId||ui.refs[Number(n)-1].key)}">${token}</button>`:token);
    return `<div class="qatext">${answer}</div>`;
  }
  const reader=()=>ReaderUI.render();
  const reviewStore='helix.reviews.v16';
  const reviewKey=paper=>String(paper?.id||paper?.title||'draft').trim().toLowerCase();
  function reviewLibrary(){return JSON.parse(PersonalStore.getItem(reviewStore)||'{}');}
  function blankReview(paper={id:'',title:''}){return {design:'strobe',paper:{...paper},scope:{},byDesign:{},memo:''};}
  function readReviewDraft(){
    if(ui.reviewDraft)return ui.reviewDraft;
    let library=reviewLibrary();
    if(!Object.keys(library).length){const old=JSON.parse(PersonalStore.getItem('helix.review.v12')||'null');if(old){library[reviewKey(old.paper)]=old;PersonalStore.setItem(reviewStore,JSON.stringify(library));}}
    const key=PersonalStore.getItem('helix.review.active.v16')||Object.keys(library)[0]||'draft';
    ui.reviewStorageKey=key;ui.reviewDraft=library[key]||blankReview();ui.reviewDesign=ui.reviewDraft.design||'strobe';return ui.reviewDraft;
  }
  function saveReviewDraft(){const library=reviewLibrary(),key=ui.reviewStorageKey||reviewKey(ui.reviewDraft.paper);library[key]=ui.reviewDraft;PersonalStore.setItem(reviewStore,JSON.stringify(library));PersonalStore.setItem('helix.review.active.v16',key);}
  function flowSvg(){return `<svg class="science-flow" viewBox="0 0 660 126" role="img" aria-label="研究流程：问题、标注、特征、验证、复盘"><path d="M43 64 H610" stroke="currentColor" stroke-opacity=".3" stroke-width="2"/><path d="M70 64 H595" stroke="currentColor" stroke-width="2" stroke-dasharray="4 10" style="animation:flowLine 8s linear infinite"/>${['问题','标注','特征','验证','复盘'].map((t,i)=>`<circle cx="${70+i*130}" cy="64" r="21" fill="var(--surface2)" stroke="currentColor" stroke-opacity=".45"/><text x="${70+i*130}" y="70" text-anchor="middle" fill="var(--tx)" font-size="12">${t}</text>`).join('')}</svg>`;}
  function stats(){return `<div class="work-page stats-workspace">${head('统计与绘图','','数据分析')}<div class="stats-columns">
    <section class="glass stats-data-panel"><div class="stats-data-head"><h2>数据与分析</h2><button class="textlink" id="statsExample">载入示例</button></div>
     <label class="stats-file-drop" for="statsFile"><svg class="ic" aria-hidden="true"><use href="#i-book"/></svg><strong>选择或拖入文件</strong><span>CSV 数据 · PDF 文献</span><input id="statsFile" type="file" accept=".csv,text/csv,.pdf,application/pdf"></label>
     ${ui.provenance?`<div class="data-provenance">${safe(ui.provenance.title||ui.provenance.name||'导入文件')}${ui.provenance.page?` · 第 ${safe(ui.provenance.page)} 页 · 表 ${safe(ui.provenance.table)}`:''}</div>`:''}
     <div class="work-field"><label for="statsDataKind">每行数据表示</label><select id="statsDataKind"><option value="individual"${ui.dataKind==='individual'?' selected':''}>一个独立个体 / 观测</option><option value="aggregate"${ui.dataKind==='aggregate'?' selected':''}>一个汇总值（均值、计数等）</option></select></div>
     <div class="work-field"><label for="statsMode">分析方式</label><select id="statsMode">${(ui.dataKind==='aggregate'?[['summary','汇总值绘图']]:[['groups','组间均值与分布'],['correlation','Pearson 相关'],['roc','评分 ROC / AUC']]).map(([id,label])=>`<option value="${id}"${ui.mode===id?' selected':''}>${label}</option>`).join('')}</select></div>
     <div class="work-field"><label for="statsCsv">数据预览与编辑</label><textarea id="statsCsv" spellcheck="false" placeholder="group,value&#10;A,1.2&#10;A,1.4&#10;B,2.1&#10;B,2.6">${safe(ui.chartData)}</textarea><span class="hint">列名：${ui.mode==='groups'||ui.mode==='summary'?'group,value':ui.mode==='correlation'?'x,y':'label,score'}</span></div>
     <label class="stats-check"><input id="statsOrdered" type="checkbox" ${ui.ordered?'checked':''}>组别具有明确顺序（等距类别轴）</label>
     <div class="stats-actions"><label class="stats-check"><input id="statsRobustness" type="checkbox" ${ui.robustness?'checked':''} ${ui.mode!=='groups'?'disabled':''}>两组稳健性分析</label><button class="btn" id="statsRun">${ui.mode==='summary'?'生成图表':'计算分析'}</button></div>
     ${ui.statsError?`<div class="work-error" role="alert">${safe(ui.statsError)}</div>`:''}
    </section><div id="statsOutput">${ui.stats?statsResult(ui.stats):'<section class="glass stats-empty"><div class="empty-chart-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><h2>让数据呈现出来</h2><p>导入文件，或载入一组示例开始分析。</p><div class="chart-empty-types">条形图 / 圆形图 / 散点图 / 复合图</div></section>'}</div></div></div>`;}
  function parseChartCsv(text){const source=String(text).split(/\r?\n/).filter(line=>!line.trimStart().startsWith('#')).join('\n'),rows=[];let row=[],cell='',quoted=false;
   for(let i=0;i<source.length;i++){const ch=source[i];if(quoted){if(ch==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}else if(ch==='"'&&!cell)quoted=true;else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(ch!=='\r')cell+=ch;}
   if(cell||row.length){row.push(cell);rows.push(row);}const header=(rows.shift()||[]).map(x=>x.trim());return rows.filter(r=>r.some(x=>String(x).trim())).map(r=>Object.fromEntries(header.map((h,i)=>[h,(r[i]||'').trim()])));}
  const chartColors=['#39776d','#c07957','#68879b','#b69a58','#886e8c','#73865d','#bd6e75','#738097'];
  function axisSvg({values,W=920,H=440,left=78,right=26,top=32,bottom=72,xLabel='Group',yLabel='Value',labels=[],includeZero=false}){
   let lo=Math.min(...values),hi=Math.max(...values);if(!Number.isFinite(lo)||!Number.isFinite(hi)){lo=0;hi=1;}if(includeZero){lo=Math.min(lo,0);hi=Math.max(hi,0);}if(lo===hi){const d=Math.max(1,Math.abs(lo)*.1);lo-=d;hi+=d;}const pad=(hi-lo)*.12;lo-=pad;hi+=pad;if(includeZero&&Math.min(...values)>=0)lo=0;if(includeZero&&Math.max(...values)<=0)hi=0;
   const y=v=>top+(hi-v)/(hi-lo)*(H-top-bottom),xx=i=>left+(i+.5)/(labels.length||1)*(W-left-right),parts=[];
   for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,Y=y(v);parts.push(`<path d="M${left} ${Y}H${W-right}" stroke="#72817b" opacity=".18"/><text x="${left-12}" y="${Y+4}" text-anchor="end">${safe(Number(v.toPrecision(4)))}</text>`);}
   parts.push(`<path d="M${left} ${top}V${H-bottom}H${W-right}" fill="none" stroke="#75837e" opacity=".55"/>`);
   labels.forEach((t,i)=>parts.push(`<text x="${xx(i)}" y="${H-bottom+23}" text-anchor="middle"><title>${safe(t)}</title>${safe(t.length>15?t.slice(0,14)+'…':t)}</text>`));
   parts.push(`<text x="${(left+W-right)/2}" y="${H-10}" text-anchor="middle">${safe(xLabel)}</text><text transform="translate(18 ${(top+H-bottom)/2}) rotate(-90)" text-anchor="middle">${safe(yLabel)}</text>`);
   return {parts,x:xx,y,lo,hi,W,H,left,right,top,bottom};
  }
  function chartSvg(x,type){const rows=x.rows,W=920,H=440;
   if(x.mode==='summary'){
    const a=axisSvg({values:rows.map(r=>r.value),labels:rows.map(r=>r.group),xLabel:'表格类别'+(x.ordered?' · 按输入顺序，等距类别轴':''),yLabel:'表中数值',W,H,includeZero:true}),bw=Math.min(60,(W-a.left-a.right)/rows.length*.55);
    const points=rows.map((r,i)=>`${a.x(i)},${a.y(r.value)}`).join(' '),marks=rows.map((r,i)=>type==='line'?`<circle cx="${a.x(i)}" cy="${a.y(r.value)}" r="5" fill="#23685e"><title>${safe(r.group)}: ${r.value}</title></circle>`:`<rect x="${a.x(i)-bw/2}" y="${Math.min(a.y(r.value),a.y(0))}" width="${bw}" height="${Math.max(1,Math.abs(a.y(r.value)-a.y(0)))}" fill="#39776d" rx="3"><title>${safe(r.group)}: ${r.value}</title></rect>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" class="analysis-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="论文汇总值绘图"><style>text{font:16px system-ui,sans-serif;fill:#344b46}</style>${a.parts.join('')}${type==='line'?`<polyline points="${points}" fill="none" stroke="#23685e" stroke-width="2"/>`:''}${marks}</svg>`;
   }
   if(x.mode==='groups'){
    const groups=Object.entries(x.groups),counts=groups.map(([g])=>rows.filter(r=>r.group===g).length),total=counts.reduce((a,b)=>a+b,0)||1;
    if(type==='pie'){const cx=300,cy=218,r=145;let angle=-Math.PI/2;const pieces=groups.map(([name],i)=>{const frac=counts[i]/total,next=angle+frac*2*Math.PI;let d;
      if(groups.length===1)d=`M ${cx} ${cy-r} A ${r} ${r} 0 1 1 ${cx-.01} ${cy-r} Z`;
      else{const x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(next),y2=cy+r*Math.sin(next);d=`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${frac>.5?1:0} 1 ${x2} ${y2} Z`;}
      angle=next;return `<path d="${d}" fill="${chartColors[i%chartColors.length]}" stroke="#fff" stroke-width="2"><title>${safe(name)}：${counts[i]} 条（${(frac*100).toFixed(1)}%）</title></path>`;}).join('');
     const legend=groups.map(([name],i)=>`<g transform="translate(535 ${90+i*42})"><rect width="12" height="12" fill="${chartColors[i%chartColors.length]}"/><text x="23" y="11">${safe(name)}　${counts[i]} 条 · ${(counts[i]/total*100).toFixed(1)}%</text></g>`).join('');
     return `<svg class="analysis-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="各组样本数构成圆形图"><style>text{font:16px system-ui,sans-serif;fill:#344b46}</style><text x="36" y="40" font-size="16">样本数构成</text><text x="36" y="62" opacity=".7">扇区面积表示各组有效观测数，不表示结局比例</text>${pieces}${legend}<text x="535" y="${108+groups.length*42}" opacity=".7">总有效观测：${total}</text></svg>`;
    }
    const labels=groups.map(([g])=>g),raw=labels.map(g=>rows.filter(r=>r.group===g).map(r=>r.value)),ci=groups.map(([,d])=>d.ci95||[d.mean,d.mean]),a=axisSvg({values:[...raw.flat(),...ci.flat()],labels,xLabel:x.ordered?'有序组别（输入顺序，等距类别轴）':'组别',yLabel:'数值 / 均值',W,H,includeZero:type==='bar'||type==='combo'}),bw=Math.min(64,(W-a.left-a.right)/Math.max(1,labels.length)*.56);
    const marks=groups.map(([g,d],i)=>{const X=a.x(i),Y=a.y(d.mean),base=a.y(0),[low,high]=ci[i],barTop=Math.min(Y,base),barH=Math.max(1,Math.abs(base-Y));
     if(type==='line')return `<g><path d="M${X-7} ${a.y(high)}H${X+7}M${X} ${a.y(high)}V${a.y(low)}M${X-7} ${a.y(low)}H${X+7}" stroke="${chartColors[i%chartColors.length]}" stroke-width="2"/><circle cx="${X}" cy="${Y}" r="5" fill="${chartColors[i%chartColors.length]}"><title>${safe(g)}：均值 ${d.mean.toFixed(3)}，95% t 区间</title></circle></g>`;
     const bar=`<rect x="${X-bw/2}" y="${barTop}" width="${bw}" height="${barH}" rx="2" fill="${chartColors[i%chartColors.length]}" opacity=".85"><title>${safe(g)}：均值 ${d.mean.toFixed(3)}；n=${d.n}</title></rect><path d="M${X} ${a.y(high)}V${a.y(low)}M${X-8} ${a.y(high)}H${X+8}M${X-8} ${a.y(low)}H${X+8}" stroke="#344b46" stroke-width="1.4"/>`;
     if(type==='bar')return bar;const dots=raw[i].map((v,j)=>`<circle cx="${X+((j*37%13)-6)*2.3}" cy="${a.y(v)}" r="3.2" fill="#263c39" opacity=".72"><title>${safe(g)} · 原始观测 ${j+1}: ${safe(v)}</title></circle>`).join('');return bar+dots;
    }).join(''),line=type==='line'?`<polyline points="${groups.map(([,d],i)=>`${a.x(i)},${a.y(d.mean)}`).join(' ')}" fill="none" stroke="#354f49" stroke-width="2"/>`:'';
    return `<svg class="analysis-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${type==='line'?'各输入组别均值及区间':type==='bar'?'组均值与区间条状图':'组均值及逐条原始数据复合图'}"><style>text{font:16px system-ui,sans-serif;fill:#354b46}</style><text x="32" y="20" font-size="15">${type==='line'?'组别均值线图':type==='bar'?'组均值与 95% t 区间':'均值 + 原始观测'}</text>${a.parts.join('')}${line}${marks}</svg>`;
   }
   if(x.mode==='correlation'){const pts=rows.map(r=>[r.x,r.y]),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length,slope=xs.reduce((s,v,i)=>s+(v-mx)*(ys[i]-my),0)/xs.reduce((s,v)=>(s+(v-mx)**2),0),intercept=my-slope*mx;
    let x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);if(y0===y1){y0-=1;y1+=1;}const xPad=(x1-x0)*.04,yPad=(y1-y0)*.12;x0-=xPad;x1+=xPad;y0-=yPad;y1+=yPad;const left=82,right=30,top=36,bottom=68,px=v=>left+(v-x0)/(x1-x0)*(W-left-right),py=v=>top+(y1-v)/(y1-y0)*(H-top-bottom),grid=[];
    for(let i=0;i<=4;i++){const yv=y0+(y1-y0)*i/4,Y=py(yv),xv=x0+(x1-x0)*i/4,X=px(xv);grid.push(`<path d="M${left} ${Y}H${W-right}" stroke="#72817b" opacity=".18"/><text x="${left-10}" y="${Y+4}" text-anchor="end">${safe(Number(yv.toPrecision(4)))}</text><path d="M${X} ${top}V${H-bottom}" stroke="#72817b" opacity=".12"/><text x="${X}" y="${H-bottom+19}" text-anchor="middle">${safe(Number(xv.toPrecision(4)))}</text>`);}
    const cloud=pts.map(([u,v],i)=>`<circle cx="${px(u)}" cy="${py(v)}" r="4" fill="#39776d" opacity=".78"><title>观测 ${i+1}: (${safe(u)}, ${safe(v)})</title></circle>`).join(''),fit=`<path d="M${px(x0)} ${py(slope*x0+intercept)} L${px(x1)} ${py(slope*x1+intercept)}" fill="none" stroke="#bd7053" stroke-width="2.5"/>`;
    return `<svg class="analysis-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pearson相关数据${type==='scatter'?'散点图':'与描述性线性拟合'}"><style>text{font:16px system-ui,sans-serif;fill:#354b46}</style><text x="32" y="20" font-size="15">Pearson r = ${x.pearson.r.toFixed(3)} · 线性拟合仅作图形描述</text>${grid.join('')}<path d="M${left} ${top}V${H-bottom}H${W-right}" fill="none" stroke="#75837e"/><text x="${(left+W-right)/2}" y="${H-9}" text-anchor="middle">x</text><text transform="translate(20 ${(top+H-bottom)/2}) rotate(-90)" text-anchor="middle">y</text>${type==='fit'||type==='combo'?fit:''}${type==='fit'?'':cloud}</svg>`;
   }
   const coords=(x.roc||[]).map(p=>`${78+p[0]*(W-112)},${28+(1-p[1])*(H-102)}`).join(' '),reference=type==='combo'?'<path d="M78 366 L886 28" stroke="#a77a64" stroke-dasharray="7 6"/>':'',ticks=Array.from({length:5},(_,i)=>{const v=i/4,X=78+v*(W-112),Y=28+(1-v)*(H-102);return `<path d="M${X} 28V366M78 ${Y}H886" stroke="#72817b" opacity=".16"/><text x="${X}" y="386" text-anchor="middle">${v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}</text><text x="66" y="${Y+4}" text-anchor="end">${v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}</text>`;}).join('');
   return `<svg class="analysis-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="用户提供分数的 ROC 曲线；未训练模型"><style>text{font:16px system-ui,sans-serif;fill:#354b46}</style>${ticks}<path d="M78 28V366H886" fill="none" stroke="#75837e"/>${reference}<polyline points="${coords}" fill="none" stroke="#39776d" stroke-width="3"/><text x="490" y="420" text-anchor="middle">假阳性率</text><text x="22" y="198" transform="rotate(-90 22 198)" text-anchor="middle">真阳性率</text><text x="95" y="22">AUC ${x.auc.toFixed(3)} · 用户提供的评分</text></svg>`;
  }
  const chartChoices={summary:[['bar','条状'],['line','折线']],groups:[['pie','圆形'],['bar','条状'],['line','折线'],['combo','复合']],correlation:[['scatter','散点'],['fit','拟合线'],['combo','复合']],roc:[['roc','ROC 曲线'],['combo','含参考线']]};
  function statsResult(x){const summary=x.mode==='summary'?x.rows.map(r=>`<tr><td>${safe(r.group)}</td><td>—</td><td>${safe(r.value)}</td><td>—</td><td>原表汇总值</td></tr>`).join(''):x.mode==='groups'?Object.entries(x.groups).map(([g,d])=>`<tr><td>${safe(g)}</td><td>${d.n}</td><td>${d.mean.toFixed(3)}</td><td>${d.sd===null?'—':d.sd.toFixed(3)}</td><td>${d.ci95?`${d.ci95[0].toFixed(3)} – ${d.ci95[1].toFixed(3)}`:'样本不足'}</td></tr>`).join(''):x.mode==='roc'?`<tr><td>用户评分 AUC</td><td>${x.n}</td><td>${x.auc.toFixed(3)}</td><td>—</td><td>未计算区间</td></tr>`:`<tr><td>Pearson r</td><td>${x.n}</td><td>${x.pearson.r.toFixed(3)}</td><td>p=${x.pearson.p.toPrecision(3)}</td><td>相关不代表因果</td></tr>`;
   const choices=chartChoices[x.mode].filter(([key])=>key!=='line'||x.ordered);if(!choices.some(([key])=>key===ui.chartType))ui.chartType=choices.at(-1)[0];const svg=chartSvg(x,ui.chartType),robust=x.robustness?`<section class="robustness-result"><div><span>分层 bootstrap · 2,000 次</span><strong>${safe(x.robustness.mean_difference.contrast)}：${x.robustness.mean_difference.estimate.toFixed(3)}</strong><small>95% percentile 区间 ${x.robustness.mean_difference.ci95.map(v=>v.toFixed(3)).join(' – ')} · 随机种子 ${x.robustness.seed}</small></div><div><span>Mann–Whitney U 敏感性对照</span><strong>U = ${x.robustness.mann_whitney.u.toFixed(2)} · p = ${x.robustness.mann_whitney.p.toPrecision(3)}</strong><small>${safe(x.robustness.mann_whitney.label)}</small></div><div class="robustness-sources"><a href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html" target="_blank" rel="noopener noreferrer">SciPy bootstrap 方法 ↗</a><a href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.mannwhitneyu.html" target="_blank" rel="noopener noreferrer">SciPy Mann–Whitney U ↗</a></div></section>`:'';
   return `${x.synthetic?'<div class="warning-strip">合成示例数据</div>':''}<section class="glass stats-result-panel"><div class="stats-result-head"><div><div class="section-eyebrow">${x.mode==='summary'?'汇总绘图':'分析结果'} / ${safe(x.n)} ${x.mode==='summary'?'行':'条观测'}</div><h2>${x.mode==='summary'?'论文表格数值':'描述统计与图形'}</h2></div><span class="hint">排除 ${x.excluded_rows} 行</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>组/指标</th><th>N</th><th>均值/数值</th><th>样本SD / p</th><th>95% t 区间 / 说明</th></tr></thead><tbody>${summary}</tbody></table></div>${x.welch?`<div class="stats-test-strip"><strong>Welch t 检验</strong><span>t = ${x.welch.t.toFixed(3)} · p = ${x.welch.p.toPrecision(3)}</span><small>${safe(x.welch.label)}</small></div>`:''}${robust}<div class="chart-workbench"><div class="chart-workbench-head"><div><strong>图形视图</strong><span>当前数据 · 可更换类型</span></div><div class="chart-type-tabs" role="tablist" aria-label="图表类型">${choices.map(([key,label])=>`<button role="tab" data-chart-type="${key}" aria-selected="${ui.chartType===key}">${label}</button>`).join('')}</div></div><div class="analysis-chart-frame" id="analysisChart">${svg}</div><div class="chart-export-row"><button class="textlink" id="chartDownloadSvg">下载 SVG</button><button class="textlink" id="chartDownloadPng">下载 PNG</button><button class="textlink" id="statsDownloadJson">下载分析 JSON</button>${x.python_export?'<button class="textlink" id="statsDownloadPython">下载复现 Python</button>':''}<span id="chartExportStatus" role="status" aria-live="polite"></span></div></div>${x.provenance?.page?`<div class="data-provenance">${safe(x.provenance.title)} · 第 ${safe(x.provenance.page)} 页 · 表 ${safe(x.provenance.table)} · 数值列 ${safe(x.provenance.value_column)}</div>`:''}${x.note?note(safe(x.note)):''}</section>`;
  }
  function reviewMarkedEvidence(draft){
   const saved=JSON.parse(PersonalStore.getItem('helix.notes.v9')||'{}'),key=draft.paper?.id,marks=saved[key]?.highlights||[];
   if(!marks.length)return '';
   const colors={red:'#c84f54',amber:'#bd8837',blue:'#4d7d9a',green:'#4d8064'};
   return `<section class="glass review-marked-evidence"><div class="review-section-heading"><h2>原文标记</h2><button class="textlink" data-review-read="${safe(key)}">返回精读</button></div>${marks.map((mark,i)=>`<div class="review-quote" style="--quote-color:${colors[mark.color]||colors.red}"><blockquote>${safe(mark.text)}</blockquote>${mark.note?`<div class="note-prose">${NotesUI.format(mark.note)}</div>`:''}<button class="textlink" data-review-quote="${i}">带入复盘笔记</button></div>`).join('')}</section>`;
  }
  function review(){const draft=readReviewDraft(),design=ui.reviewDesign||draft.design||'strobe',spec=G.evaluate(design,draft.byDesign?.[design]||{}),scope=draft.scope||{},statusOpts=(id,label)=>`<div class="work-field"><label for="review${id}">${label}</label><select id="review${id}" data-review-scope="${id}"><option value="unknown"${(scope[id]||'unknown')==='unknown'?' selected':''}>待核对 / 未知</option><option value="yes"${scope[id]==='yes'?' selected':''}>已有证据记录</option><option value="no"${scope[id]==='no'?' selected':''}>尚未完成</option></select></div>`;
   const scopeField=(id,label,placeholder,multiline=false)=>`<div class="work-field"><label for="review${id}">${label}</label>${multiline?`<textarea id="review${id}" data-review-scope="${id}" placeholder="${placeholder}">${safe(scope[id]||'')}</textarea>`:`<input id="review${id}" data-review-scope="${id}" value="${safe(scope[id]||'')}" placeholder="${placeholder}">`}</div>`;
   const items=spec.items.map((item,i)=>{const ev=(draft.byDesign?.[design]||{})[item.id]?.evidence||'';return `<div class="review-check-row"><span class="review-check-number">${String(i+1).padStart(2,'0')}</span><div class="review-check-question"><strong>${safe(item.question)}</strong><input data-review-evidence="${item.id}" value="${safe(ev)}" placeholder="证据位置 / 原文摘录 / 未完成原因"></div><select data-review-status="${item.id}" aria-label="核对状态：${safe(item.question)}"><option value="unknown"${item.status==='unknown'?' selected':''}>待核对</option><option value="yes"${item.status==='yes'?' selected':''}>已记录</option><option value="no"${item.status==='no'?' selected':''}>待补</option><option value="na"${item.status==='na'?' selected':''}>不适用</option></select></div>`;}).join('');
   return `<div class="work-page review-workspace">${head('论文复盘','','研究笔记')}
    <div class="review-nav" aria-label="复盘章节"><button data-review-section="reviewScope">01 研究口径</button><button data-review-section="reviewChecklist">02 规范核查</button><button data-review-section="reviewReflection">03 结果与笔记</button></div><div class="review-library-row"><label for="reviewSavedPaper">复盘档案</label><select id="reviewSavedPaper"><option value="">选择已保存的论文</option>${Object.entries(reviewLibrary()).map(([key,d])=>`<option value="${safe(key)}"${key===ui.reviewStorageKey?' selected':''}>${safe(d.paper?.title||d.paper?.id||'未命名草稿')}</option>`).join('')}</select><button class="btn ghost" id="reviewNew">新建复盘</button></div><section class="glass review-paper-bar"><div class="work-field"><label for="reviewPaperId">论文标识（PMID / DOI）</label><input id="reviewPaperId" data-review-paper="id" value="${safe(draft.paper?.id||ui.reviewPaper?.id||'')}" placeholder="可留空；不联网检索"></div><div class="work-field"><label for="reviewPaperTitle">论文题名</label><input id="reviewPaperTitle" data-review-paper="title" value="${safe(draft.paper?.title||ui.reviewPaper?.title||'')}" placeholder="记录当前复盘对应的论文"></div><div class="work-field"><label for="reviewDesign">研究设计 / 指南</label><select id="reviewDesign"><option value="strobe"${design==='strobe'?' selected':''}>观察性研究 · STROBE</option><option value="consort"${design==='consort'?' selected':''}>随机对照试验 · CONSORT</option><option value="prisma"${design==='prisma'?' selected':''}>系统综述 / Meta 分析 · PRISMA 2020</option></select></div></section>
    <section class="review-scope-band" id="reviewScope"><div class="review-section-heading"><div><div class="section-eyebrow">01 / 研究口径</div><h2>这项研究究竟回答什么？</h2></div><span>未知或未报告时如实标注</span></div><div class="review-scope-grid">${scopeField('aim','研究目标与目标人群','谁、什么场景、解决什么问题？',true)}${scopeField('population','纳入对象与研究场景','数据来源、时间、中心、纳排标准')}${scopeField('indexTest','影像 / 指标 / 干预','输入项、比较项或干预定义')}${scopeField('reference','参考标准 / 标签来源','病理、随访、专家判读或行政记录')}${scopeField('primaryOutcome','主要结局及测量时间','结局阈值、单位、评估时间点')}${scopeField('intendedUse','预期用途与决策位置','筛查、分诊、诊断辅助、预后等')}${scopeField('analysisUnit','分配、分析与拆分单位','记录、检查、病灶、患者或中心',true)}</div>
     <div class="review-items">${statusOpts('labelStatus','标签 / 参考标准可追溯')}${statusOpts('Grouped','训练验证是否按患者或更高层级分组')}${statusOpts('Preprocess','预处理是否仅在训练折拟合')}${statusOpts('External','是否有独立外部验证')}${statusOpts('Uncertainty','是否报告不确定性与精度')}${statusOpts('Limitations','是否呈现局限及失败案例')}</div></section>
    <section class="glass review-checklist-panel" id="reviewChecklist"><div class="review-section-heading"><div><div class="section-eyebrow">02 / ${safe(spec.guideline)}</div><h2>报告与方法核查清单</h2></div><div class="review-counts"><span>${spec.recorded} 已记录</span><span>${spec.incomplete} 待补</span><span>${spec.unknown} 待核</span></div></div><div class="review-checklist-intro">基于官方报告规范的重点核查项；可记录页码、表格、原文或待补原因。</div><div class="review-checklist">${items}</div><div class="review-guideline-source"><a href="${safe(spec.source)}" target="_blank" rel="noopener noreferrer">${safe(spec.guideline)} · EQUATOR Network 官方指南入口 ↗</a></div></section>
    ${reviewMarkedEvidence(draft)}<section class="glass review-reflection" id="reviewReflection"><div class="review-section-heading"><div><div class="section-eyebrow">03 / 解释与下一步</div><h2>复盘笔记</h2></div></div><div class="review-scope-grid">${scopeField('results','主要结果与效应量','样本量、效应量、区间、验证集与原文位置',true)}${scopeField('limitationsText','局限与其他解释','偏倚、反例、可推广范围与后续验证',true)}</div><div class="work-field"><label for="reviewMemo">偏倚来源、反例、口径限制和下一步分析</label>${NotesUI.editor('reviewMemo',draft.memo||'','复盘笔记')}</div><div class="row"><button class="btn" id="reviewRun">生成待核与风险摘要</button><button class="btn ghost" id="reviewExport">导出复盘文档</button><button class="btn ghost" id="reviewPreview">查看复盘</button><button class="textlink" id="reviewBackup">备份 JSON</button><span class="hint" id="reviewSavedStatus">草稿自动保存在当前浏览器。</span></div><div id="reviewOutput" class="review-output">${ui.review?reviewResult(ui.review,ui.guidelineReview):'<div class="empty-inline">填写研究口径和核查状态后生成摘要。</div>'}</div></section>
    </div>`;}
  function evaluateReviewDraft(draft){const s=draft.scope||{};return {review:R.review({question:s.aim?'yes':'unknown',label:s.labelStatus||'unknown',grouped:s.Grouped||'unknown',preprocess:s.Preprocess||'unknown',external:s.External||'unknown',uncertainty:s.Uncertainty||'unknown',limitations:s.Limitations||'unknown'}),checklist:G.evaluate(ui.reviewDesign,draft.byDesign?.[ui.reviewDesign]||{})};}
  function reviewResult(v,g){const counts=g||{recorded:0,incomplete:0,unknown:0,notApplicable:0,guideline:'所选指南'};return `<h3>待补充的研究口径</h3>${v.missing.length?`<ul>${v.missing.map(x=>`<li>${safe(x)}</li>`).join('')}</ul>`:'<p>基础口径字段均已有记录。</p>'}<h3>方法学提醒</h3><ul>${v.warnings.map(x=>`<li>${safe(x)}</li>`).join('')}${v.actions.map(x=>`<li>${safe(x)}</li>`).join('')}${counts.incomplete?`<li>${safe(counts.guideline)} 中 ${counts.incomplete} 项标为待补；请回到原文逐项确认。</li>`:''}${counts.unknown?`<li>${safe(counts.guideline)} 中 ${counts.unknown} 项尚待核对。</li>`:''}</ul>`;}
  const models=()=>ApiModels.render();
  function openReview(d){if(ui.reviewDraft)saveReviewDraft();ui.reviewPaper={id:d.pmid||d.doi||d.id||'',title:d.title};const library=reviewLibrary(),found=Object.entries(library).find(([,draft])=>reviewKey(draft.paper)===reviewKey(ui.reviewPaper));ui.reviewStorageKey=found?.[0]||reviewKey(ui.reviewPaper);ui.reviewDraft=found?.[1]||blankReview(ui.reviewPaper);ui.reviewDesign=ui.reviewDraft.design||'strobe';ui.review=null;ui.guidelineReview=null;saveReviewDraft();goto('review');}
  function interpretDocument(d){ui.document=d;ui.paperKey=null;ui.question='请简述这篇 PDF 的研究问题、方法与结果，并引用页码：'+d.title;ui.answer='';ui.refs=[];ui.error='';ui.notice='';goto('assist');}
  function interpretPaper(d){ui.document=null;ui.paperKey=d.key;ui.question='请简述这篇论文的研究问题、方法与结果，并给出摘要依据：'+d.title;ui.answer='';ui.refs=[];ui.error='';ui.notice='';goto('assist');}
  function showError(selector,msg){const box=$(selector);if(box){box.hidden=false;box.textContent=msg;}}
  async function post(route,body){if(window.BrowserCompute?.enabled&&route==='/api/stats')return BrowserCompute.request('stats',body);const res=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok||data.error)throw Error(data.error||'HTTP '+res.status);return data;}
  function config(){return ApiModels.config();}
  function fallbackConfig(){return ApiModels.fallbackConfig();}
  function questionContext(q){
    if(ui.document){const d=ui.document,excerpt=d.pages.map(p=>'第 '+p.number+' 页：'+p.text).join('\n\n').slice(0,48000);const paper={key:d.id,pdfId:d.id,title:d.title,authors:d.author,journal:'已导入 PDF',year:'',pmid:d.source?.pmid||'',doi:d.doi,qaExcerpt:excerpt};ui.refs=[paper];ui.intent=null;ui.preparedQuestion=q;const lines='[1] '+d.title+' | DOI '+(d.doi||'—')+'\n'+excerpt;return {ctx:{hits:ui.refs,lines},prompt:qaPrompt(q,lines)};}

    if(ui.paperKey){
      const d=LIB.find(p=>p.key===ui.paperKey);ui.intent=null;ui.preparedQuestion=q;
      if(!d||!ABS[d.key]||d.date_pending||['retracted','retracted_and_republished'].includes(d.publication_notice)){ui.refs=[];return null;}
      const paper={...d,qaExcerpt:ABS[d.key]},lines=`[1] ${d.title} | ${d.authors_full||d.authors} | ${d.journal} ${d.year} | PMID ${d.pmid}\n摘要：${paper.qaExcerpt}`;
      ui.refs=[paper];return {ctx:{hits:ui.refs,lines},prompt:qaPrompt(q,lines)};
    }
    const ctx=qaContext(4,q);ui.refs=ctx.hits;ui.intent=ctx.intent;ui.preparedQuestion=q;
    if(!ctx.hits.length)return null;
    return {ctx,prompt:qaPrompt(q,ctx.lines)};
  }
  function preview(){ui.question=$('#researchQuestion')?.value.trim()||'';ui.answer='';ui.error='';ui.notice='';ui.refs=[];ui.intent=null;
    if(!ui.question){ui.error='请先描述病症或研究问题。';renderMain();return;}
    const c=questionContext(ui.question);ui.notice=c?`找到 ${ui.refs.length} 篇有可用摘要的相关题录，可打开来源核对后生成简述。`:'';
    if(!c)ui.error='没有匹配到可用摘要。请补充病症名称或影像类型，也可通过下方邮箱反馈。';renderMain();
  }
  async function ask(){if(ui.pending)return;ui.question=$('#researchQuestion')?.value.trim()||'';ui.answer='';ui.error='';ui.notice='';
    if(!ui.question){ui.error='请描述病症或研究问题。';renderMain();return;}
    const c=questionContext(ui.question);
    if(!c){ui.error='没有匹配到可用摘要。请补充病症名称或影像类型，也可通过下方邮箱反馈。';renderMain();return;}
    ui.pending=true;activeRequest=new AbortController();const current=++requestVersion;let completed=false;renderMain();
    try{
      const res=await fetch('/api/answer',{method:'POST',signal:activeRequest.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({config:config(),fallback:fallbackConfig(),use_fallback:settings.fallback,prompt:c.prompt})});
      if(!res.ok||!res.body)throw Error('本机研究服务未就绪，HTTP '+res.status);
      const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
      while(true){const {done,value}=await reader.read();if(current!==requestVersion)return;if(done)break;buffer+=decoder.decode(value,{stream:true});let cut;
        while((cut=buffer.indexOf('\n\n'))>=0){const line=buffer.slice(0,cut).trim();buffer=buffer.slice(cut+2);
          if(!line.startsWith('data:'))continue;
          const item=JSON.parse(line.slice(5));
          if(item.delta){ui.answer+=item.delta;const display=$('#researchResponse');if(display)display.textContent=ui.answer;}
          if(item.notice)ui.notice=item.notice;
          if(item.error)ui.error=item.error;
          if(item.done){completed=true;ui.notice=`模型 ${item.model} 已回答${item.fallback_used?'，使用备用 API':''}。`;}
        }
      }
      if(!completed&&!ui.error)ui.error='回答连接中断，现有文字可能不完整，请重试。';
    }catch(e){if(current!==requestVersion)return;ui.error=e.name==='AbortError'?'已停止生成。':(e.message||String(e));}
    if(current===requestVersion){ui.pending=false;activeRequest=null;if(state.step==='assist')renderMain();}
  }
  function leave(){if(activeRequest){requestVersion++;activeRequest.abort();activeRequest=null;ui.pending=false;ui.notice='已停止生成，现有文字可能不完整。';}}
  async function desktop(){const q=$('#researchQuestion')?.value.trim()||ui.question;ui.question=q;const c=questionContext(q);
    if(!c){ui.error='先输入能匹配论文摘要的问题。';renderMain();return;}
    try{await navigator.clipboard.writeText(c.prompt);ui.notice='问题与已编号摘要已复制。DeepSeek 网页或客户端中可手动粘贴，内容仍需核对。';window.open('https://chat.deepseek.com/','_blank','noopener,noreferrer');}
    catch(e){ui.error='复制未成功；请改用 HTTPS/localhost 页面并允许剪贴板权限。';}renderMain();
  }
  async function runStats(){ui.chartData=$('#statsCsv')?.value||'';ui.mode=$('#statsMode')?.value||'groups';ui.statsError='';
   try{const result=await post('/api/stats',{csv:ui.chartData,mode:ui.mode,synthetic:ui.chartData.startsWith('# SYNTHETIC'),robustness:ui.mode==='groups'&&ui.robustness,data_kind:ui.dataKind,provenance:ui.provenance,ordered:ui.ordered});ui.stats=result;saveWorkspace();}
    catch(e){ui.statsError=e.message;ui.stats=null;}renderMain();
  }
  const example=()=>({groups:'# SYNTHETIC teaching data\ngroup,value\nA,1.2\nA,1.4\nA,1.6\nA,1.8\nB,2.1\nB,2.4\nB,2.5\nB,2.7',correlation:'# SYNTHETIC teaching data\nx,y\n1,1.2\n2,1.8\n3,2.5\n4,4.1\n5,5.0',roc:'# SYNTHETIC teaching data\nlabel,score\n0,0.1\n1,0.9\n0,0.4\n1,0.7\n0,0.2\n1,0.8'})[ui.mode];
  function bind(){
    document.querySelectorAll('[data-pdf-record]').forEach(el=>el.onclick=()=>PdfUI.open(el.dataset.pdfRecord));
    document.querySelectorAll('[data-go]').forEach(el=>el.onclick=()=>goto(el.dataset.go));
    document.querySelectorAll('[data-record]').forEach(el=>el.onclick=()=>openRec(el.dataset.record));
    if(state.step==='assist'){
      $('#researchAsk').onclick=ask;$('#researchPreview').onclick=preview;$('#researchDesktop').onclick=desktop;
      if($('#researchStop'))$('#researchStop').onclick=()=>{leave();renderMain();};
      $('#researchQuestion').oninput=e=>{ui.question=e.target.value;};
      $('#clearQuestionSource')?.addEventListener('click',()=>{ui.document=null;ui.paperKey=null;ui.refs=[];ui.answer='';renderMain();});
      document.querySelectorAll('[data-question]').forEach(el=>el.onclick=()=>{ui.paperKey=null;ui.document=null;$('#researchQuestion').value=el.dataset.question;preview();});
      $('#copyContact').onclick=async()=>{try{await navigator.clipboard.writeText('210438161@qq.com');ui.notice='邮箱已复制。';}catch{ui.notice='请手动复制邮箱：210438161@qq.com';}renderMain();};
      const display=$('#researchResponse');if(display)display.textContent=ui.answer;
    }
    if(state.step==='reader')ReaderUI.bind();
    if(state.step==='stats'){
      $('#statsDataKind').onchange=e=>{ui.chartData=$('#statsCsv').value;ui.dataKind=e.target.value;ui.mode=ui.dataKind==='aggregate'?'summary':'groups';ui.stats=null;ui.robustness=false;renderMain();};
      $('#statsOrdered').onchange=e=>{ui.ordered=e.target.checked;if(ui.stats)ui.stats.ordered=ui.ordered;renderMain();};
      $('#statsMode').onchange=e=>{ui.chartData=$('#statsCsv').value;ui.mode=e.target.value;ui.stats=null;ui.chartType=ui.mode==='groups'?'combo':ui.mode==='correlation'?'combo':'roc';ui.robustness=false;renderMain();};
      $('#statsFile').onchange=async e=>{const f=e.target.files?.[0];if(f){if(f.name.toLowerCase().endsWith('.pdf')){goto('pdf');PdfUI.upload(f);return;}if(f.size>1_000_000){ui.statsError='CSV 超过 1 MB';renderMain();return;}ui.chartData=await f.text();ui.provenance={name:f.name};ui.stats=null;renderMain();}};
      $('#statsCsv').oninput=e=>{ui.chartData=e.target.value;};
      $('#statsRobustness').onchange=e=>{ui.robustness=e.target.checked;};
      $('#statsExample').onclick=()=>{if(ui.mode==='summary')ui.mode='groups';ui.dataKind='individual';ui.provenance=null;ui.chartData=example();ui.stats=null;renderMain();};
      $('#statsRun').onclick=runStats;
      document.querySelectorAll('[data-chart-type]').forEach(b=>b.onclick=()=>{ui.chartType=b.dataset.chartType;renderMain();});
      $('#statsDownloadJson')?.addEventListener('click',()=>download('helix-analysis.json',JSON.stringify({...ui.stats,ordered:ui.ordered,chart_type:ui.chartType},null,2)));
      $('#statsDownloadPython')?.addEventListener('click',()=>download('知镜-复现分析.py',ui.stats.python_export,'text/x-python'));
      $('#chartDownloadSvg')?.addEventListener('click',()=>{const svg=$('#analysisChart svg');if(svg)download('helix-analysis-chart.svg',svg.outerHTML,'image/svg+xml');});
      $('#chartDownloadPng')?.addEventListener('click',async()=>{let sourceUrl='';try{const svg=$('#analysisChart svg');if(!svg)throw Error('图表尚未生成');const blob=new Blob([svg.outerHTML],{type:'image/svg+xml;charset=utf-8'});sourceUrl=URL.createObjectURL(blob);const img=new Image();img.src=sourceUrl;await img.decode();const canvas=document.createElement('canvas');canvas.width=1840;canvas.height=880;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);const file=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!file)throw Error('浏览器无法创建 PNG 文件');const a=document.createElement('a'),href=URL.createObjectURL(file);a.href=href;a.download='helix-analysis-chart.png';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}catch(err){const status=$('#chartExportStatus');if(status)status.textContent='PNG 导出失败：'+err.message;}finally{if(sourceUrl)URL.revokeObjectURL(sourceUrl);}});
    }
    if(state.step==='review'){
      document.querySelectorAll('[data-review-section]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.reviewSection).scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
      document.querySelectorAll('[data-review-read]').forEach(b=>b.onclick=()=>ReaderUI.open(b.dataset.reviewRead));
      document.querySelectorAll('[data-review-quote]').forEach(b=>b.onclick=()=>{const draft=readReviewDraft(),notes=JSON.parse(PersonalStore.getItem('helix.notes.v9')||'{}'),mark=notes[draft.paper.id].highlights[Number(b.dataset.reviewQuote)];draft.memo+=(draft.memo?'\n\n':'')+'原文摘录 ['+draft.paper.id+']：'+mark.text+(mark.note?'\n批注：'+mark.note:'');saveReviewDraft();$('#reviewMemo').value=draft.memo;$('#reviewMemo').dispatchEvent(new Event('input',{bubbles:true}));b.textContent='已带入';});
      $('#reviewSavedPaper').onchange=e=>{const draft=reviewLibrary()[e.target.value];if(draft)openReview(draft.paper);};
      $('#reviewNew').onclick=()=>{saveReviewDraft();openReview({id:'draft-'+crypto.randomUUID(),title:''});};
      $('#reviewDesign').onchange=e=>{const draft=readReviewDraft();ui.reviewDesign=e.target.value;draft.design=ui.reviewDesign;ui.review=null;ui.guidelineReview=null;saveReviewDraft();renderMain();};
      document.querySelectorAll('[data-review-scope],[data-review-paper],[data-review-status],[data-review-evidence],#reviewMemo').forEach(el=>{
        const persist=()=>{const draft=readReviewDraft();draft.design=ui.reviewDesign;draft.scope=draft.scope||{};draft.paper=draft.paper||{};draft.byDesign=draft.byDesign||{};draft.byDesign[ui.reviewDesign]=draft.byDesign[ui.reviewDesign]||{};
          if(el.dataset.reviewScope)draft.scope[el.dataset.reviewScope]=el.value;
          if(el.dataset.reviewPaper)draft.paper[el.dataset.reviewPaper]=el.value;
          if(el.dataset.reviewStatus){const item=draft.byDesign[ui.reviewDesign][el.dataset.reviewStatus]||{};item.status=el.value;draft.byDesign[ui.reviewDesign][el.dataset.reviewStatus]=item;}
          if(el.dataset.reviewEvidence){const item=draft.byDesign[ui.reviewDesign][el.dataset.reviewEvidence]||{status:'unknown'};item.evidence=el.value;draft.byDesign[ui.reviewDesign][el.dataset.reviewEvidence]=item;}
          if(el.id==='reviewMemo')draft.memo=el.value;saveReviewDraft();const status=$('#reviewSavedStatus');if(status)status.textContent='草稿已保存到当前浏览器。';};
        el.addEventListener('input',persist);el.addEventListener('change',persist);
      });
      $('#reviewRun').onclick=()=>{const value=evaluateReviewDraft(readReviewDraft());ui.review=value.review;ui.guidelineReview=value.checklist;$('#reviewOutput').innerHTML=reviewResult(ui.review,ui.guidelineReview);};
      const reviewReport=()=>{const draft=readReviewDraft(),value=evaluateReviewDraft(draft);ui.review=value.review;ui.guidelineReview=value.checklist;return NotesUI.review({paper:draft.paper,design:ui.reviewDesign,scope:draft.scope,checklist:ui.guidelineReview,checklistEvidence:draft.byDesign?.[ui.reviewDesign]||{},review:ui.review,memo:draft.memo,generated:new Date().toISOString()});};
      $('#reviewExport').onclick=()=>NotesUI.exportHTML(reviewReport());
      $('#reviewPreview').onclick=()=>NotesUI.preview(reviewReport());
      $('#reviewBackup').onclick=()=>NotesUI.backup(reviewReport().backup,'helix-research-review.json');
      NotesUI.bind();
    }
    if(state.step==='models'){ApiModels.bind();TranslateUI.bind();}
  }
  function download(name,text,type='application/json'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return {assist:assistant,reader,stats,review,models,bind,leave,openReview,interpretPaper,interpretDocument,saveWorkspace,restoreWorkspace,state:ui};
})();
