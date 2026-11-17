/* Scientific calculations and PDF extraction run in this dedicated worker. */
'use strict';
let runtime, sources;
const progress = (id, message) => postMessage({id, progress: message});
async function python(id, operation, data) {
  if (!runtime) {
    progress(id, '首次准备分析环境，后续会使用浏览器缓存…');
    importScripts('/assets/compute/pyodide.js');
    runtime = loadPyodide({indexURL: '/assets/compute/'}).catch(error => {runtime = null; throw error;});
  }
  const py = await runtime;
  const packages = operation === 'pdf' ? ['cryptography', 'charset-normalizer']
    : data.mode === 'longitudinal' ? ['statsmodels'] : ['numpy', 'scipy'];
  progress(id, operation === 'pdf' ? '正在准备 PDF 正文与表格解析…' : '正在准备统计方法…');
  await py.loadPackage(packages, {messageCallback: () => {}, errorCallback: message => console.warn(message)});
  if (!sources) {
    sources = (async () => {
      const response = await fetch('/assets/compute/zhijing-python.zip');
      if (!response.ok) throw Error('分析方法文件加载失败，请重试');
      py.unpackArchive(await response.arrayBuffer(), 'zip', {extractDir: '/app'});
      await py.runPythonAsync('import sys\nsys.path.insert(0, "/app")');
    })().catch(error => {sources = null; throw error;});
  }
  await sources;
  if (operation === 'pdf' && !py.FS.analyzePath('/app/pdfplumber').exists) {
    const response = await fetch('/assets/compute/pdf-python.zip');
    if (!response.ok) throw Error('PDF 解析方法加载失败，请重试');
    py.unpackArchive(await response.arrayBuffer(), 'zip', {extractDir: '/app'});
  }
  const payload = {...data};
  if (operation === 'pdf') {
    delete payload.bytes;
    const raw = py.toPy(new Uint8Array(data.bytes));
    py.globals.set('_zhijing_pdf_bytes', raw);
    raw.destroy();
  }
  py.globals.set('_zhijing_request', JSON.stringify(payload));
  py.globals.set('_zhijing_operation', operation);
  progress(id, operation === 'pdf' ? '正在提取 PDF 正文、页码与表格…' : '正在计算，请稍候…');
  const result = await py.runPythonAsync(`
import json
from tools.browser_compute import compute
_payload = json.loads(_zhijing_request)
if _zhijing_operation == 'pdf':
    _payload['bytes'] = bytes(_zhijing_pdf_bytes)
_result = compute(_zhijing_operation, _payload)
json.dumps(_result, ensure_ascii=False, allow_nan=False)
`);
  return JSON.parse(result);
}
let sequence = Promise.resolve();
onmessage = event => {
  const {id, operation, data} = event.data;
  sequence = sequence.catch(() => {}).then(async () => {
    try { postMessage({id, result: await python(id, operation, data)}); }
    catch (error) {
      const lines = String(error.message || error).trim().split('\n');
      const detail = lines.at(-1).replace(/^(?:ValueError|RuntimeError|ImportError):\s*/, '');
      postMessage({id, error: detail});
    }
  });
};
