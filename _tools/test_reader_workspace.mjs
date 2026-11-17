import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('_lib/reader_ui.js', 'utf8');
const paper = {key:'21452728',pmid:'21452728',title:'肺结节影像研究',authors:'研究团队',journal:'医学影像',year:2011};
function reader(docs=[paper]) {
  let input = null;
  const context = vm.createContext({console,LIB:docs,ABS:docs.length?{'21452728':'Original abstract.'}:{},ZH:{},ZHSRC:{},
    esc:text=>String(text).replaceAll('<','&lt;'),PersonalStore:{user:null,getItem:()=>null,setItem:()=>{}},
    NotesUI:{paper:data=>data,editor:()=>''},document:{querySelector:selector=>selector==='#readerNote'?input:null},Intl,
  });
  vm.runInContext(source,context);
  return {ui:context.ReaderUI,setInput:value=>{input=value===null?null:{value};},context};
}
const loading=reader([]);
assert.match(loading.ui.render(), /正在|尚未/, '打开阅读页时题录尚未到达，应显示可恢复的加载状态');
const visitor=reader();
visitor.setInput('我的临时笔记');
assert.equal(visitor.ui.noteReport().note,'我的临时笔记','游客输入在当前页面中应当可导出');
visitor.setInput(null);
assert.equal(visitor.ui.noteReport().note,'我的临时笔记','游客切换页面后再次读取，当前会话笔记应保留');
assert.equal(reader().ui.noteReport().note,'','新浏览会话不应恢复游客私人笔记');
console.log('reader normal workflows passed');
