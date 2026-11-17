var state={step:'intro'},SRCH={q:''};
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function goto(page){const params=new URLSearchParams(location.search);if(SRCH.q)params.set('q',SRCH.q);params.set('intro','done');location.href='/?'+params.toString()+'#'+page;}
window.addEventListener('pagehide',()=>UpgradeUI.dispose());
