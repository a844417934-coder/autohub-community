import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../server/config.mjs';
import { identifier, itemIndex, withinRoot, requireValue } from '../server/security.mjs';
import { createApi } from './api.mjs';
import { executeText } from './executor.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function runWorker(config,id,{signal,delayMs=0,failOnce=false,onEvent=()=>{}}={}) {
  identifier(id,'worker');
  requireValue(config.workerKey,'Worker channel disabled');
  const workRoot=withinRoot(config.data,`workers/${id}/workspace`,true);
  mkdirSync(workRoot,{recursive:true});
  let session,lease,currentTaskId=null,failedOnce=false;
  const api=createApi({server:config.server,key:config.workerKey,workerId:id},async(url,options)=>{
    options.headers={...options.headers,'x-autohub-worker-session':session ?? '', 'x-autohub-task-lease':lease ?? ''};
    return fetch(url,options);
  });
  const registration=await api.register({tools:['demo-text'],capacity:1});
  session=registration.session;
  let heartbeatError;
  const heartbeat=setInterval(()=>api.heartbeat(currentTaskId,currentTaskId?1:0,1,{}).catch(e=>{heartbeatError=e;}),3000);
  try {
    while(!signal?.aborted) {
      if(heartbeatError) throw heartbeatError;
      const claim=await api.claim(['demo-text']);
      if(!claim) { await sleep(350); continue; }
      const task=claim.task;
      identifier(task.id);
      requireValue(task.toolId==='demo-text' && Array.isArray(claim.items) && claim.items.length<=16,'Invalid claim');
      currentTaskId=task.id; lease=claim.lease;
      onEvent({event:'claimed',workerId:id,taskId:task.id});
      try {
        if(delayMs) await sleep(delayMs);
        let failed=false;
        for(const item of claim.items) {
          if(signal?.aborted) break;
          const idx=itemIndex(item.idx);
          const directory=`${task.id}/${idx}-${randomUUID()}`;
          const workspace=withinRoot(workRoot,directory,true);
          mkdirSync(workspace);
          try {
            if(failOnce && !failedOnce) { failedOnce=true; throw new Error('Explicit local acceptance failure injection'); }
            const input=await api.downloadInput(task.id,idx);
            requireValue(input.data.length<=65536,'Oversized input');
            writeFileSync(withinRoot(workspace,'input.txt'),input.data,{flag:'wx'});
            await executeText({workspace,inputName:'input.txt',outputName:'result.txt'});
            await api.uploadResult(task.id,idx,readFileSync(withinRoot(workspace,'result.txt')));
            onEvent({event:'item-done',workerId:id,taskId:task.id,idx});
          } catch(error) {
            await api.itemResult(task.id,idx,'failed',error.message.slice(0,200));
            failed=true;
          }
        }
        if(signal?.aborted) await api.release(task.id);
        else if(failed) await api.failed(task.id,'One or more items failed');
        else await api.complete(task.id,[]);
      } finally { currentTaskId=null; lease=undefined; }
    }
  } finally { clearInterval(heartbeat); }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=readConfig(process.argv[2]);
  const id=process.argv[3] ?? 'demo-worker';
  const controller=new AbortController();
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>controller.abort());
  // Failure injection is a local CLI test option, never accepted in task payloads.
  const delayArg=process.argv.find(s=>s.startsWith('--delay='));
  const delayMs=delayArg ? Number(delayArg.slice(8)) : 0;
  requireValue(Number.isInteger(delayMs) && delayMs>=0 && delayMs<=60000,'Invalid test delay');
  await runWorker(config,id,{signal:controller.signal,delayMs,failOnce:process.argv.includes('--fail-once'),onEvent:e=>console.log(JSON.stringify(e))});
}
