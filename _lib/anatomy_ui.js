/* Interactive anatomy teaching schematic; labels describe modeled regions, not atlas accuracy. */
var AnatomyUI=(()=>{
 'use strict';
 const $=s=>document.querySelector(s),e=s=>esc(String(s??''));
 const source={
  lungs:'https://openstax.org/books/anatomy-and-physiology-2e/pages/22-1-organs-and-structures-of-the-respiratory-system',
  brain:'https://openstax.org/books/anatomy-and-physiology-2e/pages/13-2-the-central-nervous-system',
  heart:'https://openstax.org/books/anatomy-and-physiology-2e/pages/19-1-heart-anatomy',
  liver:'https://openstax.org/books/anatomy-and-physiology-2e/pages/23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder',
  kidneys:'https://openstax.org/books/anatomy-and-physiology-2e/pages/25-3-gross-anatomy-of-the-kidney',
  arteries:'https://openstax.org/books/anatomy-and-physiology-2e/pages/20-5-circulatory-pathways',
  veins:'https://openstax.org/books/anatomy-and-physiology-2e/pages/20-5-circulatory-pathways'
 };
 const organs={
  lungs:{name:'肺与气道',short:'肺',en:'RESPIRATORY',system:'呼吸系统',color:'#9eafa4',function:'空气经气管、支气管到达肺内；肺泡周围的气血界面完成氧与二氧化碳交换。图中只画较大的气道和肺叶外形，没有画肺泡或肺循环。',diseases:[['肺结节','lung nodule'],['哮喘','asthma'],['肺炎','pneumonia']],experiment:'flow',experimentName:'血流动力学',limit:'肺叶分界和外形是示意；肺结节不是癌症或肺结核诊断。'},
  brain:{name:'脑',short:'脑',en:'CENTRAL NERVOUS SYSTEM',system:'神经系统',color:'#c6a89f',function:'大脑、小脑与脑干共同参与感觉、运动、平衡和生命维持。表面纹理是几何提示，不对应真实脑沟或功能分区。',diseases:[['脑卒中','stroke'],['胶质瘤','glioma']],experiment:'image',preset:'brain',experimentName:'脑部影像与 ROI',limit:'未画左右脑精确功能定位、脑血管或病变。'},
  heart:{name:'心脏',short:'心脏',en:'HEART',system:'循环系统',color:'#b4706e',function:'左右心房接受回流，左右心室将血液泵入肺循环或体循环；大血管根部连接流出道，冠状动脉供应心肌。绘制的分区仅为外表提示，未建立心腔、瓣膜或电传导模型。',diseases:[['冠状动脉疾病','coronary artery disease'],['心力衰竭','heart failure']],experiment:'flow',experimentName:'集总动脉压力模型',limit:'Windkessel 只模拟动脉压力的集总关系，不识别心脏疾病。'},
  liver:{name:'肝脏与胆囊',short:'肝胆',en:'LIVER & GALLBLADDER',system:'消化系统',color:'#a57a60',function:'肝脏参与营养和药物代谢并产生胆汁；胆囊储存、浓缩胆汁。这里的肝叶边界和胆囊形态经过简化。',diseases:[['肝纤维化','liver fibrosis'],['肝细胞癌','hepatocellular carcinoma']],experiment:'image',preset:'liver',experimentName:'肝脏示意影像与 ROI',limit:'没有画肝段、门静脉、胆管树或真实病灶。'},
  kidneys:{name:'肾脏与输尿管',short:'肾',en:'KIDNEY',system:'泌尿系统',color:'#ae8178',function:'皮质与髓质参与滤过和尿液浓缩；尿液经肾盂、输尿管向下输送。单侧切面只显示示意分层。',diseases:[['慢性肾脏病','chronic kidney disease'],['肾癌','renal cell carcinoma']],experiment:'pk',experimentName:'双室分布与消除模型',limit:'中央室不是肾脏，不能从该模型推算肾功能或个人剂量。'},
  arteries:{name:'体循环动脉',short:'动脉',en:'SYSTEMIC ARTERIES',system:'血管',color:'#c77d75',function:'动脉将血液从心脏输向组织。示意包含主动脉、颈动脉、上肢、肾与下肢分支；不包括完整血管树。',diseases:[['动脉粥样硬化','atherosclerosis'],['动脉瘤','aneurysm'],['外周动脉疾病','peripheral artery disease']],experiment:'flow',experimentName:'理想管流与动脉压力',limit:'红色只区分血管类别，不保证所有动脉血液含氧高；未显示肺动脉。'},
  veins:{name:'体循环静脉',short:'静脉',en:'SYSTEMIC VEINS',system:'血管',color:'#7e9eb5',function:'静脉将血液从组织带回心脏。示意包含上下腔静脉、颈静脉、肾和下肢静脉；未建模瓣膜或侧支循环。',diseases:[['深静脉血栓','deep vein thrombosis'],['静脉曲张','varicose veins']],experiment:'flow',experimentName:'理想管流：理解阻力',limit:'动脉 Windkessel 不适用于静脉血栓或瓣膜疾病诊断。'}
 };
 const parts={
  trachea:{organ:'lungs',name:'气管',function:'软骨环支撑主要气道；空气经气管进入左右主支气管。',side:'right'},
  bronchi:{organ:'lungs',name:'主支气管',function:'将空气由气管分配到左右肺，并继续分支至更细气道。图中没有画出全部细支气管。',side:'right'},
  rightUpper:{organ:'lungs',name:'右上叶',function:'右肺三叶中的上部区域；所属肺泡参与气体交换。图形没有画出精确肺段。',side:'left'},
  rightMiddle:{organ:'lungs',name:'右中叶',function:'右肺三叶中的中间区域；所属肺泡参与气体交换。',side:'left'},
  rightLower:{organ:'lungs',name:'右下叶',function:'右肺下部区域；与其他肺叶共同承担通气和气体交换。',side:'left'},
  leftUpper:{organ:'lungs',name:'左上叶',function:'左肺两叶中的上部区域；所属肺泡参与气体交换。',side:'right'},
  leftLower:{organ:'lungs',name:'左下叶',function:'左肺下部区域；所属肺泡参与气体交换。',side:'right'},
  cortex:{organ:'brain',name:'大脑皮质',function:'参与感觉处理、随意运动和较高级认知活动；不同皮质区有不同功能，本模型未进行功能定位。',side:'left'},
  cerebellum:{organ:'brain',name:'小脑',function:'参与运动协调、姿势和平衡调节；图中位于大脑后下方。',side:'right'},
  brainstem:{organ:'brain',name:'脑干',function:'连接大脑、脊髓与小脑，参与呼吸、心血管等基本生命活动的调节。',side:'right'},
  rightAtrium:{organ:'heart',name:'右心房',function:'接受来自体循环静脉的回流血液；模型只标示其近似外表位置。',side:'left'},
  leftAtrium:{organ:'heart',name:'左心房',function:'接受肺静脉回流的血液；模型没有画出肺静脉或心房内部。',side:'right'},
  rightVentricle:{organ:'heart',name:'右心室',function:'将血液泵向肺循环；本页没有画出肺动脉和瓣膜。',side:'left'},
  leftVentricle:{organ:'heart',name:'左心室',function:'将血液泵入主动脉及体循环；心室外形并非真实医学分割。',side:'right'},
  coronary:{organ:'heart',name:'冠状动脉',function:'为心肌提供血液供应；模型只画表面部分走行，不显示冠脉分型和狭窄。',side:'right'},
  aorticRoot:{organ:'heart',name:'主动脉根部',function:'连接左心室流出道与主动脉；模型未显示主动脉瓣或冠状动脉开口。',side:'right'},
  pulmonaryTrunk:{organ:'heart',name:'肺动脉干',function:'连接右心室流出道和肺循环；图中只画近端短段，未重建肺动脉分支。',side:'left'},
  liverRight:{organ:'liver',name:'肝右叶',function:'肝组织参与物质代谢、胆汁产生和多种蛋白合成；页面没有细分肝段。',side:'left'},
  liverLeft:{organ:'liver',name:'肝左叶',function:'肝左叶与其余肝组织共同参与代谢和胆汁生成；轮廓经过简化。',side:'right'},
  gallbladder:{organ:'liver',name:'胆囊',function:'储存和浓缩肝脏产生的胆汁，并在进食后参与释放。',side:'left'},
  kidneyCortex:{organ:'kidneys',name:'肾皮质',function:'含肾小球及部分肾小管，是血液滤过与早期尿液形成的重要区域。',side:'right'},
  kidneyMedulla:{organ:'kidneys',name:'肾髓质',function:'包含髓袢和集合管等结构，参与水与溶质重吸收及尿液浓缩。',side:'right'},
  renalPelvis:{organ:'kidneys',name:'肾盂',function:'汇集肾内形成的尿液，并向输尿管输送；图中只画示意腔体。',side:'left'},
  ureter:{organ:'kidneys',name:'输尿管',function:'将尿液由肾盂输送到膀胱方向；本图未完整绘制膀胱。',side:'left'},
  aorta:{organ:'arteries',name:'主动脉',function:'承接左心室射出的血液并向体循环主要分支输送；这里是简化主干。',side:'right'},
  carotid:{organ:'arteries',name:'颈动脉',function:'向头颈部供血，是主动脉弓分支系统的一部分；本图未显示颅内分支。',side:'right'},
  brachial:{organ:'arteries',name:'上肢动脉',function:'沿上肢走行并向手臂组织供血；此处合并多级分支。',side:'left'},
  renalArtery:{organ:'arteries',name:'肾动脉',function:'由体循环动脉向肾脏输送血液；滤过发生在肾微循环。',side:'right'},
  femoral:{organ:'arteries',name:'股动脉',function:'向下肢供血，是下肢主要动脉通路之一。',side:'left'},
  superiorVena:{organ:'veins',name:'上腔静脉',function:'将头颈和上肢等区域的静脉回流输向右心房。',side:'right'},
  inferiorVena:{organ:'veins',name:'下腔静脉',function:'将下半身静脉回流输向右心房；肾静脉等汇入其主干。',side:'right'},
  jugular:{organ:'veins',name:'颈静脉',function:'将头颈部静脉血回流至上腔静脉系统；图中合并多条真实血管。',side:'right'},
  renalVein:{organ:'veins',name:'肾静脉',function:'将来自肾脏的静脉血汇入下腔静脉系统。',side:'left'},
  femoralVein:{organ:'veins',name:'股静脉',function:'将下肢部分静脉血回流至腹盆腔静脉系统。',side:'left'}
 };
 let selected='lungs',selectedPart='trachea',layer='all',viewer=null;
 const firstPart=id=>Object.keys(parts).find(key=>parts[key].organ===id);
 function detail(){const d=organs[selected],ids=Object.keys(parts).filter(id=>parts[id].organ===selected),p=parts[selectedPart]||parts[ids[0]];
  return `<div class="organ-heading"><span class="section-eyebrow">${e(d.en)}</span><h2>${e(d.name)}</h2><span class="organ-system">${e(d.system)}</span></div>
   <p class="anatomy-overview">${e(d.function)}</p><h3>结构与功能</h3>
   <div id="anatomyParts" class="anatomy-parts" aria-label="${e(d.name)}的部件">${ids.map(id=>`<button data-part="${id}" aria-pressed="${selectedPart===id}">${e(parts[id].name)}</button>`).join('')}</div>
   <div class="part-function" aria-live="polite"><span>当前部件</span><strong id="anatomyPartName">${e(p.name)}</strong><p id="anatomyPartFunction">${e(p.function)}</p></div>
   <h3>可检索的疾病主题</h3><div class="disease-topics">${d.diseases.map(([name,q])=>`<button class="expchip" data-disease="${e(q)}">${e(name)} ↗</button>`).join('')}</div>
   <p class="hint">疾病按钮只检索本地文献，不判断个人疾病。</p>
   <div class="organ-action"><span>对应教学实验</span><strong>${e(d.experimentName)}</strong><button class="btn" id="anatomyExperiment">打开实验</button></div>
   <p class="hint">${e(d.limit)}</p><a class="anatomy-source" href="${source[selected]}" target="_blank" rel="noopener noreferrer">OpenStax 解剖与生理教材 ↗</a>`;
 }
 function render(){return `<div class="work-page anatomy-page"><div class="work-head"><div><div class="overline">交互人体 / 器官与循环</div><h1>人体结构与功能</h1><p>选择器官及细分部件，查看功能、相关文献主题与教学实验。</p></div><span class="stamp">教学几何 · 非临床解剖图谱</span></div>
  <div class="anatomy-layout"><section class="anatomy-view glass"><div class="anatomy-toolbar"><div class="segmented-control" aria-label="显示图层">${[['all','全部'],['organs','器官'],['arteries','动脉'],['veins','静脉']].map(([id,label])=>`<button data-layer="${id}" aria-pressed="${layer===id}">${label}</button>`).join('')}</div><div class="anatomy-view-actions"><button id="anatomyFocus" class="btn ghost tiny" title="放大当前器官">聚焦部位</button><button id="anatomyReset" class="btn ghost tiny" title="恢复完整人体正面视角">完整视角</button></div></div>
   <div id="anatomyStage" class="anatomy-stage" data-ready="false" aria-label="可旋转的人体三维教学模型"><div class="anatomy-caption"><span>正面视角 · 人体右侧位于画面左边</span><span>拖动旋转 · 滚轮缩放</span></div><div class="anatomy-loading">正在准备三维视图...</div><svg class="anatomy-leaders" aria-hidden="true"></svg>${Object.entries(parts).map(([id,p])=>`<button class="anatomy-callout" data-callout="${id}" data-organ-group="${p.organ}" title="${e(p.name)}：${e(p.function)}" hidden>${e(p.name)}</button>`).join('')}<div class="anatomy-legend"><span><i class="artery-dot"></i>动脉</span><span><i class="vein-dot"></i>静脉</span></div></div>
   <div class="organ-picker" aria-label="选择部位">${Object.entries(organs).map(([id,d])=>`<button data-organ="${id}" aria-pressed="${selected===id}"><i style="background:${d.color}"></i>${e(d.short)}</button>`).join('')}</div><div class="anatomy-footnote">原创参数化三维教学示意。比例、纹理、形状与分支并非逐点真实解剖；未显示全部器官和微观结构。动静脉按流向分类，颜色不等于含氧量。部件名称及功能参考下方教材入口。</div></section>
   <aside class="glass anatomy-detail" id="anatomyDetail">${detail()}</aside></div></div>`;}
 function refreshLabels(){const stage=$('#anatomyStage');if(!stage)return;
  const visible=layer==='all'||layer==='organs'?selected:layer;
  for(const button of stage.querySelectorAll('[data-callout]'))button.hidden=button.dataset.organGroup!==visible;
  const svg=stage.querySelector('.anatomy-leaders');svg.replaceChildren();
  for(const button of stage.querySelectorAll('[data-callout]:not([hidden])')){
   const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.dataset.leader=button.dataset.callout;svg.appendChild(path);
   button.setAttribute('aria-pressed',button.dataset.callout===selectedPart);
  }
  viewer?.positionLabels();
 }
 function bindDetail(){const d=organs[selected];$('#anatomyExperiment').onclick=()=>SimulationUI.openExperiment(d.experiment,d.preset);
  document.querySelectorAll('#anatomyParts [data-part]').forEach(button=>button.onclick=()=>selectPart(button.dataset.part));
  document.querySelectorAll('[data-disease]').forEach(button=>button.onclick=()=>{
   SRCH.q=button.dataset.disease;SRCH.groups=null;SRCH.field='all';SRCH._sq=null;SRCH.years=[];SRCH.topics=[];
   SRCH.journals=[];SRCH.onlyV=false;SRCH.hasAbs=false;SRCH.oa=false;SRCH.zhOnly=false;SRCH.yearFrom=0;SRCH.page=1;goto('search');
  });}
 function selectPart(id){const p=parts[id];if(!p)return;
  if(selected!==p.organ){selected=p.organ;selectedPart=id;$('#anatomyDetail').innerHTML=detail();bindDetail();}
  selectedPart=id;$('#anatomyPartName').textContent=p.name;$('#anatomyPartFunction').textContent=p.function;
  document.querySelectorAll('[data-organ]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.organ===selected));
  document.querySelectorAll('#anatomyParts [data-part]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.part===id));
  refreshLabels();viewer?.highlight(id);
 }
 function selectOrgan(id){if(!organs[id])return;if(viewer?.focused)viewer.reset();selected=id;selectedPart=firstPart(id);$('#anatomyDetail').innerHTML=detail();bindDetail();
  if(layer!=='all'&&layer!==id&&!(layer==='organs'&&!['arteries','veins'].includes(id))){layer='all';document.querySelectorAll('[data-layer]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.layer==='all'));viewer?.show('all');}
  document.querySelectorAll('[data-organ]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.organ===id));
  refreshLabels();viewer?.highlight(selectedPart);
 }
 function dispose(){viewer?.dispose();viewer=null;}
 function bind(){document.querySelectorAll('[data-organ]').forEach(button=>button.onclick=()=>selectOrgan(button.dataset.organ));
  document.querySelectorAll('[data-callout]').forEach(button=>button.onclick=()=>selectPart(button.dataset.callout));
  document.querySelectorAll('[data-layer]').forEach(button=>button.onclick=()=>{
   layer=button.dataset.layer;document.querySelectorAll('[data-layer]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.layer===layer));
   if(layer==='arteries'||layer==='veins')selectOrgan(layer);viewer?.show(layer);refreshLabels();
  });
  $('#anatomyFocus').onclick=()=>viewer?.focus(selected);$('#anatomyReset').onclick=()=>viewer?.reset();bindDetail();
  try{viewer=AnatomyModel.mount($('#anatomyStage'),parts,selectPart);viewer.show(layer);viewer.highlight(selectedPart);
   $('#anatomyStage').querySelector('.anatomy-loading')?.remove();$('#anatomyStage').dataset.ready='true';refreshLabels();}
  catch(error){dispose();const loading=$('.anatomy-loading');if(loading)loading.textContent='当前设备无法显示 WebGL 三维模型。仍可使用部位与结构按钮查看功能、教材和实验。';$('#anatomyStage').dataset.ready='fallback';}
 }
 return {render,bind,dispose,organs,parts};
})();
