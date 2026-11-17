import test from 'node:test';
import assert from 'node:assert/strict';
import {providerRoute} from '../cloud/providers.js';
const request=(path,data)=>new Request('https://site.example/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const reply=value=>Response.json(value);

test('model settings read models and verify a connection with the existing frontend response',async()=>{
 const config={url:'https://provider.example/v1',key:'test-key',model:'medical-model'};
 const models=await providerRoute(request('models',{config}),{},async(url,options)=>{assert.equal(String(url),'https://provider.example/v1/models');assert.equal(options.method,'GET');return reply({data:[{id:'medical-model'}]});});
 assert.deepEqual(await models.json(),{models:['medical-model']});
 const result=await providerRoute(request('model-test',{config}),{},async()=>reply({model:'medical-model',choices:[{message:{content:'连接成功'}}]}));
 assert.deepEqual(await result.json(),{text:'连接成功',model:'medical-model',usage:{}});
});

test('answer streams visible deltas and switches to configured fallback before any output',async()=>{
 const result=await providerRoute(request('answer',{config:{url:'https://first.example/v1',model:'first'},fallback:{url:'https://second.example/v1',model:'second'},use_fallback:true,prompt:'按给定证据解释结果'}),{},async url=>String(url).includes('first.example')?new Response('',{status:503}):new Response('data: {"choices":[{"delta":{"content":"有原文依据"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
 const events=(await result.text()).trim().split('\n\n').map(line=>JSON.parse(line.slice(6)));
 assert.ok(events.some(x=>x.notice));assert.ok(events.some(x=>x.delta==='有原文依据'));assert.ok(events.some(x=>x.done&&x.fallback_used&&x.model==='second'));
});

test('selection translation preserves segment identifiers and public search handles synonym groups',async()=>{
 const result=await providerRoute(request('translation',{key:'example:fx',segments:[{id:'p2',text:'Follow-up outcome'}],target:'ZH'}),{},async(url)=>{assert.match(String(url),/api-free.deepl.com/);return reply({translations:[{text:'随访结局'}]});});
 assert.deepEqual((await result.json()).segments,[{id:'p2',zh:'随访结局'}]);
 const found=await providerRoute(request('search',{groups:[['lung nodule','pulmonary nodule'],['radiomics']]}),{},async url=>{const q=new URL(url).searchParams.get('query');assert.match(q,/lung nodule/);assert.match(q,/ AND /);return reply({hitCount:1,resultList:{result:[{pmid:'25554246'}]}});});
 assert.equal((await found.json()).records[0].pmid,'25554246');
});
