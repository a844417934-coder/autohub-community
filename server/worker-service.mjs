// Derived from AutoHub: assignment checks, counts, completion gate, failure and release.
import { getDatabaseAdapter, nowIso } from './db/sqlite-adapter.mjs';
export async function requireAssigned(workerId, taskId) {
    const adapter = await getDatabaseAdapter();
    const task = await adapter.getTask(taskId);
    if (!task)
        throw Object.assign(new Error(`任务不存在：${taskId}`), { status: 404 });
    if (task.assignedWorkerId !== workerId) {
        throw Object.assign(new Error(`任务 ${taskId} 不属于 Worker ${workerId}`), { status: 403 });
    }
    if (task.status !== "processing") {
        throw Object.assign(new Error(`任务 ${taskId} 已不处于处理中，Worker 租约已失效`), { status: 409 });
    }
    return task;
}
async function recomputeTaskCounts(taskId) {
    const adapter = await getDatabaseAdapter();
    const task = await adapter.getTask(taskId);
    if (!task)
        throw Object.assign(new Error(`任务不存在：${taskId}`), { status: 404 });
    const records = await adapter.listTaskItems(taskId);
    const done = records.filter((record) => record.status === "done").length;
    const updated = { ...task, completedCount: done, updatedAt: nowIso() };
    await adapter.updateTask(updated);
    return updated;
}
export async function completeTask(workerId, taskId, _req) {
    const adapter = await getDatabaseAdapter();
    const task = await requireAssigned(workerId, taskId);
    const records = await adapter.listTaskItems(taskId);
    const notDone = records.filter((record) => record.status !== "done");
    const missingOutput = records.filter((record) => !record.outputStorageKey);
    if (records.length !== task.totalCount) {
        throw Object.assign(new Error(`任务条目数 ${records.length} ≠ 总数 ${task.totalCount}，不能标记完成`), { status: 409 });
    }
    if (notDone.length > 0) {
        throw Object.assign(new Error(`仍有 ${notDone.length} 项未完成（idx: ${notDone.map((record) => record.idx).join(", ")}），不能标记完成`), { status: 409 });
    }
    if (missingOutput.length > 0) {
        throw Object.assign(new Error(`仍有 ${missingOutput.length} 项缺少正式结果文件（idx: ${missingOutput.map((record) => record.idx).join(", ")}），不能标记完成`), { status: 409 });
    }
    const updated = {
        ...task,
        status: "completed",
        progress: 100,
        completedCount: task.totalCount,
        currentItem: undefined,
        progressDetail: undefined,
        resultItems: records.map((record) => record.name),
        problemItems: [],
        updatedAt: nowIso(),
    };
    await adapter.updateTask(updated);
    if (task.status === "processing")
        await adapter.settleWorkerTask(workerId, taskId, updated.updatedAt);
    return updated;
}
export async function failTask(workerId, taskId, req) {
    const adapter = await getDatabaseAdapter();
    const task = await requireAssigned(workerId, taskId);
    const records = await adapter.listTaskItems(taskId);
    const done = records.filter((record) => record.status === "done").length;
    const updated = {
        ...task,
        status: "failed",
        progress: 100,
        completedCount: done,
        currentItem: undefined,
        progressDetail: undefined,
        failedReason: req.reason,
        problemItems: [],
        resultItems: [],
        updatedAt: nowIso(),
    };
    await adapter.updateTask(updated);
    if (task.status === "processing")
        await adapter.settleWorkerTask(workerId, taskId, updated.updatedAt);
    return updated;
}
export async function releaseTask(workerId, taskId) {
    const adapter = await getDatabaseAdapter();
    const task = await requireAssigned(workerId, taskId);
    const now = nowIso();
    const options = { ...(task.options ?? {}) };
    const updated = {
        ...task,
        status: "queued",
        progress: 0,
        completedCount: 0,
        currentItem: undefined,
        progressDetail: undefined,
        assignedWorkerId: undefined,
        startedAt: undefined,
        failedReason: undefined,
        problemItems: [],
        resultItems: [],
        options,
        updatedAt: now,
    };
    await adapter.updateTask(updated);
    await adapter.resetTaskItems(taskId, now, false);
    await adapter.settleWorkerTask(workerId, taskId, now);
    return updated;
}
