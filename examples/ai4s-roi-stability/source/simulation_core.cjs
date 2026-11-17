/* HELIX teaching models. Fixed-step RK4; units, assumptions and exports stay explicit. */
var SimulationCore=(()=>{
 'use strict';
 const definitions={
  pk:{title:'双室分布与消除',subtitle:'改变交换与消除速率，观察两个室内的量随时间变化。',unit:'h',sources:['pk','osp'],
   defaults:{dose:100,v1:10,v2:20,k12:.35,k21:.2,ke:.12,tEnd:24,dt:.04},
   fields:[['dose','初始量（任意质量单位）',1,1000,1],['v1','中央室体积 L',1,100,1],['v2','外周室体积 L',1,100,1],['k12','中央→外周速率 h⁻¹',0,3,.01],['k21','外周→中央速率 h⁻¹',0,3,.01],['ke','消除速率 h⁻¹',0,3,.01],['tEnd','时长 h',1,72,1],['dt','步长 h',.005,.1,.005]],
   formula:"dA₁/dt = −(k₁₂ + kₑ)A₁ + k₂₁A₂；dA₂/dt = k₁₂A₁ − k₂₁A₂；dE/dt = kₑA₁。Cᵢ = Aᵢ/Vᵢ。",
   scope:'理想双室、线性交换、中央室一阶消除和瞬时初始输入。'},
  flow:{title:'血管阻力与动脉压力',subtitle:'理想管流与双元件 Windkessel，分别观察半径效应和集总压力脉动。',unit:'s',sources:['windkessel','anatomy'],
   defaults:{resistance:1.2,compliance:1.5,stroke:70,hr:72,p0:80,pv:5,tEnd:8,dt:.005},
   fields:[['resistance','外周阻力 mmHg·s/mL',.2,4,.1],['compliance','顺应性 mL/mmHg',.3,5,.1],['stroke','每搏输入体积 mL',0,120,5],['hr','频率 次/min',30,180,1],['p0','初始压力 mmHg',0,180,5],['pv','下游压力 mmHg',0,20,1],['tEnd','时长 s',2,15,1],['dt','步长 s',.001,.02,.001]],
   formula:'C·dP/dt = Qᵢₙ(t) − (P − Pᵥ)/R。半正弦流入占每周期 35%，周期积分为每搏体积。理想管流：R = 8μL/(πr⁴)，Q = ΔP/R。',
   scope:'集总动脉压力模型。理想管流采用刚性圆管、稳态层流、牛顿流体假设。'},
  sir:{title:'SIR 传播动力学',subtitle:'在封闭的假设人群中，观察易感、感染和移出状态的变化。',unit:'day',sources:['sir'],
   defaults:{population:1000,infected:10,recovered:0,beta:.28,gamma:.1,tEnd:120,dt:.1},
   fields:[['population','假设总人数',100,100000,100],['infected','初始感染人数',0,1000,1],['recovered','初始移出人数',0,1000,1],['beta','接触传播系数 day⁻¹',0,1,.01],['gamma','移出速率 day⁻¹',.01,1,.01],['tEnd','时长 day',10,300,5],['dt','步长 day',.02,.5,.02]],
   formula:'dS/dt = −βSI/N；dI/dt = βSI/N − γI；dR/dt = γI；S + I + R = N。',
   scope:'均匀混合、参数固定、无出生死亡迁移与再感染；移出包括康复或隔离等模型状态。'},
  ode:{title:'微分方程工作区',subtitle:'编辑两条常微分方程，运行、扫描参数并导出可复现脚本。',unit:'t',sources:['scipy','matlab'],
   defaults:{dx:'y',dy:'-a*x-b*y',a:1,b:.15,c:0,x0:1,y0:0,tEnd:20,dt:.02},
   fields:[['a','参数 a',-10,10,.1],['b','参数 b',-10,10,.05],['c','参数 c',-10,10,.1],['x0','初值 x(0)',-100,100,.1],['y0','初值 y(0)',-100,100,.1],['tEnd','终止时间',.1,100,.1],['dt','积分步长',.001,.2,.001]],
   formula:'dx/dt = f(t,x,y,a,b,c)；dy/dt = g(t,x,y,a,b,c)。四阶 Runge–Kutta 固定步长积分。',
   scope:'两状态常微分方程，可编辑初值、参数与积分步长。'}
 };
 const functions={sin:Math.sin,cos:Math.cos,tan:Math.tan,exp:Math.exp,log:Math.log,sqrt:Math.sqrt,abs:Math.abs};
 const variables=new Set(['x','y','t','a','b','c','pi']);
 function parse(text){
  if(typeof text!=='string'||!text.trim()||text.length>400)throw Error('表达式为空或超过 400 字符');
  const tokens=[];let pos=0;
  while(pos<text.length){const part=text.slice(pos),m=part.match(/^\s+|^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|^[A-Za-z]+|^[+\-*/^()]/i);if(!m)throw Error('表达式包含不支持的符号');pos+=m[0].length;if(!/^\s/.test(m[0]))tokens.push(m[0]);}
  let i=0,depth=0;
  const primary=()=>{if(++depth>40)throw Error('表达式嵌套过深');let n;const token=tokens[i++];
   if(token==='('){n=sum();if(tokens[i++]!==')')throw Error('括号未闭合');}
   else if(token&&/^(?:\d|\.)/.test(token)){n={type:'number',value:Number(token)};if(!Number.isFinite(n.value))throw Error('常数必须有限');}
   else if(variables.has(token))n={type:'var',name:token};
   else if(functions[token]){if(tokens[i++]!=='(')throw Error('函数需要括号');n={type:'fn',name:token,arg:sum()};if(tokens[i++]!==')')throw Error('函数括号未闭合');}
   else throw Error('未知变量或缺失数值：'+String(token||''));
   depth--;return n;
  };
  const power=()=>{let n=primary();if(tokens[i]==='^'){i++;n={type:'binary',op:'^',left:n,right:unary()};}return n;};
  const unary=()=>{if(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++];return {type:'unary',op,arg:unary()};}return power();};
  const product=()=>{let n=unary();while(tokens[i]==='*'||tokens[i]==='/'){const op=tokens[i++];n={type:'binary',op,left:n,right:unary()};}return n;};
  const sum=()=>{let n=product();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++];n={type:'binary',op,left:n,right:product()};}return n;};
  const ast=sum();if(i!==tokens.length)throw Error('表达式没有完整解析；乘法请写 *');return ast;
 }
 function evaluate(n,v){if(n.type==='number')return n.value;if(n.type==='var')return n.name==='pi'?Math.PI:Number(v[n.name]);if(n.type==='fn')return functions[n.name](evaluate(n.arg,v));if(n.type==='unary')return (n.op==='-'?-1:1)*evaluate(n.arg,v);const a=evaluate(n.left,v),b=evaluate(n.right,v);return n.op==='+'?a+b:n.op==='-'?a-b:n.op==='*'?a*b:n.op==='/'?a/b:a**b;}
 function expression(text){const ast=parse(text);const fn=v=>{const x=evaluate(ast,v);if(!Number.isFinite(x))throw Error('表达式产生非有限值；请检查定义域与参数');return x;};fn.ast=ast;return fn;}
 function emitted(n,lang){const py=lang==='python';if(n.type==='number')return String(n.value);if(n.type==='var')return n.name==='pi'?(py?'np.pi':'pi'):n.name;if(n.type==='fn')return (py?'np.':'')+n.name+'('+emitted(n.arg,lang)+')';if(n.type==='unary')return '('+n.op+emitted(n.arg,lang)+')';return '('+emitted(n.left,lang)+(n.op==='^'&&py?'**':n.op)+emitted(n.right,lang)+')';}
 function finite(x,name,min=-Infinity,max=Infinity){x=Number(x);if(!Number.isFinite(x)||x<min||x>max)throw Error(name+'超出有效范围');return x;}
 function rk4(f,y0,tEnd,dt){
  tEnd=finite(tEnd,'时长',1e-6,1000);dt=finite(dt,'步长',1e-6,1);const steps=Math.ceil(tEnd/dt);if(steps>15000)throw Error('超过 15000 步，请增大步长或缩短时长');
  let y=y0.slice(),t=0;const rows=[[0,...y]];
  const checked=(time,state)=>{const d=f(time,state);if(d.some(v=>!Number.isFinite(v)||Math.abs(v)>1e15))throw Error('模型发散或超出数值范围，请调整参数');return d;};
  for(let i=1;i<=steps;i++){const next=i===steps?tEnd:i*dt,h=next-t,k1=checked(t,y),k2=checked(t+h/2,y.map((v,j)=>v+h*k1[j]/2)),k3=checked(t+h/2,y.map((v,j)=>v+h*k2[j]/2)),k4=checked(next,y.map((v,j)=>v+h*k3[j]));y=y.map((v,j)=>v+h*(k1[j]+2*k2[j]+2*k3[j]+k4[j])/6);if(y.some(v=>!Number.isFinite(v)||Math.abs(v)>1e12))throw Error('结果发散，请调整步长或方程');t=next;rows.push([t,...y]);}
  return rows;
 }
 function model(id,input={}){
  const d=definitions[id];if(!d)throw Error('未知实验');const p={...d.defaults,...input};for(const k of Object.keys(d.defaults))if(!['dx','dy'].includes(k))p[k]=finite(p[k],k);
  let f,y0,columns,series,map=r=>r;
  if(id==='pk'){
   for(const k of ['v1','v2'])finite(p[k],k,.01,1000);finite(p.dose,'初始量',0,1e6);for(const k of ['k12','k21','ke'])finite(p[k],k,0,5);
   f=(t,y)=>[-(p.k12+p.ke)*y[0]+p.k21*y[1],p.k12*y[0]-p.k21*y[1],p.ke*y[0]];y0=[p.dose,0,0];columns=['time_h','central_concentration_au_per_L','peripheral_concentration_au_per_L','central_amount_au','peripheral_amount_au','eliminated_amount_au'];series=[{column:1,label:'中央室浓度'},{column:2,label:'外周室浓度'}];map=r=>[r[0],r[1]/p.v1,r[2]/p.v2,r[1],r[2],r[3]];
  }else if(id==='flow'){
   finite(p.resistance,'阻力',.05,20);finite(p.compliance,'顺应性',.05,20);finite(p.hr,'频率',20,240);finite(p.stroke,'每搏量',0,300);finite(p.p0,'初始压力',0,300);finite(p.pv,'下游压力',0,100);
   const period=60/p.hr,duration=.35*period;const q=t=>{const phase=t%period;return phase<duration?p.stroke*Math.PI/(2*duration)*Math.sin(Math.PI*phase/duration):0;};
   f=(t,y)=>[(q(t)-(y[0]-p.pv)/p.resistance)/p.compliance];y0=[p.p0];columns=['time_s','pressure_mmHg','inflow_mL_per_s'];series=[{column:1,label:'动脉压力 mmHg'}];map=r=>[...r,q(r[0])];
  }else if(id==='sir'){
   finite(p.population,'人数',1,1e8);finite(p.infected,'感染人数',0,p.population);finite(p.recovered,'移出人数',0,p.population-p.infected);finite(p.beta,'传播系数',0,5);finite(p.gamma,'移出系数',0,5);
   f=(t,y)=>{const n=p.beta*y[0]*y[1]/p.population;return [-n,n-p.gamma*y[1],p.gamma*y[1]];};y0=[p.population-p.infected-p.recovered,p.infected,p.recovered];columns=['time_day','susceptible','infected','removed'];series=[{column:1,label:'易感 S'},{column:2,label:'感染 I'},{column:3,label:'移出 R'}];
  }else{
   const dx=expression(p.dx),dy=expression(p.dy);f=(t,y)=>{const v={...p,t,x:y[0],y:y[1]};return [dx(v),dy(v)];};y0=[p.x0,p.y0];columns=['time','x','y'];series=[{column:1,label:'x(t)'},{column:2,label:'y(t)'}];
  }
  return {p,f,y0,columns,series,map};
 }
 function run(id,input={}){const m=model(id,input),raw=rk4(m.f,m.y0,m.p.tEnd,m.p.dt);if(['pk','sir'].includes(id)&&raw.some(r=>r.slice(1).some(v=>v < -1e-7)))throw Error('出现非物理负值，请减小步长并检查参数');return {id,parameters:m.p,columns:m.columns,series:m.series,rows:raw.map(m.map),solver:'RK4 fixed step',synthetic:true,scope:definitions[id].scope,formula:definitions[id].formula,sources:definitions[id].sources};}
 function sweep(id,input,key,values){if(!definitions[id]||!Object.hasOwn(definitions[id].defaults,key)||['dx','dy','dt','tEnd'].includes(key))throw Error('不支持扫描该参数');if(!Array.isArray(values)||values.length>12)throw Error('一次最多扫描12个参数值');return values.map(v=>{const r=run(id,{...input,[key]:v});return {parameter:v,value:r.rows.at(-1)[1],result:r};});}
 function convergence(result){const fine=run(result.id,{...result.parameters,dt:result.parameters.dt/2});const coarse=result.rows.at(-1),last=fine.rows.at(-1);return Math.max(...coarse.slice(1).map((v,i)=>Math.abs(v-last[i+1])));}
 function poiseuille(input={}){const p={radius:2,length:10,viscosity:3.5,pressure:10,...input};const r=finite(p.radius,'半径 mm',.1,20)/1000,L=finite(p.length,'长度 cm',.1,200)/100,mu=finite(p.viscosity,'黏度 mPa·s',.1,20)/1000,dp=finite(p.pressure,'压差 mmHg',0,300)*133.322387415;const SI=8*mu*L/(Math.PI*r**4);return {resistance:SI/133.322387415/1e6,flow:dp/SI*1e6,parameters:p};}
 function image(input={}){
  const p={preset:'brain',seed:42,radius:12,contrast:180,noise:15,spacing:.35,...input};if(!['brain','liver','vessel'].includes(p.preset))throw Error('未知影像模板');finite(p.radius,'半径',3,25);finite(p.noise,'噪声',0,100);finite(p.spacing,'间距',.15,1.5);finite(p.contrast,'对比度',0,500);finite(p.seed,'种子',0,4294967295);if(!Number.isInteger(p.seed))throw Error('种子必须为整数');
  const width=512,height=512,pixels=new Float64Array(width*height),truth=new Uint8Array(width*height);let seed=p.seed>>>0;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return (seed+.5)/4294967296;};
  const ellipse=(x,y,cx,cy,rx,ry)=>((x-cx)/rx)**2+((y-cy)/ry)**2<=1;
  const center={brain:[166,120],liver:[100,130],vessel:[128,128]}[p.preset];
  for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){
   const x=xx/2,y=yy/2,i=yy*width+xx;let v=-950,inside=false;
   if(p.preset==='brain'){v=-80;if(ellipse(x,y,128,128,92,110))v=220;if(ellipse(x,y,128,128,85,103))v=45+8*Math.sin(x*.14)*Math.cos(y*.1);if(ellipse(x,y,128,128,58,74))v=30;if(ellipse(x,y,117,125,7,20)||ellipse(x,y,139,125,7,20))v=5;}
   else if(p.preset==='liver'){if(ellipse(x,y,128,135,110,83))v=20;if(ellipse(x,y,95,115,66,45)||ellipse(x,y,117,144,46,30))v=75;if(ellipse(x,y,188,133,22,34))v=55;if(ellipse(x,y,128,195,12,11))v=260;}
   else {v=25;const r=Math.hypot(x-128,y-128);if(r<76)v=165;if(r<67)v=65;if(r<55)v=5;}
   const mmx=(xx-center[0]*2)*p.spacing,mmy=(yy-center[1]*2)*p.spacing;inside=(mmx/p.radius)**2+(mmy/(p.radius*.8))**2<1;
   if(inside)v+=p.contrast;
   const n=Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());pixels[i]=v+p.noise*n;truth[i]=inside?1:0;
  }
  return {width,height,pixels,truth,spacing:p.spacing,seed:p.seed,parameters:p,synthetic:true,scope:'数学合成影像；像素值为合成灰度'};
 }
 function csv(r){return '# SYNTHETIC teaching simulation; '+r.solver+'\n'+r.columns.join(',')+'\n'+r.rows.map(x=>x.map(v=>Number(v).toPrecision(12)).join(',')).join('\n')+'\n';}
 function exportCode(result,lang){
  if(!['python','matlab'].includes(lang))throw Error('未知导出语言');const py=lang==='python',p=result.parameters,d=definitions[result.id];
  let f,init,pre=[];
  if(result.id==='pk'){f=['-(k12+ke)*u[0]+k21*u[1]','k12*u[0]-k21*u[1]','ke*u[0]'];init=[p.dose,0,0];}
  if(result.id==='sir'){f=['-beta*u[0]*u[1]/population','beta*u[0]*u[1]/population-gamma*u[1]','gamma*u[1]'];init=[p.population-p.infected-p.recovered,p.infected,p.recovered];}
  if(result.id==='flow'){pre=py?['    period = 60/hr','    phase = t % period','    duration = .35*period','    q = stroke*np.pi/(2*duration)*np.sin(np.pi*phase/duration) if phase < duration else 0.0']:['    period = 60/hr; phase = mod(t,period); duration = .35*period;','    q = 0; if phase < duration, q = stroke*pi/(2*duration)*sin(pi*phase/duration); end'];f=['(q-(u[0]-pv)/resistance)/compliance'];init=[p.p0];}
  if(result.id==='ode'){f=[p.dx,p.dy].map(s=>emitted(parse(s),lang));pre=py?['    x, y = u']:['    x = u(1); y = u(2);'];init=[p.x0,p.y0];}
  const params=Object.entries(p).filter(([k])=>!['dx','dy'].includes(k)).map(([k,v])=>`${k} = ${v}${py?'':';'}`).join('\n');
  const meta=JSON.stringify({id:result.id,parameters:p,units:result.columns,scope:d.scope});
  if(py){
   const derived=result.id==='pk'?'Y = np.column_stack((u[:,0]/v1, u[:,1]/v2, u))':result.id==='flow'?'period=60/hr; duration=.35*period; phase=t%period\nq=np.where(phase<duration,stroke*np.pi/(2*duration)*np.sin(np.pi*phase/duration),0)\nY=np.column_stack((u,q))':'Y = u';
   return `# HELIX SYNTHETIC teaching model. Requires numpy, scipy, matplotlib.\n# ${meta}\n# Browser: fixed RK4. This export: independent adaptive RK45 (tight tolerances).\nimport numpy as np\nfrom scipy.integrate import solve_ivp\nimport matplotlib.pyplot as plt\n${params}\ndef rhs(t, u):\n${pre.join('\n')}\n    return [${f.join(', ')}]\nt = np.r_[np.arange(int(np.ceil(tEnd/dt)))*dt, tEnd]\nsolution = solve_ivp(rhs, [0,tEnd], ${JSON.stringify(init)}, t_eval=t, rtol=1e-9, atol=1e-11, max_step=dt)\nif not solution.success: raise RuntimeError(solution.message)\nu = solution.y.T\n${derived}\nnp.savetxt('helix-${result.id}.csv', np.column_stack((t,Y)), delimiter=',', header=${JSON.stringify(result.columns.join(','))}, comments='')\n${result.series.map(s=>`plt.plot(t, Y[:,${s.column-1}], label=${JSON.stringify(result.columns[s.column])})`).join('\n')}\nplt.xlabel(${JSON.stringify(result.columns[0])}); plt.legend(); plt.grid(alpha=.2)\nplt.title('SYNTHETIC teaching simulation')\nplt.savefig('helix-${result.id}.png', dpi=160)\nplt.close()\n`;
  }
  f=f.map(s=>s.replace(/u\[(\d)\]/g,(_,n)=>'u('+(Number(n)+1)+')'));
  const names=Object.keys(p).filter(k=>!['dx','dy'].includes(k));
  const derived=result.id==='pk'?'Y = [u(:,1)/v1, u(:,2)/v2, u];':result.id==='flow'?'period=60/hr; duration=.35*period; phase=mod(t,period);\nq=(phase<duration).*(stroke*pi/(2*duration).*sin(pi*phase/duration));\nY=[u,q];':'Y=u;';
  return `% HELIX SYNTHETIC teaching model. MATLAB R2019a+ for writematrix.\n% ${meta}\n% Independent adaptive ode45; compare to browser fixed RK4.\n${params}\ntimes=[(0:ceil(tEnd/dt)-1)*dt, tEnd];\nopts=odeset('RelTol',1e-9,'AbsTol',1e-11,'MaxStep',dt);\n[t,u]=ode45(@(t,u)rhs(t,u,${names.join(',')}),times,[${init.join(';')}],opts);\n${derived}\n% CSV columns: ${result.columns.join(',')}\nwritecell({${result.columns.map(s=>"'"+s+"'").join(',')}},'helix-${result.id}.csv');\nwritematrix([t,Y],'helix-${result.id}.csv','WriteMode','append');\nfigure; plot(t,Y(:,[${result.series.map(s=>s.column).join(' ')}])); grid on;\nxlabel('${result.columns[0]}'); title('SYNTHETIC teaching simulation');\nlegend(${result.series.map(s=>"'"+result.columns[s.column]+"'").join(',')},'Interpreter','none');\nfunction du=rhs(t,u,${names.join(',')})\n${pre.join('\n')}\n    du=[${f.join('; ')}];\nend\n`;
 }
 return {definitions,expression,run,sweep,convergence,poiseuille,image,csv,exportCode};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=SimulationCore;
