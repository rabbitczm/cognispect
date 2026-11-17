var BrowserCompute = (() => {
  'use strict';
  let worker, sequence = 0;
  const pending = new Map();
  function bar(message) {
    let element = document.querySelector('#browserComputeStatus');
    if (!element) {
      element = document.createElement('div');
      element.id = 'browserComputeStatus';
      element.className = 'browser-compute-status';
      element.innerHTML = '<span role="status" aria-live="polite"></span><button type="button">取消</button>';
      element.querySelector('button').onclick = cancel;
      document.body.append(element);
    }
    element.hidden = !message;
    element.querySelector('span').textContent = message || '';
  }
  function start() {
    if (worker) return;
    worker = new Worker('/assets/browser-compute-worker.js');
    worker.onmessage = ({data}) => {
      const job = pending.get(data.id);
      if (!job) return;
      if (data.progress) { bar(data.progress); job.onProgress?.(data.progress); return; }
      pending.delete(data.id);
      job.cleanup();
      if (data.error) job.reject(Error(data.error));
      else job.resolve(data.result);
      if (!pending.size) bar('');
    };
    worker.onerror = event => cancel(Error(event.message || '分析环境无法加载，请重试'));
  }
  function cancel(reason) {
    worker?.terminate(); worker = null;
    const error = reason instanceof Error ? reason : new DOMException('已取消本次分析', 'AbortError');
    for (const job of pending.values()) { job.cleanup(); job.reject(error); }
    pending.clear(); bar('');
  }
  function request(operation, data, options = {}) {
    const module = {stats:'stats', fit:'math', pdf:'pdf'}[operation];
    if (window.ZHIJING_RUNTIME === 'cloud' && window.SiteUI && !SiteUI.allowed(module))
      return Promise.reject(Error('此功能暂未公开'));
    if (options.signal?.aborted) return Promise.reject(new DOMException('已取消本次分析', 'AbortError'));
    start();
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const abort = () => cancel();
      options.signal?.addEventListener('abort', abort, {once: true});
      pending.set(id, {resolve, reject, onProgress: options.onProgress,
        cleanup: () => options.signal?.removeEventListener('abort', abort)});
      bar('正在准备分析…');
      worker.postMessage({id, operation, data}, operation === 'pdf' && data.bytes instanceof ArrayBuffer ? [data.bytes] : []);
    });
  }
  return {request, cancel, get enabled() {return window.ZHIJING_RUNTIME === 'cloud';}};
})();

var BrowserPdf = (() => {
  'use strict';
  let connection;
  const temporary=new Map();
  const owner = () => typeof PersonalStore !== 'undefined' && PersonalStore.user ? PersonalStore.user.id : 'guest';
  function db() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const opening = indexedDB.open('zhijing-pdf-v19', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('documents', {keyPath: 'key'});
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    return connection;
  }
  async function transact(mode, operation) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction('documents', mode);
      const request = operation(transaction.objectStore('documents'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async function save(document, file) {
    const record = {...document}; delete record.url;
    if(owner()==='guest'){temporary.set(record.id,{document:record,file});return {...record,url:URL.createObjectURL(file),browser_local:true};}
    await transact('readwrite', store => store.put({key: owner() + ':' + record.id, owner: owner(), document: record, file}));
    return {...record, url: URL.createObjectURL(file), browser_local: true};
  }
  async function get(id) {
    const record = owner()==='guest'?temporary.get(id):await transact('readonly', store => store.get(owner() + ':' + id));
    return record ? {...record.document, url: URL.createObjectURL(record.file), browser_local: true} : null;
  }
  async function list() {
    const records = owner()==='guest'?[...temporary.values()]:await transact('readonly', store => store.getAll());
    return records.filter(record => owner()==='guest'||record.owner === owner()).map(record => {
      const {pages, tables, text, ...summary} = record.document;
      return {...summary, browser_local: true};
    });
  }
  async function clearPrivate(){
    temporary.clear();
    const current=owner();if(current==='guest')return;
    const records=await transact('readonly',store=>store.getAll());
    for(const record of records.filter(r=>r.owner===current))await transact('readwrite',store=>store.delete(record.key));
  }
  return {save, get, list,clearPrivate};
})();
