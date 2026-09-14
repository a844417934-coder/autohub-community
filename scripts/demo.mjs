import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { setup } from './setup.mjs';
import { readConfig } from '../server/config.mjs';
import { startServer } from '../server/index.mjs';

const root=mkdtempSync(join(tmpdir(),'autohub demo '));
const configFile=join(root,'config.json');
setup(configFile);
const config=readConfig(configFile);
const app=await startServer(config);
const worker=spawn(process.execPath,['worker-client/index.mjs',configFile,'demo-worker'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
worker.stderr.on('data',()=>{});
const headers={'x-autohub-browser-key':config.browserKey,'content-type':'application/json'};
const call=async(path,method='GET',body)=>{
  const res=await fetch(config.server+path,{method,headers,body,redirect:'error'});
  if(!res.ok) throw new Error(`Demo API ${res.status}`);
  return res;
};
let stopping=false;
async function stop() {
  if(stopping) return; stopping=true;
  worker.kill();
  if(worker.exitCode===null) await new Promise(r=>worker.once('exit',r));
  await app.close();
  const rel=relative(tmpdir(),root);
  if(!isAbsolute(rel) && !rel.startsWith('..')) rmSync(root,{recursive:true,force:true});
}
try {
  const task=await (await call('/api/tasks','POST',JSON.stringify({name:'Synthetic text batch',toolId:'demo-text',items:['hello.txt','notes.txt']}))).json();
  for(let i=0;i<2;i++) await call(`/api/tasks/${task.id}/items/${i}/input`,'PUT',`Hello from a spare PC.\nSynthetic sample ${i+1}.`);
  await call(`/api/tasks/${task.id}/commit`,'POST','{}');
  const deadline=Date.now()+20000;
  let current;
  do {
    current=await(await call(`/api/tasks/${task.id}`)).json();
    if(current.status==='completed') break;
    if(current.status==='failed') throw new Error('Demo task failed');
    await new Promise(r=>setTimeout(r,200));
  } while(Date.now()<deadline);
  if(current.status!=='completed') throw new Error('Demo timed out');
  const result=await(await call(`/api/tasks/${task.id}/items/0/result`)).json();
  if(!result.uppercase.startsWith('HELLO FROM A SPARE PC.')) throw new Error('Wrong result');
  console.log('DEMO PASS: real Server + SQLite + separate Worker + upload/download + verified result.');
  if(process.argv.includes('--smoke')) await stop();
  else {
    console.log(`Workbench: ${config.server}\nBrowser key (temporary local session): ${config.browserKey}\nPress Ctrl+C to stop and delete this demo directory.`);
    await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
    await stop();
  }
} catch(error) { await stop(); throw error; }
