import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createApp } from '../server/index.js';
import { Store } from '../server/store.js';
import { handleMcp } from '../server/mcp.js';

async function app(t,options={}) {
  const store=new Store(':memory:');const result=createApp({store,env:{},demo:false,...options});result.server.listen(0,'127.0.0.1');await once(result.server,'listening');
  t.after(async()=>{await new Promise(resolve=>result.server.close(resolve));store.close();});
  const base=`http://127.0.0.1:${result.server.address().port}`;
  async function req(path,method='GET',data,headers={}) { const r=await fetch(base+'/api'+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json(),headers:r.headers}; }
  return {...result,base,req};
}
const project={name:'Acme',website:'https://example.com',description:'Project management for teams',keywords:['project management'],competitors:['Asana']};
const input={title:'Recommend project management tools?',body:'Looking for an alternative to Asana.',url:'https://reddit.com/r/SaaS/comments/abc123/any_title/'};

test('complete project → import → draft → pipeline → export → delete workflow',async t=>{
  const {req,base}=await app(t);
  const created=await req('/projects','POST',project);assert.equal(created.status,201);const pid=created.data.id;
  const imp=await req(`/projects/${pid}/import`,'POST',{items:[input,input]});assert.deepEqual(imp.data,{inserted:1,duplicates:1});
  let i=(await req(`/projects/${pid}/opportunities`)).data[0];assert.equal(i.sample,false);
  const draft=await req(`/opportunities/${i.id}/draft`,'POST',{});assert.equal(draft.data.draftMethod,'template');assert.equal(draft.data.status,'reviewing');
  i=(await req(`/opportunities/${i.id}`,'PATCH',{draft:'My edited reply',saved:true,status:'replied',notes:'Useful context',contactStage:'converted'})).data;
  assert.equal((await req(`/opportunities/${i.id}`)).data.draft,'My edited reply');
  const exported=await req(`/projects/${pid}/export`);assert.equal(exported.data.items[0].contactStage,'converted');
  const csvResponse=await fetch(`${base}/api/projects/${pid}/export?format=csv`);assert.equal(csvResponse.status,200);assert.match(await csvResponse.text(),/My edited reply/);
  await req(`/projects/${pid}`,'PATCH',{ignoredSubreddits:['SaaS']});assert.equal((await req(`/opportunities/${i.id}`)).data.analysis.ignored,true);
  assert.equal((await req(`/projects/${pid}/sync`,'POST',{provider:'reddit'})).status,400);
  assert.ok((await req(`/projects/${pid}/events`)).data.some(e=>e.kind==='error'));
  assert.equal((await req(`/projects/${pid}`,'DELETE')).status,200);assert.equal((await req(`/opportunities/${i.id}`)).status,404);
});
test('invalid imports are atomic, URLs and input types are validated',async t=>{
  const {req}=await app(t);const pid=(await req('/projects','POST',project)).data.id;
  assert.equal((await req(`/projects/${pid}/import`,'POST',{items:[input,{...input,url:'javascript:alert(1)'}]})).status,400);
  assert.equal((await req(`/projects/${pid}/opportunities`)).data.length,0);
  assert.equal((await req('/projects','POST',{...project,keywords:'bad'})).status,400);
  assert.equal((await req(`/projects/${pid}/import`,'POST',{items:[null]})).status,400);
  assert.equal((await req('/projects/missing/opportunities')).status,404);
});
test('bearer access, same-origin checks, security headers and secret isolation',async t=>{
  const {req,base}=await app(t,{env:{APP_TOKEN:'private-secret',SERPAPI_KEY:'never-expose'}});
  assert.equal((await req('/projects')).status,401);
  const headers={Authorization:'Bearer private-secret'};
  const good=await req('/config','GET',null,headers);assert.equal(good.status,200);assert.equal(good.data.google,true);assert.ok(!JSON.stringify(good.data).includes('never-expose'));
  assert.equal((await req('/projects','GET',null,{...headers,Origin:'https://evil.example'})).status,403);
  const staticResponse=await fetch(base);assert.match(staticResponse.headers.get('content-security-policy'),/default-src 'self'/);
});
test('loopback server rejects DNS rebinding hosts',async t=>{const {base}=await app(t);const status=await new Promise((resolve,reject)=>{const request=http.get(base+'/api/projects',{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});assert.equal(status,403);});
test('sync deduplicates and preserves user state; failures do not import partial data',async t=>{
  let fail=false,calls=0;
  const fetcher=async()=>{calls++;if(fail&&calls%2===0)return new Response('',{status:429});return new Response(JSON.stringify({organic_results:[{title:input.title,link:input.url,position:3,snippet:input.body}]}));};
  const {req}=await app(t,{env:{SERPAPI_KEY:'test'},fetcher});const pid=(await req('/projects','POST',project)).data.id;
  const synced=await req(`/projects/${pid}/sync`,'POST',{provider:'google'});assert.equal(synced.status,200);assert.equal(synced.data.inserted,1);
  const i=(await req(`/projects/${pid}/opportunities`)).data[0];await req(`/opportunities/${i.id}`,'PATCH',{status:'replied',notes:'Keep this',draft:'Keep draft'});
  await req(`/projects/${pid}/sync`,'POST',{provider:'google'});const items=(await req(`/projects/${pid}/opportunities`)).data;assert.equal(items.length,1);assert.equal(items[0].notes,'Keep this');assert.equal(items[0].status,'replied');
  const before=JSON.stringify(items);fail=true;calls=0;assert.equal((await req(`/projects/${pid}/sync`,'POST',{provider:'google'})).status,502);assert.equal(JSON.stringify((await req(`/projects/${pid}/opportunities`)).data),before);
});
test('SQLite data survives reopen',()=>{const dir=mkdtempSync(join(tmpdir(),'greenreach-test-'));try{const path=join(dir,'db.sqlite');const db=new Store(path);db.saveProject({...project,id:'persist'});db.close();const reopened=new Store(path);assert.equal(reopened.project('persist').name,'Acme');reopened.close();}finally{rmSync(dir,{recursive:true,force:true});}});
test('MCP handshake, discovery, read-only tools, authentication and validation',async t=>{
  const {req,base}=await app(t);const pid=(await req('/projects','POST',project)).data.id;await req(`/projects/${pid}/import`,'POST',{items:[input]});
  const call=(method,params)=>handleMcp({jsonrpc:'2.0',id:1,method,params},{GREENREACH_URL:base});
  assert.equal((await call('initialize',{})).result.protocolVersion,'2025-06-18');
  const tools=(await call('tools/list')).result.tools;assert.ok(tools.every(t=>t.annotations.readOnlyHint));assert.equal(tools.length,6);
  const result=await call('tools/call',{name:'list_opportunities',arguments:{projectId:pid}});assert.equal(JSON.parse(result.result.content[0].text).length,1);
  assert.equal((await call('tools/call',{name:'list_opportunities',arguments:{projectId:pid,limit:-1}})).error.code,-32602);
  assert.equal((await call('tools/call',{name:'post_reply',arguments:{}})).error.code,-32602);
  let forwardedAuthorization;
  const authenticated=await handleMcp({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'list_projects',arguments:{}}},{GREENREACH_URL:base,APP_TOKEN:'mcp-test-token'},async(url,options)=>{forwardedAuthorization=options.headers.Authorization;return fetch(url,options);});
  assert.equal(forwardedAuthorization,'Bearer mcp-test-token');assert.equal(authenticated.result.isError,false);
  const unauthorized=await handleMcp({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_projects',arguments:{}}},{GREENREACH_URL:base,APP_TOKEN:'wrong-token'},async()=>new Response('Unauthorized',{status:401}));
  assert.equal(unauthorized.result.isError,true);assert.match(unauthorized.result.content[0].text,/HTTP 401/);
  assert.equal(await handleMcp({jsonrpc:'2.0',method:'notifications/initialized'}),null);
});
