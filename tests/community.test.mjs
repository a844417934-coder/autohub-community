import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { startServer } from '../server/index.mjs';
import { readConfig } from '../server/config.mjs';
import { setup } from '../scripts/setup.mjs';
import { filename, identifier, withinRoot, secretEqual } from '../server/security.mjs';
import { LocalDiskStorage } from '../server/storage.mjs';
import { sqliteAdapter as db, nowIso } from '../server/db/sqlite-adapter.mjs';
import { executeText } from '../worker-client/executor.mjs';

let root,config,configFile,app;
const children=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn,timeout=25000) {const until=Date.now()+timeout; do{const value=await fn();if(value)return value;await pause(100);}while(Date.now()<until);throw new Error('Timed out');}
async function request(path,{method='GET',body,headers={},key=config.browserKey}={}) {
  return fetch(config.server+path,{method,headers:{'x-autohub-browser-key':key,'content-type':'application/json',...headers},body,redirect:'error'});
}
async function json(path,options) {const r=await request(path,options);assert.ok(r.ok,`${path}: ${r.status} ${await r.clone().text()}`);return r.json();}
async function createTask(names=['sample.txt']) {
  const task=await json('/api/tasks',{method:'POST',body:JSON.stringify({name:'Acceptance batch',toolId:'demo-text',items:names})});
  for(const [idx,name] of names.entries()) assert.equal((await request(`/api/tasks/${task.id}/items/${idx}/input`,{method:'PUT',body:`Hello ${name}\nSynthetic input.`})).status,200);
  await json(`/api/tasks/${task.id}/commit`,{method:'POST',body:'{}'});
  return task;
}
async function register(id) {
  const r=await request('/api/workers',{method:'POST',body:JSON.stringify({workerId:id,tools:['demo-text']}),headers:{'x-autohub-worker-key':config.workerKey}});
  assert.equal(r.status,200);
  return (await r.json()).session;
}
function workerHeaders(session,lease) {return {'x-autohub-worker-key':config.workerKey,'x-autohub-worker-session':session,'x-autohub-task-lease':lease??''};}
function startWorker(id,args=[]) {
  const child=spawn(process.execPath,['worker-client/index.mjs',configFile,id,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.events=[];child.errors='';
  let pending='';child.stdout.on('data',chunk=>{pending+=chunk;let idx;while((idx=pending.indexOf('\n'))>=0){const line=pending.slice(0,idx);pending=pending.slice(idx+1);try{child.events.push(JSON.parse(line));}catch{}}});
  child.stderr.on('data',data=>{child.errors+=data;});children.push(child);return child;
}
async function kill(child) {if(child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
before(async()=>{
  root=mkdtempSync(join(tmpdir(),'autohub acceptance with spaces '));
  configFile=join(root,'config.json');setup(configFile,{port:43270,adminPort:43271});
  config=readConfig(configFile);app=await startServer(config);
});
after(async()=>{for(const c of children) await kill(c);await app?.close();rmSync(root,{recursive:true,force:true});});

test('loopback listeners, no default keys, identity spoofing and cross-site writes denied',async()=>{
  assert.equal(app.server.address().address,'127.0.0.1');assert.equal(app.admin.address().address,'127.0.0.1');
  assert.equal(secretEqual('change-me','change-me'),false);assert.equal(secretEqual('',undefined),false);
  assert.equal((await request('/api/tasks',{key:'','headers':{'x-autohub-user':'admin','cookie':'user=admin'}})).status,401);
  for(const headers of [{origin:'https://example.invalid'},{'sec-fetch-site':'cross-site'}]) {
    assert.equal((await request('/api/tasks',{method:'POST',body:'{}',headers})).status,403,JSON.stringify(headers));
  }
  const wrongHost=await new Promise((resolve,reject)=>{const req=httpRequest(config.server+'/api/tasks',{headers:{host:'example.invalid:43270','x-autohub-browser-key':config.browserKey}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(wrongHost,403);
  assert.equal((await request('/api/workers',{method:'POST',body:'{}',headers:{'x-autohub-worker-key':'change-me'}})).status,401);
  assert.equal((await request('/api/admin/packages')).status,404);
  assert.equal((await request('/api/nas')).status,404);
  const key=config.workerKey;
  try { config.workerKey='';assert.equal((await request('/api/workers',{method:'POST',body:'{}'})).status,503); }
  finally { config.workerKey=key; }
});
test('empty or obsolete configuration never activates external storage or maintenance',()=>{
  const raw=JSON.parse(readFileSync(configFile));
  for(const forbidden of ['packagesRoot','maintenance','toolsRoot','nasRoot','cloud']) {
    const file=join(root,'forbidden.json');writeFileSync(file,JSON.stringify({...raw,[forbidden]:''}));
    assert.throws(()=>readConfig(file),/Unknown configuration/);
  }
  const file=join(root,'no-worker.json');writeFileSync(file,JSON.stringify({...raw,workerKey:''}));
  assert.equal(readConfig(file).workerKey,'');
  writeFileSync(file,JSON.stringify({...raw,host:'0.0.0.0'}));assert.throws(()=>readConfig(file),/explicit allowedHosts/);
});
test('invalid names, IDs, absolute/UNC/traversal paths and linked directories rejected',()=>{
  for(const value of ['../x','..','/x','a/b','a\\b','CON.txt','name.','a:stream','']) assert.throws(()=>filename(value));
  for(const value of ['../task','worker/other','<script>','']) assert.throws(()=>identifier(value));
  for(const value of ['../x','/x','a/../b','a\\b','a:stream']) assert.throws(()=>withinRoot(config.data,value));
  const outside=join(root,'outside');mkdirSync(outside);
  symlinkSync(outside,join(config.data,'linked'),'junction');
  assert.throws(()=>withinRoot(config.data,'linked/escape.txt',true),/Linked path/);
  symlinkSync(join(root,'nonexistent'),join(config.data,'dangling'),'junction');
  assert.throws(()=>withinRoot(config.data,'dangling/escape.txt',true),/Linked path/);
  const storage=new LocalDiskStorage(join(config.data,'test-storage'));
  assert.throws(()=>storage.path(`t-${'a'.repeat(32)}`,0,'tmp'),/Only final/);
});
test('upload count and size limits, commit gate and immutable committed inputs',async()=>{
  for(const items of [[],Array(17).fill('a.txt'),['../escape']]) assert.equal((await request('/api/tasks',{method:'POST',body:JSON.stringify({name:'Invalid',toolId:'demo-text',items})})).status,400);
  assert.equal((await request('/api/tasks',{method:'POST',body:JSON.stringify({name:'Invalid',toolId:'shell',items:['a']})})).status,400);
  const task=await json('/api/tasks',{method:'POST',body:JSON.stringify({name:'Upload boundary',toolId:'demo-text',items:['a.txt']})});
  assert.equal((await request(`/api/tasks/${task.id}/commit`,{method:'POST',body:'{}'})).status,409);
  for(const body of ['', 'x'.repeat(65537)]) assert.equal((await request(`/api/tasks/${task.id}/items/0/input`,{method:'PUT',body})).status,413);
  assert.equal((await request(`/api/tasks/${task.id}/items/1/input`,{method:'PUT',body:'x'})).status,404);
  await request(`/api/tasks/${task.id}/items/0/input`,{method:'PUT',body:'test'});
  await json(`/api/tasks/${task.id}/commit`,{method:'POST',body:'{}'});
  assert.equal((await request(`/api/tasks/${task.id}/items/0/input`,{method:'PUT',body:'replace'})).status,409);
  // Keep later scenarios isolated by marking this validation-only task terminal.
  await db.updateTask({...await db.getTask(task.id),status:'failed'});
});
test('original atomic claim prevents double claim and respects capacity and tool scope',async()=>{
  const task=await createTask();
  const [first,second]=await Promise.all([db.claimNextTask('unit-a',['demo-text'],nowIso(),1),db.claimNextTask('unit-b',['demo-text'],nowIso(),1)]);
  assert.equal([first,second].filter(Boolean).length,1);assert.equal((first??second).id,task.id);
  const another=await createTask();
  assert.equal(await db.claimNextTask((first??second).assignedWorkerId,['demo-text'],nowIso(),1),null);
  assert.equal(await db.claimNextTask('unit-c',['unknown'],nowIso(),1),null);
  for(const id of [task.id,another.id]) await db.updateTask({...await db.getTask(id),status:'failed'});
});
test('worker sessions, task ownership, lease checks, and completion requires real files',async()=>{
  const task=await createTask(),other=await createTask();
  const a=await register('protocol-a'),b=await register('protocol-b');
  assert.equal((await request('/api/workers/protocol-a/heartbeat',{method:'POST',body:'{}',headers:workerHeaders(b)})).status,401);
  const claim=await json('/api/workers/protocol-a/claim',{method:'POST',body:'{}',headers:workerHeaders(a)});
  assert.equal(claim.task.id,task.id);
  const endpoint=`/api/workers/protocol-a/tasks/${task.id}`;
  assert.equal((await request(`${endpoint}/complete`,{method:'POST',body:'{}',headers:workerHeaders(a,claim.lease)})).status,409);
  assert.equal((await request(`${endpoint}/items/0/result`,{method:'PUT',body:'result',headers:workerHeaders(a,'invalid')})).status,409);
  assert.equal((await request(`/api/workers/protocol-b/tasks/${task.id}/items/0/input`,{headers:workerHeaders(b,claim.lease)})).status,403);
  assert.equal((await request(`/api/workers/protocol-a/tasks/${other.id}/items/0/input`,{headers:workerHeaders(a,claim.lease)})).status,403);
  assert.equal((await request(`/api/tasks/${task.id}/items/0/result`)).status,404);
  await json(`${endpoint}/items/0/result`,{method:'PUT',body:'verified result',headers:workerHeaders(a,claim.lease)});
  await json(`${endpoint}/complete`,{method:'POST',body:'{}',headers:workerHeaders(a,claim.lease)});
  assert.equal(await(await request(`/api/tasks/${task.id}/items/0/result`)).text(),'verified result');
  await db.updateTask({...await db.getTask(other.id),status:'failed'});
});
test('real two-process Worker interruption -> heartbeat timeout -> task takeover -> files complete',async()=>{
  const task=await createTask(['first.txt','second.txt']);
  const first=startWorker('recovery-a',['--delay=60000']);
  await eventually(()=>first.events.find(e=>e.event==='claimed' && e.taskId===task.id));
  const second=startWorker('recovery-b');
  await eventually(async()=> (await db.listWorkers()).some(w=>w.id==='recovery-b'));
  assert.equal((await db.getTask(task.id)).assignedWorkerId,'recovery-a');
  const interrupted=Date.now();await kill(first);
  const result=await eventually(async()=>{const t=await json(`/api/tasks/${task.id}`);return t.status==='completed'&&t;},30000);
  assert.equal(result.assignedWorkerId,'recovery-b');assert.equal(result.completedCount,2);
  assert.ok(Date.now()-interrupted>=10000,'Must actually wait for heartbeat expiration');
  for(let idx=0;idx<2;idx++) {const file=await(await request(`/api/tasks/${task.id}/items/${idx}/result`)).json();assert.ok(file.uppercase.startsWith('HELLO '));}
  console.log(JSON.stringify({acceptance:'two-worker-takeover',interrupted:'recovery-a',completedBy:result.assignedWorkerId,elapsedMs:Date.now()-interrupted,completedItems:result.completedCount}));
  await kill(second);
});
test('real item retry preserves successful items and only executes failed item again',async()=>{
  const child=startWorker('retry-worker',['--fail-once']);
  await eventually(async()=> (await db.listWorkers()).some(w=>w.id==='retry-worker'));
  const task=await createTask(['retry.txt','preserved.txt']);
  const failed=await eventually(async()=>{const t=await json(`/api/tasks/${task.id}`);return t.status==='failed'&&t;});
  assert.deepEqual(failed.records.map(i=>i.status),['failed','done']);
  const before=await(await request(`/api/tasks/${task.id}/items/1/result`)).text();
  await json(`/api/tasks/${task.id}/items/0/retry`,{method:'POST',body:'{}'});
  const done=await eventually(async()=>{const t=await json(`/api/tasks/${task.id}`);return t.status==='completed'&&t;});
  assert.equal(done.completedCount,2);assert.equal(await(await request(`/api/tasks/${task.id}/items/1/result`)).text(),before);
  assert.equal(child.events.filter(e=>e.event==='item-done'&&e.taskId===task.id&&e.idx===1).length,1);
  console.log(JSON.stringify({acceptance:'item-retry',failedItem:0,preservedItem:1,completedItems:done.completedCount}));
  await kill(child);
});
test('executor rejects invalid UTF-8 and cannot escape its trusted workspace',async()=>{
  const workspace=join(root,'executor test');mkdirSync(workspace);writeFileSync(join(workspace,'input.txt'),Buffer.from([255,255]));
  await assert.rejects(()=>executeText({workspace,inputName:'input.txt',outputName:'out.txt'}),/UTF-8/);
  await assert.rejects(()=>executeText({workspace,inputName:'../config.json',outputName:'out.txt'}),/Unsafe/);
});
