import { randomBytes } from 'node:crypto';
import { sqliteAdapter as db, nowIso } from './db/sqlite-adapter.mjs';
import { filename, requireValue } from './security.mjs';

export async function submitTask(body) {
  requireValue(Object.keys(body).every(k => ['name','toolId','items'].includes(k)), 'Unknown task option');
  requireValue(body.toolId === 'demo-text', 'Unknown executor');
  requireValue(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 100, 'Invalid task name');
  requireValue(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 16, 'Supply 1..16 items');
  const names = body.items.map(filename);
  const now = nowIso();
  const task = {
    id: `t-${randomBytes(16).toString('hex')}`, userId: 'local', toolId: body.toolId,
    toolName: 'Text summary', name: body.name.trim(), unit: 'files', status: 'queued',
    progress: 0, completedCount: 0, totalCount: names.length, items: names,
    hasUploads: true, inputsReady: false, createdAt: now, updatedAt: now,
    resultItems: [], problemItems: [], options: {},
  };
  await db.createTask(task);
  await db.initTaskItems(task.id, names, now);
  return task;
}

export async function getTask(id) {
  const task = await db.getTask(id);
  requireValue(task, 'Task not found', 404);
  return task;
}
export async function getItem(id, idx) {
  await getTask(id);
  const item = (await db.listTaskItems(id)).find(i => i.idx === idx);
  requireValue(item, 'Item not found', 404);
  return item;
}
// Preserve successful items for an explicit item retry; whole-task retries reset all outputs.
export async function retryTask(id, idx) {
  const task = await getTask(id);
  requireValue(['failed','needs-attention'].includes(task.status), 'Only failed tasks can retry', 409);
  if (idx !== undefined) {
    const item = await getItem(id, idx);
    requireValue(item.status === 'failed', 'Item is not failed', 409);
    await db.setTaskItemStatus(id, idx, 'pending', nowIso());
  } else await db.resetTaskItems(id, nowIso(), false);
  const completedCount = (await db.listTaskItems(id)).filter(i => i.status === 'done').length;
  const next = { ...task, status: 'queued', progress: Math.floor(completedCount * 100 / task.totalCount),
    completedCount, assignedWorkerId: undefined, startedAt: undefined, failedReason: undefined,
    problemItems: [], resultItems: [], options: {}, updatedAt: nowIso() };
  await db.updateTask(next);
  return next;
}
