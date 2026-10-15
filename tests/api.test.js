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
test('on-demand AI batch caps at 20, runs two calls at once, and keeps partial results',async t=>{
  let active=0,maxActive=0,calls=0;
  const fetcher=async(_url,options)=>{
    active++;maxActive=Math.max(active,maxActive);const callNumber=++calls;
    const source=JSON.parse(JSON.parse(options.body).messages[1].content);
    await new Promise(resolve=>setTimeout(resolve,15));
    active--;
    const review={relevance:85,intent:'Buying intent',sentiment:'neutral',verdict:'Recommend',evidence:source.title,reason:'The title asks about a tool.',nextStep:'Read and answer the source conversation.'};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(callNumber===1?{...review,evidence:'Invented quote'}:review)}}]}));
  };
  const {req}=await app(t,{env:{OPENAI_API_KEY:'fixture-key',OPENAI_MODEL:'fixture-model'},fetcher});
  const pid=(await req('/projects','POST',project)).data.id;
  const names=['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima','mango','november','oscar','papa','quebec','romeo','sierra','tango','uniform','victor'];
  const items=names.map((name,index)=>({title:`Need ${name} project management software for agencies`,body:`Our agency ${name} needs project management software to manage client work and deadlines with a better workflow. We want to choose a tool soon.`,url:`https://reddit.com/r/SaaS/comments/a${index+10}/title/`}));
  assert.equal((await req(`/projects/${pid}/import`,'POST',{items})).data.inserted,22);
  const before=await req(`/projects/${pid}/ai-review`);assert.equal(before.data.eligibleCount,22);
  const started=await req(`/projects/${pid}/ai-review`,'POST',{});assert.equal(started.status,202);assert.equal(started.data.total,20);
  assert.equal((await req(`/projects/${pid}/ai-review`,'POST',{})).status,409);
  let status;
  for(let n=0;n<100;n++){status=(await req(`/projects/${pid}/ai-review`)).data;if(status.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(status.status,'completed');assert.equal(status.completed,19);assert.equal(status.failed,1);assert.equal(maxActive,2);assert.equal(calls,20);
  const saved=(await req(`/projects/${pid}/opportunities`)).data;
  assert.equal(saved.filter(i=>i.aiReviewStatus==='current').length,19);
  assert.equal(saved.filter(i=>i.aiReview).length,19);
  assert.equal(status.eligibleCount,3);
  assert.equal((await req(`/opportunities/${saved[0].id}`,'PATCH',{feedback:'useful'})).data.feedback,'useful');
  assert.equal((await req(`/opportunities/${saved[0].id}`,'PATCH',{feedback:'bad'})).status,400);
});
test('parallel project batches share the two-call AI limit',async t=>{
  let active=0,maxActive=0;
  const fetcher=async(_url,options)=>{
    active++;maxActive=Math.max(maxActive,active);
    const source=JSON.parse(JSON.parse(options.body).messages[1].content);
    await new Promise(resolve=>setTimeout(resolve,20));active--;
    const review={relevance:70,intent:'Discussion',sentiment:'neutral',verdict:'Maybe',evidence:source.title,reason:'The source mentions a workflow.',nextStep:'Read the source.'};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(review)}}]}));
  };
  const {req}=await app(t,{env:{OPENAI_API_KEY:'fixture-key',OPENAI_MODEL:'fixture-model'},fetcher});
  const ids=[];
  for(const name of ['One','Two']){
    const pid=(await req('/projects','POST',{...project,name})).data.id;ids.push(pid);
    const items=['alpha','bravo','charlie'].map((word,n)=>({title:`${name} ${word} project management request`,body:`The ${name} team needs a better project management workflow for several client projects. We are discussing software options and asking for practical recommendations.`,url:`https://reddit.com/r/SaaS/comments/${name.toLowerCase()}${n}/title/`}));
    await req(`/projects/${pid}/import`,'POST',{items});
  }
  await Promise.all(ids.map(pid=>req(`/projects/${pid}/ai-review`,'POST',{})));
  for(let n=0;n<100;n++){
    const statuses=await Promise.all(ids.map(pid=>req(`/projects/${pid}/ai-review`)));
    if(statuses.every(s=>s.data.status==='completed'))break;
    await new Promise(resolve=>setTimeout(resolve,15));
  }
  assert.equal(maxActive,2);
  for(const pid of ids)assert.equal((await req(`/projects/${pid}/ai-review`)).data.completed,3);
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
