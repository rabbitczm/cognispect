/* Original teaching geometry. Relative placement is illustrative, not a diagnostic atlas. */
var AnatomyModel=(()=>{
 'use strict';
 function mount(stage,parts,onPart){
  const T=THREE,scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.1,70);
  const model=new T.Group(),shell=new T.Group();model.add(shell);scene.add(model);
  camera.position.set(0,0,14.5);camera.lookAt(0,0,0);
  const renderer=new T.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.36;
  stage.appendChild(renderer.domElement);
  const canvas=renderer.domElement;
  canvas.setAttribute('aria-label','器官与体循环血管三维教学示意，可拖动旋转并点击部件');
  scene.add(new T.HemisphereLight(0xe5f4ee,0x33434b,2));
  const front=new T.DirectionalLight(0xffede3,2.8);front.position.set(-3,5,8);scene.add(front);
  const side=new T.DirectionalLight(0xa0bec0,1.3);side.position.set(5,1,2);scene.add(side);
  const back=new T.DirectionalLight(0xb8d4d5,1.5);back.position.set(1,3,-6);scene.add(back);
  const geometries=new Set(),materials=new Set(),targets=[],byPart=new Map(),anchors={};
  let frame=0,closed=false,down=null,dragged=false,focused=false,currentLayer='all';
  const addGeometry=g=>(geometries.add(g),g);
  function material(color,opacity=1){
   const m=new T.MeshPhysicalMaterial({color,transparent:opacity<1,opacity,roughness:.66,metalness:0,
    clearcoat:.12,clearcoatRoughness:.8,depthWrite:opacity===1,side:T.DoubleSide});
   materials.add(m);return m;
  }
  const skin=material('#99b6ad',.12),bone=material('#d4d5c9',.36),
   airway=material('#c7b8a4'),lungRight=material('#9cab9c'),lungMiddle=material('#a8b8aa'),
   lungLeft=material('#9cb2a8'),brain=material('#c6a89f'),brainFold=material('#ad8c89'),
   heartMuscle=material('#aa6264'),heartUpper=material('#b87b75'),heartVessel=material('#db9781'),
   liver=material('#987158'),liverSmall=material('#aa8265'),gall=material('#788e65'),
   renal=material('#aa756e'),medulla=material('#bc9386'),pelvis=material('#e2c7a5'),
   artery=material('#bf7069'),arteryLight=material('#d88b76'),vein=material('#648bac'),veinLight=material('#89adc2');
  function register(object,part,anchor){
   if(part){object.material=object.material.clone();materials.add(object.material);object.userData.part=part;targets.push(object);if(!byPart.has(part))byPart.set(part,[]);byPart.get(part).push(object);}
   if(anchor)anchors[part]=anchor;
   return object;
  }
  function sphere(part,pos,scale,mat,warp=()=>{},parent=model){
   const g=addGeometry(new T.SphereGeometry(1,44,32)),a=g.attributes.position,v=new T.Vector3();
   for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i);warp(v);a.setXYZ(i,v.x,v.y,v.z);}
   g.computeVertexNormals();const m=new T.Mesh(g,mat);m.position.set(...pos);m.scale.set(...scale);parent.add(m);return register(m,part,pos);
  }
  function tube(part,points,r,mat,parent=model){
   const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
   const g=addGeometry(new T.TubeGeometry(curve,Math.max(24,points.length*12),r,9,false));
   const m=new T.Mesh(g,mat);parent.add(m);return register(m,part,points[Math.floor(points.length/2)]);
  }
  function plate(part,points,z,depth,mat){
   const s=new T.Shape();s.moveTo(...points[0]);for(const point of points.slice(1))s.lineTo(...point);s.closePath();
   const g=addGeometry(new T.ExtrudeGeometry(s,{depth,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.035,bevelThickness:.045,curveSegments:16}));
   const m=new T.Mesh(g,mat);m.position.z=z;model.add(m);register(m,part);
   return m;
  }
  function capsule(a,b,r1,r2){
   const start=new T.Vector3(...a),end=new T.Vector3(...b),delta=end.clone().sub(start);
   const g=addGeometry(new T.CylinderGeometry(r2,r1,delta.length(),24,1));
   const m=new T.Mesh(g,skin);m.position.copy(start.clone().add(end).multiplyScalar(.5));
   m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());shell.add(m);
   sphere(null,b,[r2,r2,r2],skin,()=>{},shell);
  }

  // Translucent body proportions and a quiet rib reference keep the internal structures legible.
  sphere(null,[0,2.78,0],[.43,.59,.39],skin,()=>{},shell);
  sphere(null,[0,1.98,0],[.23,.28,.22],skin,()=>{},shell);
  sphere(null,[0,.85,0],[.94,1.18,.49],skin,v=>{v.x*=1+.12*v.y;},shell);
  sphere(null,[0,-.41,0],[.68,.63,.4],skin,()=>{},shell);
  sphere(null,[0,-1.12,0],[.74,.49,.42],skin,()=>{},shell);
  for(const side of [-1,1]){
   capsule([side*.82,1.63,0],[side*1.18,.45,0],.22,.17);
   capsule([side*1.18,.45,0],[side*1.32,-.72,0],.17,.105);
   sphere(null,[side*1.33,-.86,.04],[.13,.23,.08],skin,()=>{},shell);
   capsule([side*.37,-1.35,0],[side*.44,-2.56,0],.28,.19);
   capsule([side*.44,-2.56,0],[side*.43,-3.62,0],.19,.105);
   sphere(null,[side*.43,-3.72,.18],[.18,.14,.34],skin,()=>{},shell);
  }
  tube(null,[[0,1.8,-.28],[0,.8,-.33],[0,-.5,-.26],[0,-1.3,-.2]],.035,bone,shell);
  for(let level=0;level<8;level++)for(const side of [-1,1]){
   const y=1.65-level*.20,w=.55+Math.sin((level+1)/9*Math.PI)*.28;
   tube(null,[[0,y,-.27],[side*w*.58,y+.04,-.22],[side*w,y-.03,.04],[side*w*.75,y-.19,.28]],.012,bone,shell);
  }

  // Cerebrum surface is sculpted; shallow ridges suggest folds without claiming sulcal accuracy.
  for(const side of [-1,1]){
   sphere('cortex',[side*.19,2.86,.01],[.24,.34,.32],brain,v=>{
    v.x+=.035*Math.sin(v.y*12+v.z*8);v.z+=.03*Math.sin(v.y*16-v.x*7);
   });
   for(let i=0;i<7;i++){
    const yy=2.67+i*.055;
    tube('cortex',[[side*.12,yy,.29],[side*.24,yy+.025,.31],[side*.34,yy-.016,.22]],.005,brainFold);
   }
  }
  sphere('cerebellum',[0,2.53,-.2],[.27,.16,.2],material('#c59e96'),v=>{v.y+=.04*Math.sin(v.x*18);});
  sphere('brainstem',[0,2.35,.04],[.105,.27,.11],material('#c9a59b'));
  anchors.cortex=[-.16,2.9,.33];anchors.cerebellum=[0,2.55,.02];anchors.brainstem=[0,2.31,.17];

  // Pulmonary lobes are distinct clickable volumes; fissures and airway branches are illustrative.
  const lobeWarp=v=>{v.x*=1-.15*v.y;v.z*=1+.08*v.y;v.y+=.035*Math.sin(v.x*5);};
  sphere('rightUpper',[-.5,1.42,.02],[.33,.4,.29],lungRight,lobeWarp);
  sphere('rightMiddle',[-.59,.99,.09],[.31,.25,.29],lungMiddle,lobeWarp);
  sphere('rightLower',[-.56,.58,.04],[.39,.42,.32],lungRight,lobeWarp);
  sphere('leftUpper',[.53,1.35,.02],[.32,.48,.28],lungLeft,v=>{lobeWarp(v);if(v.x<0&&v.y<0)v.x+=.16;});
  sphere('leftLower',[.55,.68,.04],[.37,.42,.31],lungMiddle,lobeWarp);
  anchors.rightUpper=[-.53,1.43,.32];anchors.rightMiddle=[-.59,1.04,.35];anchors.rightLower=[-.55,.59,.37];
  anchors.leftUpper=[.55,1.4,.31];anchors.leftLower=[.55,.72,.36];
  tube('trachea',[[0,2.31,.17],[0,1.97,.2],[0,1.65,.21]],.06,airway);
  for(let i=0;i<7;i++){
   const g=addGeometry(new T.TorusGeometry(.062,.009,6,20));
   const m=new T.Mesh(g,material('#e2cabb'));m.rotation.x=Math.PI/2;m.position.set(0,1.72+i*.078,.21);model.add(m);register(m,'trachea');
  }
  for(const side of [-1,1]){
   tube('bronchi',[[0,1.64,.22],[side*.18,1.51,.22],[side*.39,1.32,.2]],.043,airway);
   for(const y of [1.43,1.12,.78])tube('bronchi',[[side*.37,1.3,.2],[side*.50,y,.22],[side*.66,y-.08,.24]],.014,material('#d0bda9'));
  }
  anchors.trachea=[0,2.08,.28];anchors.bronchi=[-.21,1.5,.28];

  // External four-chamber silhouette and coronary path; no internal septa or valves are inferred.
  sphere('rightAtrium',[-.10,1.08,.34],[.16,.15,.13],heartUpper,v=>{v.x*=1+.15*v.y;});
  sphere('leftAtrium',[.20,1.11,.30],[.16,.14,.12],material('#ad6969'),v=>{v.x*=1+.13*v.y;});
  sphere('rightVentricle',[-.09,.77,.42],[.22,.34,.19],heartMuscle,v=>{
   const taper=.8+.25*v.y;v.x=v.x*taper+.045*(1-v.y);v.z*=taper;
  });
  sphere('leftVentricle',[.18,.75,.40],[.25,.41,.22],material('#b46e6c'),v=>{
   const taper=.68+.35*v.y;v.x=v.x*taper+.09*(1-v.y);v.z*=taper;
  });
  tube('aorticRoot',[[.19,1.06,.38],[.25,1.28,.33],[.14,1.44,.26]],.067,arteryLight);
  tube('pulmonaryTrunk',[[-.12,1.02,.42],[-.19,1.24,.43],[-.42,1.38,.34]],.066,material('#859eaa'));
  tube('coronary',[[.03,1.0,.57],[.12,.91,.62],[.21,.72,.59],[.18,.55,.52]],.018,heartVessel);
  tube('coronary',[[.02,.98,.55],[-.1,.86,.59],[-.18,.67,.52]],.012,heartVessel);
  anchors.rightAtrium=[-.09,1.1,.56];anchors.leftAtrium=[.2,1.13,.51];
  anchors.rightVentricle=[-.1,.72,.61];anchors.leftVentricle=[.2,.7,.62];anchors.coronary=[.11,.88,.66];
  anchors.aorticRoot=[.22,1.32,.4];anchors.pulmonaryTrunk=[-.25,1.28,.47];

  // Broad hepatic surface, smaller left lobe, gallbladder and paired kidneys.
  plate('liverRight',[[-.93,.12],[-.61,.21],[-.13,.1],[-.08,-.27],[-.34,-.43],[-.81,-.35]],.21,.24,liver);
  plate('liverLeft',[[-.16,.08],[.17,.08],[.39,-.08],[.26,-.28],[-.1,-.27]],.20,.20,liverSmall);
  sphere('gallbladder',[-.44,-.36,.47],[.085,.20,.07],gall);
  anchors.liverRight=[-.54,-.09,.51];anchors.liverLeft=[.17,-.09,.48];anchors.gallbladder=[-.44,-.36,.55];
  for(const side of [-1,1]){
   const y=side<0?-.65:-.51;
   sphere('kidneyCortex',[side*.59,y,-.05],[.23,.36,.18],renal,v=>{
    const inner=side*v.x<0?1:0;v.x-=side*inner*.22*Math.exp(-v.y*v.y*7);
   });
  }
  sphere('kidneyMedulla',[.58,-.51,.115],[.14,.26,.045],medulla,v=>{v.x*=1-.1*v.y;});
  for(let i=-1;i<=1;i++)sphere('kidneyMedulla',[.59+i*.07,-.51+i*.10,.165],[.045,.08,.028],material('#986763'));
  sphere('renalPelvis',[.41,-.52,.16],[.075,.15,.07],pelvis);
  tube('ureter',[[.42,-.57,.17],[.35,-1.02,.12],[.17,-1.44,.17]],.022,pelvis);
  tube('ureter',[[-.42,-.67,.13],[-.32,-1.06,.12],[-.16,-1.44,.17]],.022,pelvis);
  anchors.kidneyCortex=[.62,-.53,.17];anchors.kidneyMedulla=[.63,-.54,.21];
  anchors.renalPelvis=[.42,-.52,.24];anchors.ureter=[.27,-1.05,.2];

  // Systemic arteries and veins are classified by flow direction, not by oxygen color.
  tube('aorta',[[.2,1.08,.43],[.3,1.43,.33],[.09,1.52,.25],[-.02,1.29,.13],[.05,.12,.11],[.05,-1.25,.12]],.052,artery);
  for(const side of [-1,1]){
   tube('carotid',[[.09,1.50,.24],[side*.16,1.87,.18],[side*.21,2.36,.13],[side*.17,2.59,.10]],.022,arteryLight);
   tube('brachial',[[.1,1.45,.24],[side*.78,1.63,.2],[side*1.10,.95,.17],[side*1.26,.30,.15],[side*1.34,-.70,.14]],.025,artery);
   tube('femoral',[[.05,-1.24,.14],[side*.38,-1.51,.17],[side*.44,-2.55,.15],[side*.43,-3.57,.12]],.029,artery);
   tube('renalArtery',[[.05,-.48,.14],[side*.35,-.51,.14],[side*.49,-.51,.11]],.02,arteryLight);
  }
  tube('superiorVena',[[-.18,1.85,.15],[-.16,1.36,.2],[-.12,.99,.33]],.052,vein);
  tube('inferiorVena',[[-.13,.69,.25],[-.16,-.25,.14],[-.15,-1.25,.14]],.055,vein);
  for(const side of [-1,1]){
   tube('jugular',[[-.18,1.83,.14],[side*.28,2.14,.16],[side*.26,2.59,.12]],.022,veinLight);
   tube('femoralVein',[[-.15,-1.25,.13],[side*.29,-1.62,.2],[side*.36,-2.55,.19],[side*.37,-3.57,.15]],.034,vein);
   tube('renalVein',[[-.15,-.49,.17],[side*.37,-.51,.2],[side*.48,-.52,.18]],.022,veinLight);
  }
  anchors.aorta=[.05,.85,.21];anchors.carotid=[-.2,2.15,.19];anchors.brachial=[-1.1,.85,.2];
  anchors.femoral=[-.43,-2.4,.2];anchors.renalArtery=[.34,-.51,.21];
  anchors.superiorVena=[-.15,1.45,.28];anchors.inferiorVena=[-.15,-.35,.22];
  anchors.jugular=[.26,2.3,.2];anchors.femoralVein=[.36,-2.4,.25];anchors.renalVein=[-.4,-.5,.25];

  const raycaster=new T.Raycaster(),pointer=new T.Vector2();
  function positionLabels(){
   const width=stage.clientWidth,height=stage.clientHeight,svg=stage.querySelector('.anatomy-leaders');
   if(!width||!height||!svg)return;
   svg.setAttribute('viewBox',`0 0 ${width} ${height}`);model.updateMatrixWorld(true);
   const groups={left:[],right:[]};
   for(const button of stage.querySelectorAll('[data-callout]')){
    const part=parts[button.dataset.callout],anchor=anchors[button.dataset.callout];
    if(!part||!anchor||button.hidden)continue;
    const projected=new T.Vector3(...anchor).applyMatrix4(model.matrixWorld).project(camera);
    const px=(projected.x+1)*width/2,py=(1-projected.y)*height/2;
    groups[part.side==='right'?'right':'left'].push({button,px,py});
   }
   for(const [side,items] of Object.entries(groups)){
    items.sort((a,b)=>a.py-b.py);
    const room=Math.max(34,height-90),gap=Math.min(48,room/Math.max(1,items.length));
    let previous=38;
    for(const item of items){item.cy=Math.max(previous+gap,Math.min(height-45,item.py));previous=item.cy;}
    const excess=Math.max(0,previous-(height-44));
    for(const item of items){
     item.cy-=excess;const b=item.button,buttonWidth=b.offsetWidth;
     const x=side==='left'?12:width-buttonWidth-12;
     b.style.left=x+'px';b.style.top=(item.cy-b.offsetHeight/2)+'px';
     const path=svg.querySelector(`[data-leader="${b.dataset.callout}"]`);
     if(path){const start=side==='left'?x+buttonWidth:x;const bend=side==='left'?start+18:start-18;
      path.setAttribute('d',`M${start} ${item.cy} L${bend} ${item.cy} L${item.px.toFixed(1)} ${item.py.toFixed(1)}`);}
    }
   }
  }
  function draw(){if(closed)return;renderer.render(scene,camera);positionLabels();}
  function schedule(){if(frame||closed)return;frame=requestAnimationFrame(()=>{frame=0;draw();});}
  function resize(){const box=stage.getBoundingClientRect();if(!box.width||!box.height)return;
   renderer.setSize(box.width,box.height);camera.aspect=box.width/box.height;camera.updateProjectionMatrix();schedule();}
  const observer=new ResizeObserver(resize);observer.observe(stage);
  canvas.onpointerdown=ev=>{down=[ev.clientX,ev.clientY,model.rotation.y,model.rotation.x];dragged=false;canvas.setPointerCapture(ev.pointerId);};
  canvas.onpointermove=ev=>{if(!down)return;const dx=ev.clientX-down[0],dy=ev.clientY-down[1];if(Math.abs(dx)+Math.abs(dy)>5)dragged=true;
   model.rotation.y=down[2]+dx*.009;model.rotation.x=Math.max(-.5,Math.min(.5,down[3]+dy*.006));schedule();};
  canvas.onpointerup=ev=>{if(down&&!dragged){const b=canvas.getBoundingClientRect();
    pointer.set((ev.clientX-b.left)/b.width*2-1,1-(ev.clientY-b.top)/b.height*2);raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(targets.filter(x=>x.visible),false)[0];if(hit)onPart(hit.object.userData.part);}
   down=null;};
  canvas.onpointercancel=()=>{down=null;};
  const wheel=ev=>{ev.preventDefault();camera.position.z=Math.max(5,Math.min(22,camera.position.z+ev.deltaY*.009));schedule();};
  canvas.addEventListener('wheel',wheel,{passive:false});
  function show(layer){currentLayer=layer;focused=false;shell.visible=true;for(const target of targets){const organ=parts[target.userData.part]?.organ;
    target.visible=layer==='all'||layer==='organs'&&!['arteries','veins'].includes(organ)||organ===layer;}
   schedule();}
  function highlight(part){for(const [id,objects] of byPart){for(const object of objects){
    object.material.emissive.set(id===part?'#39403a':'#000000');object.material.emissiveIntensity=id===part?.22:0;
   }}schedule();}
  function focus(organ){const center={brain:2.73,lungs:1.21,heart:.86,liver:-.13,kidneys:-.56,arteries:.15,veins:.15}[organ]||0;
   shell.visible=false;for(const target of targets)target.visible=parts[target.userData.part]?.organ===organ;
   camera.position.set(0,center,({brain:3.6,lungs:5.2,heart:3.8,liver:4.2,kidneys:4.4,arteries:14.5,veins:14.5})[organ]||7.4);
   camera.lookAt(0,center,0);focused=true;schedule();}
  function reset(){model.rotation.set(0,0,0);camera.position.set(0,0,14.5);camera.lookAt(0,0,0);show(currentLayer);schedule();}
  function dispose(){closed=true;cancelAnimationFrame(frame);observer.disconnect();canvas.removeEventListener('wheel',wheel);
   canvas.onpointerdown=canvas.onpointermove=canvas.onpointerup=canvas.onpointercancel=null;
   for(const g of geometries)g.dispose();for(const m of materials)m.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
  resize();
  return {show,highlight,focus,reset,dispose,positionLabels,get focused(){return focused;}};
 }
 return {mount};
})();
