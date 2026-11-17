var FinalUI=(()=>{
 'use strict';
 const $=s=>document.querySelector(s);
 function nav(open){
  if(innerWidth<981)document.body.classList.toggle('nav-open',open);
  else document.body.classList.toggle('nav-collapsed',!open);
  const visible=innerWidth<981?document.body.classList.contains('nav-open'):!document.body.classList.contains('nav-collapsed');
  $('#navToggle').setAttribute('aria-expanded',String(visible));
  $('#navScrim').hidden=!document.body.classList.contains('nav-open');
 }
 $('#navToggle').onclick=()=>nav(innerWidth<981?!document.body.classList.contains('nav-open'):document.body.classList.contains('nav-collapsed'));
 $('#navScrim').onclick=()=>nav(false);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){nav(innerWidth>=981&&!document.body.classList.contains('nav-collapsed'));if(ResearchUI.state.filterOpen){ResearchUI.state.filterOpen=false;if(state.step==='search')renderMain();}}});
 function bind(){
  if(state.step==='math'){const controls=$('.sim-controls'),bar=$('#simRun')?.parentElement;if(controls&&bar){bar.classList.add('model-runbar');controls.insertBefore(bar,controls.querySelector('h2').nextSibling);}}
  $('#navScrim').hidden=!document.body.classList.contains('nav-open');
  $('#navToggle').setAttribute('aria-expanded',String(innerWidth<981?document.body.classList.contains('nav-open'):!document.body.classList.contains('nav-collapsed')));
  const toggle=()=>{ResearchUI.state.filterOpen=!ResearchUI.state.filterOpen;renderMain();$('#searchFilterToggle')?.focus();};
  $('#searchFilterToggle')?.addEventListener('click',toggle);
  $('#searchFilterClose')?.addEventListener('click',toggle);
  $('#searchCollections')?.addEventListener('click',()=>{ResearchUI.state.filterOpen=true;renderMain();$('#clipBox')?.scrollIntoView({block:'nearest'});});
 }
 return {bind};
})();
