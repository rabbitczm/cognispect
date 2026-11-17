/* Source-bounded anatomy navigation. Unknown labels and functions stay unknown. */
var AnatomyUI=(()=>{
 'use strict';
 const $=s=>document.querySelector(s),e=s=>esc(String(s??''));
 function groupIndex(values){const index={};for(const m of Object.values(values))(index[m.group]||=[]).push(m.id);return index;}
 let catalog=ANATOMY.parts,meshes=ANATOMY.meshes,meshGroups=groupIndex(meshes);const knowledge=ANATOMY_KNOWLEDGE;
 let modelId=localStorage.getItem('zhijing.atlas.model')||'male',activeCatalog=ANATOMY;const sessions=new Map(),palette=['#df816e','#e3bd60','#78b49a','#7daed2','#b898cd','#e9a5bc'];
 const markKey=()=> 'zhijing.atlas.marks.'+(typeof PersonalStore!=='undefined'&&PersonalStore.user?PersonalStore.user.id:'guest')+'.'+modelId;
 function readMarks(){try{return JSON.parse(localStorage.getItem(markKey())||'{}');}catch{return {};}}
 function saveMarks(value){localStorage.setItem(markKey(),JSON.stringify(value));viewer?.setMarks(value);markStatus();}
 function markStatus(){const status=$('#anatomyMarkStatus');if(status)status.textContent='已标记 '+Object.keys(viewer?.marks||{}).length+' 个部件 · 保存在本机';}
 function chooseCatalog(value){activeCatalog=value;ANATOMY=value;catalog=value.parts;meshes=value.meshes;meshGroups=groupIndex(meshes);conceptEntries=Object.values(catalog).filter(p=>modelId==='female'||p.id.startsWith('FMA')||p.unnamed||p.nameResolution);}
 function remember(){if(viewer)sessions.set(modelId,{selected,shown:[...shown],opacity:viewer.opacity,camera:viewer.cameraState()});}
 async function switchModel(id){if(id===modelId&&viewer)return;dispose();modelId=id;localStorage.setItem('zhijing.atlas.model',id);await bind();}
 const provenanceText=p=>({adapted:'改编模型','female-reference':'女性参考模型',schematic:'示意结构',mixed:'包含多种来源'})[p.provenance]||'BodyParts3D 参考模型';
 const presets={heart:['心脏','FMA7088','flow'],lungs:['肺与气道','FMA7158','flow'],brain:['脑','FMA50801','image','brain'],liver:['肝脏','FMA7197','image','liver'],kidneys:['左肾','FMA7205','pk'],arteries:['动脉','FMA50720','flow'],veins:['静脉','FMA50723','flow']};
 const topics={heart:[['冠状动脉疾病','coronary artery disease'],['心力衰竭','heart failure']],lungs:[['肺结节','lung nodule'],['哮喘','asthma'],['肺炎','pneumonia']],brain:[['脑卒中','stroke'],['胶质瘤','glioma']],liver:[['肝纤维化','liver fibrosis'],['肝细胞癌','hepatocellular carcinoma']],kidneys:[['慢性肾脏病','chronic kidney disease'],['肾癌','renal cell carcinoma']],arteries:[['动脉粥样硬化','atherosclerosis'],['动脉瘤','aneurysm']],veins:[['深静脉血栓','deep vein thrombosis'],['静脉曲张','varicose veins']]};
 let selected='FMA7088',viewer=null,epoch=0,request=0,shown=new Set(),hiddenSkin=[],filter='',limit=50,activePreset='heart';
 let conceptEntries=Object.values(catalog).filter(p=>p.id.startsWith('FMA')||p.unnamed||p.nameResolution);
 function label(p){if(!p)return '';if(p.zh)return p.zh;if(p.nameResolution)return (p.nameResolution.zh||p.nameResolution.en)+' · 组成网格 '+p.id;if(p.unnamed)return '未具名网格 · '+p.id;const lower=p.en.toLowerCase(),translated=knowledge.translations[lower];if(translated)return translated;
  for(const [prefix,zh] of [['left ','左'],['right ','右']]){if(lower.startsWith(prefix)&&knowledge.translations[lower.slice(prefix.length)])return zh+knowledge.translations[lower.slice(prefix.length)];}
  return p.en;
 }
 function info(p){return knowledge.entries[p.id]||knowledge.entries[p.fma]||null;}
 function idsFor(groups){return groups.flatMap(group=>meshGroups[group]||[]);}
 function sourceLink(id){const s=knowledge.sources[id];return s?`<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)} · ${e(s.url.split('/').at(-1).split('-').slice(0,2).join('.'))} ↗</a>`:'';}
 function nameEvidence(p){const r=p.nameResolution;if(!r)return '';
  return `<section class="atlas-function" id="anatomyNameEvidence" data-compound-name="${e(r.en)}"><div class="atlas-section-title"><h3>名称核对</h3><span>官方组成关系</span></div>
   <p>所属结构：<strong>${e(r.en)}</strong> · ${e(r.compoundFma)}</p>
   <p>原始 OBJ 名称与 Concept ID 为空。本标签按官方组成表补充，属于该结构的组成网格。</p>
   <p class="hint">${e(r.scopeNote)} ${e(r.translationStatus)}。</p>
   <p><a href="${e(r.mappingEvidence.url)}" target="_blank" rel="noopener noreferrer">isa_element_parts.txt ↗</a> 第 ${r.mappingEvidence.line} 行：<span class="atlas-files">${e(r.mappingEvidence.record)}</span><br>
   <a href="${e(r.nameEvidence.url)}" target="_blank" rel="noopener noreferrer">isa_parts_list_e.txt ↗</a> 第 ${r.nameEvidence.line} 行提供所属结构英文名。</p>
   <p>交叉核对：同组 ${e(r.companionMesh)}.obj 的文件头为 ${e(r.companionEvidence.englishName)}（${e(r.compoundFma)}）。</p>
   <div class="atlas-relations"><button data-structure="${e(r.compoundFma)}">查看所属复合结构 ↗</button></div>
  </section>`;
 }
 function render(){return `<div class="work-page atlas-page">
  <div class="work-head"><div><div class="overline">知镜 / 开放解剖图谱</div><h1>从全身，到每一个结构。</h1><p>切换男女图谱，选择结构查看细节并添加颜色标记。</p></div><div class="atlas-model-picker" role="group" aria-label="选择人体模型"><button data-model="male" aria-pressed="${modelId==='male'}">男性</button><button data-model="female" aria-pressed="${modelId==='female'}">女性</button></div></div>
  <div class="atlas-layout">
   <aside class="atlas-catalog glass"><div class="atlas-section-title"><strong>结构目录</strong><span>${Object.keys(meshes).length.toLocaleString()} 个网格</span></div>
    <label class="atlas-search-label" for="anatomySearch">查找结构</label><input id="anatomySearch" type="search" placeholder="左肾 / kidney / FMA7205" autocomplete="off">
    <p class="atlas-search-help">中文常用名、官方英文或编号</p><label class="atlas-search-label" for="anatomyFilter">显示组</label><select id="anatomyFilter"><option value="">全部结构</option>${Object.entries(ANATOMY.packs).map(([g,p])=>`<option value="${g}">${e(p.name)}</option>`).join('')}</select>
    <div class="atlas-result-heading"><span>检索结果</span><span id="anatomyResultCount"></span></div><div id="anatomyResults" class="atlas-results"></div><button id="anatomyMore" class="btn ghost tiny" hidden>再显示 50 项</button>
    <details class="atlas-layer-panel" open><summary>分层显示</summary><div id="anatomyLayers">${Object.entries(ANATOMY.packs).map(([g,p])=>`<div class="atlas-layer-row"><label><input type="checkbox" data-system="${g}"><i style="background:${p.color}"></i><span>${e(p.name)}</span></label><button data-system-only="${g}" title="只显示${e(p.name)}">单独</button></div>`).join('')}</div></details>
   </aside>
   <section class="atlas-view glass"><div class="atlas-toolbar"><div class="atlas-view-buttons">${[['front','正面'],['back','背面'],['left','左侧'],['right','右侧']].map(([id,t])=>`<button class="btn ghost tiny" data-view="${id}">${t}</button>`).join('')}</div><div class="atlas-display-buttons"><button id="anatomySkinToggle" class="btn ghost tiny" aria-pressed="true">隐藏外层</button><button id="anatomySkeletonOnly" class="btn ghost tiny">只看骨骼</button><button id="anatomyReset" class="btn ghost tiny">恢复全身</button></div></div>
    <div id="anatomyStage" class="anatomy-stage atlas-stage" data-ready="false" data-model="${modelId}" data-model-source="${modelId==='female'?'Female Anatomy Blast 2.2':'BodyParts3D 4.0'}">
     <div class="anatomy-caption"><span id="anatomyOrientation">正面 · 人体右侧在画面左侧</span><span>拖动旋转 / 滚轮缩放 / Shift 拖动平移</span></div>
     <div id="anatomyLoading" class="atlas-loading" role="status"><div class="atlas-loading-track"></div><span>正在读取本地解剖网格…</span></div>
     <svg class="anatomy-leaders" aria-hidden="true"><path id="anatomyLeader"></path></svg><button id="anatomyCallout" class="anatomy-callout" hidden></button>
     <div class="atlas-stage-status"><span id="anatomyVisibleCount">加载中</span><span id="anatomyQuality" role="status">轻量预览 · 点击加载细节</span></div>
    </div>
    <div class="atlas-presets">${modelId==='female'?[['子宫','FEMALE_uterus'],['卵巢','FEMALE_ovaries'],['乳腺','FEMALE_breasts']].map(([name,id])=>`<button data-structure="${id}">${name}</button>`).join(''):''}${Object.entries(presets).filter(([,p])=>catalog[p[1]]).map(([key,p])=>`<button data-preset="${key}" data-organ="${key}">${e(p[0])}</button>`).join('')}</div>
    <div id="anatomyProvenance" class="atlas-provenance"><strong>原始来源，逐网格可追溯</strong><span>${Object.keys(meshes).length.toLocaleString()} 网格 / ${ANATOMY.triangles.toLocaleString()} 三角面 · 轻量预览／按需精细网格</span><span>${modelId==='female'?'Female Anatomy Blast 2.2 · 女性组合图谱':'BodyParts3D 4.0 · 成人男性'}</span><a href="${e(ANATOMY.source)}" target="_blank" rel="noopener noreferrer">模型数据与来源 ↗</a></div>
   </section>
   <aside class="atlas-detail glass" id="anatomyDetail"></aside>
  </div>
  <div class="atlas-disclosure"><strong>模型来源与覆盖</strong><p>${modelId==='female'?'Female Anatomy Blast 2.2 · 2,353 个部件；其中 76 个女性参考部件、82 个示意部件，其余为 BodyParts3D 改编结构。各部件来源在详情中标注；此版本未提供完整皮肤和全部末梢分支。':'BodyParts3D 4.0 · 2,234 个网格 · 成人男性参考模型。'}</p><p>${e(ANATOMY.attribution)} · CC BY 4.0。<a href="/ATTRIBUTION.md" target="_blank" rel="noopener">来源与改编记录</a></p></div>
 </div>`;}
 function results(){
  const q=($('#anatomySearch')?.value||'').trim().toLowerCase();filter=$('#anatomyFilter')?.value||'';
  const candidates=/^fj\d+/i.test(q)?Object.values(catalog):conceptEntries;
  const rows=candidates.filter(p=>(!filter||p.groups.includes(filter))&&(!q||`${label(p)} ${p.en} ${p.id} ${p.nameResolution?.compoundFma||''}`.toLowerCase().includes(q)));
  rows.sort((a,b)=>(label(b)!==b.en)-(label(a)!==a.en)||a.en.localeCompare(b.en));
  $('#anatomyResultCount').textContent=rows.length+' 项';
  $('#anatomyResults').innerHTML=rows.length?rows.slice(0,limit).map(p=>`<button class="atlas-result" data-structure="${p.id}" aria-pressed="${p.id===selected}"><strong>${e(label(p))}</strong>${label(p)!==p.en?`<span>${e(p.en)}</span>`:''}<small>${p.id} · ${p.elements.length} 网格</small></button>`).join(''):'<p class="atlas-empty">没有匹配结构。试试英文名或 FMA / FJ 编号。</p>';
  $('#anatomyMore').hidden=rows.length<=limit;
 }
 function detail(){
  const p=catalog[selected];if(!p)return;const k=info(p),background=!k&&p.groups.length===1?knowledge.groups[p.groups[0]]:null;
  const children=ANATOMY.relations.partof.filter(r=>r[0]===p.id).map(r=>catalog[r[1]]).filter(Boolean);
  const parents=ANATOMY.relations.partof.filter(r=>r[1]===p.id).map(r=>catalog[r[0]]).filter(Boolean);
  const triangles=p.elements.reduce((sum,id)=>sum+(meshes[id]?.indices||0)/3,0);
  const preset=presets[activePreset];
  $('#anatomyDetail').dataset.selected=selected;
  $('#anatomyDetail').innerHTML=`<span class="section-eyebrow">选中结构 · ${e(provenanceText(p))}</span><h2>${e(label(p))}</h2><p class="atlas-en">${e(p.en)}</p>
   <div class="atlas-id"><span>${p.id}</span>${p.fma?`<span>${p.fma}</span>`:''}<span>${p.elements.length} 网格</span></div><p id="anatomySelectionStatus" class="hint"></p>
   <div class="atlas-actions"><button id="anatomyFocus" class="btn ghost">放大定位</button><button id="anatomyIsolate" class="btn">单独查看</button><button id="anatomyHide" class="btn ghost">隐藏</button><button id="anatomyShow" class="btn ghost">显示</button></div>
   <section class="atlas-mark-tools" aria-label="器官颜色标记"><div class="atlas-section-title"><strong>颜色标记</strong><span>点击色块固定颜色</span></div><div class="atlas-swatches">${palette.map((color,i)=>`<button data-mark-color="${color}" style="--mark-color:${color}" aria-label="${['珊瑚红','金黄','青绿','天蓝','紫灰','粉红'][i]}标记"></button>`).join('')}</div><div class="atlas-mark-actions"><button id="anatomyUnmark" class="textlink">取消当前标记</button><button id="anatomyClearMarks" class="textlink">清空本模型标记</button></div><p id="anatomyMarkStatus" class="hint"></p></section>
   <label class="atlas-opacity" for="anatomyOpacity">${e(label(p))} · 不透明度 <output id="anatomyOpacityValue">${Math.round((viewer?.opacity??1)*100)}%</output><input id="anatomyOpacity" type="range" min="15" max="100" value="${Math.round((viewer?.opacity??1)*100)}"></label>
   ${modelId==='female'?`<p class="atlas-source-kind">${e(provenanceText(p))} · <a href="${e(p.sourceUrl||ANATOMY.source)}" target="_blank" rel="noopener">查看来源</a></p>`:nameEvidence(p)}
   <section class="atlas-function"><div class="atlas-section-title"><h3>功能注解</h3><span>${k?'已对照教材':'逐结构待核'}</span></div><p id="anatomyFunction">${e(k?k.text:'功能注解待补充。')}</p>
    <div id="anatomyKnowledge">${background?`<p class="atlas-background">${e(background.text)}</p>`:''}${k?sourceLink(k.source):background?sourceLink(background.source):'<p class="hint">可通过官方编号继续查证。</p>'}</div>${['FMA7158','FMA7309','FMA7310'].includes(p.id)?'<p class="atlas-background">模型范围：此存档的肺部复合条目由气道及血管树等网格组成，没有连续的肺外表面。生理说明不表示每个网格都是肺泡。</p>':''}</section>
   ${parents.length?`<h3>所属结构 · PART-OF</h3><div class="atlas-relations">${parents.map(d=>`<button data-structure="${d.id}">${e(label(d))}</button>`).join('')}</div>`:''}
   ${children.length?`<h3>下一级结构 · PART-OF</h3><div class="atlas-relations">${children.map(d=>`<button data-structure="${d.id}">${e(label(d))}</button>`).join('')}</div>`:''}
   <details class="atlas-mesh-info"><summary>网格身份与转换记录</summary><p>${p.nameResolution?'官方所属结构名：'+e(p.nameResolution.en)+'；本项仅为组成网格':'官方名称：'+e(p.en)}<br>映射依据：${e(p.mapping)}<br>三角面：${triangles.toLocaleString()}<br>原始单位：mm；保持原相对位置；统一旋转坐标系；法线在构建时计算。</p><p class="atlas-files">${p.elements.map(e).join(' · ')}</p><a href="${e(ANATOMY.licenseURL)}" target="_blank" rel="noopener noreferrer">查看官方许可 ↗</a></details>
   ${preset?`<h3>可检索的文献主题</h3><div class="atlas-relations">${topics[activePreset].map(([name,q])=>`<button data-anatomy-disease="${e(q)}">${e(name)} ↗</button>`).join('')}</div><div class="atlas-experiment"><span>关联教学模型</span><button id="anatomyExperiment" class="btn ghost">打开${preset[2]==='image'?'影像 ROI':preset[2]==='flow'?'理想血流':'双室药代'}实验 ↗</button></div>`:''}`;
  document.querySelectorAll('[data-mark-color]').forEach(b=>b.onclick=()=>{const values=readMarks();for(const id of p.elements)values[id]=b.dataset.markColor;saveMarks(values);});
  $('#anatomyUnmark').onclick=()=>{const values=readMarks();for(const id of p.elements)delete values[id];saveMarks(values);};$('#anatomyClearMarks').onclick=()=>saveMarks({});markStatus();
  $('#anatomyFocus').onclick=()=>viewer?.fit(p.elements);
  $('#anatomyIsolate').onclick=()=>showIds(p.elements,true);
  $('#anatomyHide').onclick=()=>{p.elements.forEach(id=>shown.delete(id));viewer?.setVisible([...shown]);syncLayers();};
  $('#anatomyShow').onclick=()=>showIds([...new Set([...shown,...p.elements])],false,p.elements);
  $('#anatomyOpacity').oninput=event=>{const value=+event.target.value;$('#anatomyOpacityValue').textContent=value+'%';viewer?.setOpacity(value/100);};
  if($('#anatomyExperiment'))$('#anatomyExperiment').onclick=()=>SimulationUI.openExperiment(preset[2],preset[3]);
  document.querySelectorAll('[data-anatomy-disease]').forEach(button=>button.onclick=()=>{SRCH.q=button.dataset.anatomyDisease;SRCH.groups=null;SRCH.field='all';SRCH._sq=null;SRCH.years=[];SRCH.topics=[];SRCH.journals=[];SRCH.onlyV=false;SRCH.hasAbs=false;SRCH.oa=false;SRCH.zhOnly=false;SRCH.yearFrom=0;SRCH.page=1;goto('search');});
 }
 function syncLayers(change){if(!viewer)return;const ids=viewer.visibleIds();$('#anatomyVisibleCount').textContent=ids.length.toLocaleString()+' 个可见网格';
  if(change?.orientation==='free')$('#anatomyOrientation').textContent='自由视角 · 左右按人体自身定义';
  const status=$('#anatomySelectionStatus'),elements=catalog[selected].elements,visible=elements.filter(id=>shown.has(id)).length;
  if(status)status.textContent=visible?(visible===elements.length?'全部':'部分')+'显示（'+visible+' / '+elements.length+' 网格）':'当前结构已隐藏；点击“显示”可恢复。';
  const skinIds=idsFor(['skin']),skinVisible=skinIds.some(id=>shown.has(id)),toggle=$('#anatomySkinToggle');toggle.hidden=!skinIds.length;toggle.textContent=skinVisible?'隐藏外层':'显示外层';toggle.setAttribute('aria-pressed',String(skinVisible));
  $('#anatomyQuality').textContent=visible&&elements.every(id=>viewer.isRefined(id))?'细节已加载':'轻量预览 · 点击加载细节';
  for(const input of document.querySelectorAll('[data-system]')){const members=idsFor([input.dataset.system]);const count=members.filter(id=>shown.has(id)).length;input.checked=count===members.length&&count>0;input.indeterminate=count>0&&count<members.length;}
 }
 async function showIds(ids,fit=false,refine=ids){const generation=epoch,ticket=++request,live=viewer;if(!live)return;
  const stage=$('#anatomyStage'),loading=$('#anatomyLoading');shown=new Set(ids);live.setVisible(ids,catalog[selected]?.elements||[]);if(fit)live.fit(ids);syncLayers();
  stage.dataset.ready='true';loading.hidden=false;loading.classList.add('atlas-loading-inline');loading.querySelector('span').textContent='正在细化选中结构…';
  if(refine.some(id=>!live.isRefined(id)))$('#anatomyQuality').textContent='正在细化 · 可继续旋转';
  try{await live.ensure(refine);if(epoch!==generation||request!==ticket||viewer!==live)return;live.setVisible([...shown]);live.highlight(catalog[selected]?.elements||[]);if(fit)live.fit(ids);loading.hidden=true;syncLayers();}
  catch(error){if(epoch!==generation||request!==ticket)return;loading.querySelector('span').textContent=error.message;}
 }
 async function select(id){if(!catalog[id])return;selected=id;activePreset=Object.keys(presets).find(key=>presets[key][1]===id)||null;viewer?.setOpacity(1);detail();document.querySelectorAll('.atlas-result').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.structure===id)));
  $('#anatomyCallout').textContent=label(catalog[id]);await showIds([...new Set([...shown,...catalog[id].elements])],false,catalog[id].elements);
 }
 async function reset(){
  const live=viewer,generation=epoch,ticket=++request;if(!live)return;
  selected='FMA7088';activePreset='heart';hiddenSkin=[];live.setOpacity(1);detail();$('#anatomyCallout').textContent=label(catalog[selected]);live.view('front');$('#anatomyOrientation').textContent='正面 · 人体右侧在画面左侧';
  const stage=$('#anatomyStage'),loading=$('#anatomyLoading');stage.dataset.ready='loading';loading.hidden=false;loading.classList.remove('atlas-loading-inline');loading.querySelector('span').textContent='正在准备轻量全身模型…';
  try{const ids=await live.loadLite();if(epoch!==generation||ticket!==request||live!==viewer)return;shown=new Set(ids);live.setVisible(ids);live.highlight(catalog[selected].elements);live.fit(ids);await new Promise(requestAnimationFrame);if(epoch!==generation||ticket!==request||live!==viewer)return;loading.hidden=true;stage.dataset.ready='true';syncLayers();results();completeDirectory(live,generation);const opposite=modelId==='male'?'female':'male';const later=()=>{if(viewer===live&&epoch===generation)AnatomyModel.prefetch(opposite).catch(()=>{});};if(window.requestIdleCallback)requestIdleCallback(later,{timeout:3000});else setTimeout(later,1200);}
  catch(error){if(epoch!==generation||ticket!==request)return;stage.dataset.ready='error';loading.querySelector('span').textContent=error.message;}
 }

 function completeDirectory(live,generation){const id=modelId;const perform=async signal=>{const full=await AnatomyModel.completeCatalog(id,{priority:'low',signal});if(viewer!==live||epoch!==generation)return;chooseCatalog(full);if(!document.activeElement?.closest('#anatomyDetail'))detail();if(!document.activeElement?.closest('#anatomyResults'))results();syncLayers();};if(typeof BackgroundTasks!=='undefined')BackgroundTasks.run(perform).catch(()=>{});else setTimeout(()=>perform().catch(()=>{}),300);}
 async function bind(){const generation=++epoch;const stage=$('#anatomyStage');if(stage){stage.dataset.model=modelId;stage.dataset.ready='loading';}
  try{const c=await AnatomyModel.catalog(modelId);if(epoch!==generation||!$('.atlas-page'))return;chooseCatalog(c);$('.atlas-page').outerHTML=render();bindCurrent();}catch(error){if(epoch!==generation||!$('.atlas-page'))return;$('#anatomyLoading span').textContent=error.message;$('#anatomyLoading').hidden=false;document.querySelectorAll('[data-model]').forEach(b=>b.onclick=()=>switchModel(b.dataset.model));}}
 function bindCurrent(){filter='';limit=50;selected='FMA7088';activePreset='heart';shown.clear();detail();results();
  document.querySelectorAll('[data-model]').forEach(b=>b.onclick=()=>switchModel(b.dataset.model));
  $('.atlas-page').onclick=event=>{const b=event.target.closest('[data-structure]');if(b)select(b.dataset.structure);};
  $('#anatomySearch').oninput=()=>{limit=50;results();};$('#anatomyFilter').onchange=()=>{limit=50;results();};$('#anatomyMore').onclick=()=>{limit+=50;results();};
  document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=async()=>{const id=presets[b.dataset.preset][1];await select(id);await showIds(catalog[id].elements,true);});
  document.querySelectorAll('[data-system-only]').forEach(b=>b.onclick=()=>{const ids=idsFor([b.dataset.systemOnly]);showIds(ids,true);});
  document.querySelectorAll('[data-system]').forEach(input=>input.onchange=()=>{const ids=idsFor([input.dataset.system]);if(input.checked)ids.forEach(id=>shown.add(id));else ids.forEach(id=>shown.delete(id));showIds([...shown],false,input.checked?ids:[]);});
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{viewer?.view(b.dataset.view);$('#anatomyOrientation').textContent={front:'正面 · 人体右侧在画面左侧',back:'背面 · 人体右侧在画面右侧',left:'从人体左侧观察',right:'从人体右侧观察'}[b.dataset.view];});
  $('#anatomyReset').onclick=reset;$('#anatomyCallout').onclick=()=>$('#anatomyDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
  $('#anatomySkinToggle').onclick=()=>{const skin=idsFor(['skin']).filter(id=>shown.has(id));if(skin.length){hiddenSkin=skin;skin.forEach(id=>shown.delete(id));}else{const restore=hiddenSkin.length?hiddenSkin:viewer.liteIds.filter(id=>meshes[id]?.group==='skin');restore.forEach(id=>shown.add(id));}showIds([...shown],false,[]);};
  $('#anatomySkeletonOnly').onclick=()=>showIds(idsFor(['skeleton']),true);
  try{viewer=AnatomyModel.mount($('#anatomyStage'),select,syncLayers,activeCatalog);viewer.setMarks(readMarks());const saved=sessions.get(modelId),live=viewer,generation=epoch;reset().then(async()=>{if(viewer!==live||epoch!==generation||!saved)return;selected=catalog[saved.selected]?saved.selected:'FMA7088';viewer.setOpacity(saved.opacity??1);$('#anatomyCallout').textContent=label(catalog[selected]);detail();results();viewer.setMarks(readMarks());await showIds(saved.shown,false,[]);if(viewer===live&&epoch===generation)live.restoreCamera(saved.camera);});}
  catch(error){$('#anatomyStage').dataset.ready='fallback';$('#anatomyLoading span').textContent='当前设备无法创建 WebGL 视图。仍可使用结构目录与来源资料。';}
 }
 function dispose(){remember();epoch++;request++;viewer?.dispose();viewer=null;shown.clear();}
 return {render,bind,dispose,label,get viewer(){return viewer;},get parts(){return catalog;},get modelId(){return modelId;}};
})();
