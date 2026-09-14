import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.mjs';
import { openDatabase, closeDatabase, sqliteAdapter as db, nowIso } from './db/sqlite-adapter.mjs';
import { LocalDiskStorage } from './storage.mjs';
import { requireValue, identifier, itemIndex, secretEqual, bodyBytes, jsonBody, withinRoot } from './security.mjs';
import { submitTask, getTask, getItem, retryTask } from './task-service.mjs';
import { requireAssigned, completeTask, failTask, releaseTask } from './worker-service.mjs';

export const HEARTBEAT_TIMEOUT_MS = 15000;
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
function send(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
export async function startServer(config) {
  const sessions = new Map();
  const storage = new LocalDiskStorage(withinRoot(config.data, 'storage'));
  openDatabase(withinRoot(config.data, 'autohub.sqlite'));
  // One ordered mutation queue prevents async body reads from interleaving assignment checks and writes.
  // Atomic SQL additionally prevents concurrent claimers from taking the same task.
  let queue = Promise.resolve();
  const ordered = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };
  async function sweep() {
    const now = nowIso();
    const workers = await db.listWorkers();
    for (const w of workers) if (Date.parse(now) - Date.parse(w.lastHeartbeatAt) >= HEARTBEAT_TIMEOUT_MS) sessions.delete(w.id);
    const tasks = await db.listTasksForAdmin();
    const stale = tasks.filter(t => t.status === 'processing' && !sessions.has(t.assignedWorkerId));
    for (const task of stale) await releaseTask(task.assignedWorkerId, task.id);
    await db.markWorkersOffline(now, HEARTBEAT_TIMEOUT_MS);
    return stale.length;
  }
  const timer = setInterval(() => ordered(sweep).catch(() => console.error('Recovery check failed')), 1000);
  timer.unref();
  function networkGuard(req, admin) {
    const port = admin ? config.adminPort : config.port;
    const hosts = admin ? ['127.0.0.1','localhost'] : config.allowedHosts;
    requireValue(hosts.some(h => req.headers.host === `${h}:${port}`), 'Host denied', 403);
    const origin = req.headers.origin;
    requireValue(!origin || origin === `http://${req.headers.host}`, 'Origin denied', 403);
    requireValue(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']), 'Cross-site request denied', 403);
    if (admin) requireValue(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress), 'Local diagnostics only', 403);
  }
  async function route(req, res, admin) {
    networkGuard(req, admin);
    requireValue(typeof req.url === 'string' && !req.url.includes('%') && !req.url.includes('..') && !req.url.includes('\\'), 'Invalid URL');
    const url = new URL(req.url, `http://${req.headers.host}`);
    requireValue(!url.search, 'Query parameters unsupported');
    const p = url.pathname.split('/').filter(Boolean);
    const method = req.method;
    if (method === 'GET' && url.pathname === '/health') return send(res, { ok: true, edition: 'community' });
    if (method === 'GET' && ['/', '/app.js', '/app.css', '/app.js.LEGAL.txt'].includes(url.pathname) && !admin) {
      const files = { '/': ['web/index.html','text/html; charset=utf-8'], '/app.js':['build/app.js','text/javascript'], '/app.css':['web/app.css','text/css'], '/app.js.LEGAL.txt':['build/app.js.LEGAL.txt','text/plain'] };
      const [file, type] = files[url.pathname];
      res.writeHead(200, { 'content-type':type });
      return res.end(readFileSync(resolve(projectRoot,file)));
    }
    if (p[0] !== 'api') requireValue(false, 'Not found', 404);
    // Worker key only enrolls a process. Each process gets a fresh session; stale sessions expire.
    const workerRoute = p[1] === 'workers' && (method !== 'GET' || p.length > 2);
    if (workerRoute && !admin) {
      requireValue(!!config.workerKey, 'Worker channel disabled', 503);
      requireValue(secretEqual(req.headers['x-autohub-worker-key'], config.workerKey), 'Worker key denied', 401);
      await sweep();
      if (p.length === 2 && method === 'POST') {
        const input = await jsonBody(req);
        const id = identifier(input.workerId, 'worker');
        requireValue(!sessions.has(id), 'Worker already registered', 423);
        requireValue(Array.isArray(input.tools) && input.tools.length === 1 && input.tools[0] === 'demo-text', 'Unsupported tools');
        const token = randomBytes(32).toString('hex'), now = nowIso();
        await db.upsertWorker({ id, hostname: id, cpu:'',ram:'',gpu:'', tools:['demo-text'],
          status:'online',capacity:1,activeTaskCount:0,resources:{},lastHeartbeatAt:now,createdAt:now,updatedAt:now });
        sessions.set(id, token);
        return send(res, { workerId:id, accepted:true, session:token });
      }
      const id = identifier(p[2], 'worker');
      requireValue(secretEqual(req.headers['x-autohub-worker-session'], sessions.get(id)), 'Worker session denied', 401);
      const worker = await db.getWorker(id);
      if (p.length === 4 && p[3] === 'heartbeat' && method === 'POST') {
        await jsonBody(req);
        const load = (await db.listWorkerTaskLoads())[id];
        const now = nowIso();
        await db.upsertWorker({...worker,status:load ? 'busy':'online',activeTaskCount:load?.activeTaskCount ?? 0,currentTaskId:load?.currentTaskId ?? null,lastHeartbeatAt:now,updatedAt:now});
        return send(res, { accepted:true });
      }
      if (p.length === 4 && p[3] === 'claim' && method === 'POST') {
        const input = await jsonBody(req);
        requireValue(!input.tools || Array.isArray(input.tools) && input.tools.length === 1 && input.tools[0] === 'demo-text', 'Invalid tool scope');
        const task = await db.claimNextTask(id, ['demo-text'], nowIso(), 1);
        if (!task) return send(res, null);
        const lease = randomBytes(32).toString('hex');
        task.options = { lease };
        await db.updateTask(task);
        await db.resetTaskItems(task.id, nowIso(), true);
        return send(res, { task, items:(await db.listTaskItems(task.id)).filter(i => i.status !== 'done'), lease });
      }
      requireValue(p[3] === 'tasks', 'Unknown Worker route', 404);
      const taskId = identifier(p[4]);
      const task = await requireAssigned(id,taskId);
      requireValue(secretEqual(req.headers['x-autohub-task-lease'],task.options?.lease), 'Task lease denied',409);
      if (p.length === 6 && method === 'POST') {
        const input = await jsonBody(req);
        if (p[5] === 'complete') return send(res,await completeTask(id,taskId,{}));
        if (p[5] === 'failed') {
          requireValue(typeof input.reason === 'string' && input.reason.length <= 200,'Invalid failure reason');
          return send(res,await failTask(id,taskId,{reason:input.reason}));
        }
        if (p[5] === 'release') return send(res,await releaseTask(id,taskId));
      }
      if (p.length === 8 && p[5] === 'items') {
        const idx = itemIndex(p[6]);
        await getItem(taskId,idx);
        if (p[7] === 'input' && method === 'GET') {
          const bytes=storage.get(taskId,idx,'input');
          res.writeHead(200,{'content-type':'application/octet-stream'}); return res.end(bytes);
        }
        if (p[7] === 'result' && method === 'PUT') {
          const bytes=await bodyBytes(req);
          const key=storage.put(taskId,idx,'result',bytes);
          await db.setTaskItemDoneWithOutput(taskId,idx,key,nowIso());
          const completedCount=(await db.listTaskItems(taskId)).filter(i=>i.status==='done').length;
          await db.updateTask({...task,completedCount,progress:Math.floor(100*completedCount/task.totalCount),updatedAt:nowIso()});
          return send(res,{accepted:true});
        }
        if (p[7] === 'result' && method === 'POST') {
          const input=await jsonBody(req);
          requireValue(input.status==='failed' && typeof input.error==='string' && input.error.length<=200,'Only a bounded failure report is accepted');
          await db.setTaskItemStatus(taskId,idx,'failed',nowIso(),input.error);
          return send(res,{accepted:true});
        }
      }
      requireValue(false,'Unknown Worker route',404);
    }
    requireValue(secretEqual(req.headers['x-autohub-browser-key'],config.browserKey),'Browser key denied',401);
    if (admin) {
      requireValue(url.pathname==='/api/diagnostics' && method==='GET','Read-only diagnostics',404);
      const tasks=await db.listTasksForAdmin();
      return send(res,{tasks:tasks.length,workers:await db.listWorkers(),storage:'local-disk',authentication:'single-user capability keys'});
    }
    if (url.pathname==='/api/workers' && method==='GET') return send(res,await db.listWorkers());
    if (p[1] !== 'tasks') requireValue(false,'Not found',404);
    if (p.length===2) {
      if (method==='GET') return send(res,(await db.listTasks('local',200)).map(t=>({...t,options:{}})));
      if (method==='POST') return send(res,await submitTask(await jsonBody(req)),201);
    }
    const id=identifier(p[2]);
    const task=await getTask(id);
    if (p.length===3 && method==='GET') return send(res,{...task,options:{},records:await db.listTaskItems(id)});
    if (p.length===4 && method==='POST') {
      await jsonBody(req);
      if (p[3]==='commit') {
        requireValue(!task.inputsReady && task.status==='queued','Task already committed',409);
        const items=await db.listTaskItems(id);
        requireValue(items.length===task.totalCount && items.every(i=>i.inputStorageKey),'Missing uploads',409);
        await db.setTaskInputsReady(id,nowIso()); return send(res,{accepted:true});
      }
      if (p[3]==='retry') return send(res,await retryTask(id));
    }
    if (p.length===6 && p[3]==='items') {
      const idx=itemIndex(p[4]);
      const item=await getItem(id,idx);
      if (p[5]==='input' && method==='PUT') {
        requireValue(!task.inputsReady && task.status==='queued','Committed input is immutable',409);
        const key=storage.put(id,idx,'input',await bodyBytes(req));
        await db.setTaskItemInputKey(id,idx,key,nowIso()); return send(res,{accepted:true});
      }
      if (p[5]==='retry' && method==='POST') { await jsonBody(req); return send(res,await retryTask(id,idx)); }
      if (p[5]==='result' && method==='GET') {
        requireValue(item.status==='done' && item.outputStorageKey===`result/${idx}.txt`,'No final result',404);
        const bytes=storage.get(id,idx,'result');
        res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':`attachment; filename="result-${idx}.txt"`}); return res.end(bytes);
      }
    }
    requireValue(false,'Not found',404);
  }
  function listener(admin) {
    return createServer({requestTimeout:10000,headersTimeout:10000,maxHeaderSize:8192},(req,res)=>{
      res.setHeader('cache-control','no-store');
      res.setHeader('x-content-type-options','nosniff');
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      res.setHeader('referrer-policy','no-referrer');
      ordered(()=>route(req,res,admin)).catch(error=>{
        if (!res.headersSent && !res.destroyed) send(res,{error:error.status ? error.message : 'Internal error'},error.status ?? 500);
        else res.destroy();
      });
    });
  }
  const server=listener(false), admin=listener(true);
  const listen=(s,p,h)=>new Promise((ok,fail)=>{s.once('error',fail);s.listen(p,h,ok);});
  try { await listen(server,config.port,config.host); await listen(admin,config.adminPort,'127.0.0.1'); }
  catch(error) { clearInterval(timer); server.close(); admin.close(); closeDatabase(); throw error; }
  return { server,admin,close:async()=>{clearInterval(timer);server.closeAllConnections();admin.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>admin.close(r))]);await queue;closeDatabase();} };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=readConfig(process.argv[2]);
  const app=await startServer(config);
  console.log(`AutoHub Community http://127.0.0.1:${config.port} | local diagnostics ${config.adminPort}`);
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
