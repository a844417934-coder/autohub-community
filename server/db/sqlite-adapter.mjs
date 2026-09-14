// Extracted from the original AutoHub SQLite adapter; maintenance and external storage removed.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as sql from './sql.mjs';
const {claimTaskSql,REQUeUE_STALE_TASKS_SQL,MARK_WORKERS_OFFLINE_SQL,UPSERT_WORKER_SQL,SETTLE_WORKER_TASK_SQL,GET_TASK_BY_ID_SQL,RESET_ITEMS_SQL,RESET_RUNNING_ITEMS_SQL,INSERT_ITEM_SQL,LIST_ITEMS_SQL,SET_ITEM_STATUS_SQL,SET_ITEM_INPUT_KEY_SQL,SET_ITEM_DONE_WITH_OUTPUT_SQL,SET_TASK_INPUTS_READY_SQL} = sql;
let database;
export function openDatabase(file) {
  if (database) throw new Error('Only one Server instance per process is supported');
  mkdirSync(dirname(file), { recursive: true });
  database = new DatabaseSync(file);
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  database.exec(CREATE_TABLE_SQL);
}
export function closeDatabase() { database?.close(); database = undefined; }
async function getDb() { if (!database) throw new Error('Database not open'); return database; }
export const nowIso = () => new Date().toISOString();
export const getDatabaseAdapter = async () => sqliteAdapter;
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS autohub_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  current_item TEXT,
  assigned_worker_id TEXT,
  required_worker_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  is_seed INTEGER NOT NULL DEFAULT 0,
  has_uploads INTEGER NOT NULL DEFAULT 0,
  inputs_ready INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS autohub_workers (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL DEFAULT '',
  cpu TEXT NOT NULL DEFAULT '',
  ram TEXT NOT NULL DEFAULT '',
  gpu TEXT NOT NULL DEFAULT '',
  tools TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'offline',
  current_task_id TEXT,
  capacity INTEGER NOT NULL DEFAULT 1,
  active_task_count INTEGER NOT NULL DEFAULT 0,
  resources_json TEXT NOT NULL DEFAULT '{}',
  last_heartbeat_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS autohub_task_items (
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  input_storage_key TEXT,
  output_storage_key TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, idx)
);

`;
function taskToRow(task) {
    return [
        task.id,
        task.userId,
        task.toolId,
        task.toolName,
        task.name,
        task.unit,
        task.status,
        task.progress,
        task.completedCount,
        task.totalCount,
        task.currentItem ?? null,
        task.assignedWorkerId ?? null,
        task.requiredWorkerId ?? null,
        task.createdAt,
        task.updatedAt,
        task.startedAt ?? null,
        task.isSeed ? 1 : 0,
        task.hasUploads ? 1 : 0,
        task.inputsReady === false ? 0 : 1,
        taskPayload(task),
    ];
}
function taskPayload(task) {
    return JSON.stringify({
        items: task.items ?? [],
        plan: undefined,
        resultItems: task.resultItems ?? [],
        problemItems: task.problemItems ?? [],
        failedReason: task.failedReason,
        options: task.options ?? {},
        archivedAt: task.archivedAt,
        progressDetail: task.progressDetail,
    });
}
function rowToTask(row) {
    const payload = JSON.parse(String(row.payload_json ?? "{}"));
    return {
        id: String(row.id),
        userId: String(row.user_id),
        toolId: String(row.tool_id),
        toolName: String(row.tool_name),
        name: String(row.name),
        unit: String(row.unit),
        status: row.status,
        progress: Number(row.progress),
        completedCount: Number(row.completed_count),
        totalCount: Number(row.total_count),
        currentItem: row.current_item ? String(row.current_item) : undefined,
        assignedWorkerId: row.assigned_worker_id ? String(row.assigned_worker_id) : undefined,
        requiredWorkerId: row.required_worker_id ? String(row.required_worker_id) : undefined,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        startedAt: row.started_at ? String(row.started_at) : undefined,
        resultItems: payload.resultItems ?? [],
        problemItems: payload.problemItems ?? [],
        failedReason: payload.failedReason,
        items: payload.items && payload.items.length > 0 ? payload.items : undefined,
        isSeed: Number(row.is_seed) === 1,
        hasUploads: Number(row.has_uploads) === 1,
        inputsReady: Number(row.inputs_ready ?? 1) === 1,
        options: payload.options ?? {},
        archivedAt: payload.archivedAt,
        progressDetail: payload.progressDetail,
    };
}
function workerToRow(worker) {
    return [
        worker.id,
        worker.hostname,
        worker.cpu,
        worker.ram,
        worker.gpu,
        JSON.stringify(worker.tools ?? []),
        worker.status,
        worker.currentTaskId ?? null,
        worker.capacity,
        worker.activeTaskCount,
        JSON.stringify(worker.resources ?? {}),
        worker.lastHeartbeatAt,
        worker.createdAt,
        worker.updatedAt,
    ];
}
function rowToWorker(row) {
    return {
        id: String(row.id),
        hostname: String(row.hostname),
        cpu: String(row.cpu),
        ram: String(row.ram),
        gpu: String(row.gpu),
        tools: JSON.parse(String(row.tools ?? "[]")),
        status: row.status,
        currentTaskId: row.current_task_id ? String(row.current_task_id) : null,
        capacity: Math.max(1, Number(row.capacity ?? 1)),
        activeTaskCount: Math.max(0, Number(row.active_task_count ?? 0)),
        resources: JSON.parse(String(row.resources_json ?? "{}")),
        lastHeartbeatAt: String(row.last_heartbeat_at),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}
function parsePayloadForUpdate(task) {
    return JSON.stringify({
        items: task.items ?? [],
        resultItems: task.resultItems ?? [],
        problemItems: task.problemItems ?? [],
        failedReason: task.failedReason,
        options: task.options ?? {},
        archivedAt: task.archivedAt,
        progressDetail: task.progressDetail,
    });
}
export const sqliteAdapter = { async listTasks(userId, limit) {
        const db = await getDb();
        const statement = db.prepare("SELECT * FROM autohub_tasks WHERE user_id = ? AND is_seed = 0 ORDER BY created_at DESC" + (limit ? " LIMIT ?" : ""));
        const rows = limit ? statement.all(userId, limit) : statement.all(userId);
        return rows.map(rowToTask);
    },
    async listTasksForAdmin(limit) {
        const db = await getDb();
        const statement = db.prepare("SELECT * FROM autohub_tasks WHERE is_seed = 0 ORDER BY created_at DESC" + (limit ? " LIMIT ?" : ""));
        const rows = limit ? statement.all(limit) : statement.all();
        return rows.map(rowToTask);
    },
    async getTask(id) {
        const db = await getDb();
        const row = db.prepare(GET_TASK_BY_ID_SQL).get(id);
        return row ? rowToTask(row) : null;
    },
    async createTask(task) {
        const db = await getDb();
        db.prepare(`
      INSERT INTO autohub_tasks (
        id, user_id, tool_id, tool_name, name, unit, status, progress,
        completed_count, total_count, current_item, assigned_worker_id, required_worker_id,
        created_at, updated_at, started_at, is_seed, has_uploads, inputs_ready, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...taskToRow(task));
    },
    async updateTask(task) {
        const db = await getDb();
        db.prepare(`
      UPDATE autohub_tasks SET
        user_id = ?, tool_id = ?, tool_name = ?, name = ?, unit = ?,
        status = ?, progress = ?, completed_count = ?, total_count = ?,
        current_item = ?, assigned_worker_id = ?, required_worker_id = ?, created_at = ?, updated_at = ?,
        started_at = ?, is_seed = ?, has_uploads = ?, inputs_ready = ?, payload_json = ?
      WHERE id = ?
    `).run(task.userId, task.toolId, task.toolName, task.name, task.unit, task.status, task.progress, task.completedCount, task.totalCount, task.currentItem ?? null, task.assignedWorkerId ?? null, task.requiredWorkerId ?? null, task.createdAt, task.updatedAt, task.startedAt ?? null, task.isSeed ? 1 : 0, task.hasUploads ? 1 : 0, task.inputsReady === false ? 0 : 1, parsePayloadForUpdate(task), task.id);
    },
    async deleteTerminalTask(id) {
        const db = await getDb();
        db.exec("BEGIN IMMEDIATE");
        try {
            const row = db.prepare("SELECT status FROM autohub_tasks WHERE id = ?").get(id);
            if (!row) {
                db.exec("ROLLBACK");
                return "not-found";
            }
            if (!["completed", "needs-attention", "failed"].includes(String(row.status))) {
                db.exec("ROLLBACK");
                return "not-terminal";
            }
            db.prepare("DELETE FROM autohub_task_items WHERE task_id = ?").run(id);
            db.prepare("DELETE FROM autohub_tasks WHERE id = ?").run(id);
            db.exec("COMMIT");
            return "deleted";
        }
        catch (error) {
            try {
                db.exec("ROLLBACK");
            }
            catch { }
            throw error;
        }
    },
    async claimNextTask(workerId, tools, now, capacity) {
        const db = await getDb();
        const params = [workerId, now, now];
        for (const tool of tools)
            params.push(tool);
        params.push(workerId, workerId, capacity);
        const claimed = db.prepare(claimTaskSql(tools.length)).get(...params);
        if (!claimed)
            return null;
        const row = db.prepare(GET_TASK_BY_ID_SQL).get(String(claimed.id));
        return row ? rowToTask(row) : null;
    },
    async requeueStaleTasks(now, heartbeatTimeoutMs) {
        const db = await getDb();
        const cutoff = new Date(Date.parse(now) - heartbeatTimeoutMs).toISOString();
        const result = db.prepare(REQUeUE_STALE_TASKS_SQL).run(now, cutoff);
        return Number(result.changes ?? 0);
    },
    async upsertWorker(worker) {
        const db = await getDb();
        db.prepare(UPSERT_WORKER_SQL).run(...workerToRow(worker));
    },
    async settleWorkerTask(workerId, taskId, now) {
        const db = await getDb();
        db.prepare(SETTLE_WORKER_TASK_SQL).run(taskId, now, workerId);
    },
    async getWorker(id) {
        const db = await getDb();
        const row = db.prepare("SELECT * FROM autohub_workers WHERE id = ?").get(id);
        return row ? rowToWorker(row) : null;
    },
    async listWorkers() {
        const db = await getDb();
        const rows = db.prepare("SELECT * FROM autohub_workers ORDER BY created_at ASC").all();
        return rows.map(rowToWorker);
    },
    async listWorkerTaskLoads() {
        const db = await getDb();
        const rows = db.prepare(`
      SELECT id, assigned_worker_id
      FROM autohub_tasks
      WHERE status = 'processing' AND assigned_worker_id IS NOT NULL
      ORDER BY started_at ASC, id ASC
    `).all();
        const loads = {};
        for (const row of rows) {
            const workerId = String(row.assigned_worker_id);
            const current = loads[workerId] ?? { activeTaskCount: 0, currentTaskId: null };
            current.activeTaskCount += 1;
            current.currentTaskId ??= String(row.id);
            loads[workerId] = current;
        }
        return loads;
    },
    async markWorkersOffline(now, heartbeatTimeoutMs) {
        const db = await getDb();
        const cutoff = new Date(Date.parse(now) - heartbeatTimeoutMs).toISOString();
        db.prepare(MARK_WORKERS_OFFLINE_SQL).run(now, cutoff);
    },
    async initTaskItems(taskId, names, now) {
        const db = await getDb();
        const insert = db.prepare(INSERT_ITEM_SQL);
        names.forEach((name, idx) => {
            insert.run(taskId, idx, name, now);
        });
    },
    async listTaskItems(taskId) {
        const db = await getDb();
        const rows = db.prepare(LIST_ITEMS_SQL).all(taskId);
        return rows.map((row) => ({
            taskId: String(row.task_id),
            idx: Number(row.idx),
            name: String(row.name),
            status: row.status,
            error: row.error ? String(row.error) : undefined,
            inputStorageKey: row.input_storage_key ? String(row.input_storage_key) : undefined,
            outputStorageKey: row.output_storage_key ? String(row.output_storage_key) : undefined,
            updatedAt: String(row.updated_at),
        }));
    },
    async setTaskItemStatus(taskId, idx, status, now, error) {
        const db = await getDb();
        db.prepare(SET_ITEM_STATUS_SQL).run(status, error ?? null, now, taskId, idx);
    },
    async setTaskItemInputKey(taskId, idx, key, now) {
        const db = await getDb();
        db.prepare(SET_ITEM_INPUT_KEY_SQL).run(key, now, taskId, idx);
    },
    async setTaskItemDoneWithOutput(taskId, idx, key, now) {
        const db = await getDb();
        db.prepare(SET_ITEM_DONE_WITH_OUTPUT_SQL).run(key, now, taskId, idx);
    },
    async setTaskInputsReady(taskId, now) {
        const db = await getDb();
        db.prepare(SET_TASK_INPUTS_READY_SQL).run(now, taskId);
    },
    async resetTaskItems(taskId, now, runningOnly) {
        const db = await getDb();
        if (runningOnly) {
            db.prepare(RESET_RUNNING_ITEMS_SQL).run(taskId);
        }
        else {
            db.prepare(RESET_ITEMS_SQL).run(taskId);
        }
    } };
