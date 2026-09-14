// Original AutoHub adapter regression cases, extracted with synthetic fixtures.
import {beforeEach,afterEach,it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {getDatabaseAdapter,openDatabase,closeDatabase} from '../server/db/sqlite-adapter.mjs';
let root,dbFile;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'autohub original tests '));dbFile=join(root,'db.sqlite');openDatabase(dbFile);});
afterEach(()=>{closeDatabase();rmSync(root,{recursive:true,force:true});});
function sampleTask(overrides = {}) {
    return {
        id: "TSK-TEST-1",
        userId: "u-test",
        toolId: "demo-text",
        toolName: "Text summary",
        name: "测试任务",
        unit: "files",
        status: "queued",
        progress: 0,
        completedCount: 0,
        totalCount: 10,
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
        resultItems: [],
        problemItems: [],
        ...overrides,
    };
}
it("createTask / getTask 完整往返（含 payload 字段）", async () => {
    const adapter = await getDatabaseAdapter();
    const problem = { id: "problem-x", name: "IMG_1.txt", reason: "方向不对", nextAction: "旋转后重试" };
    const task = sampleTask({
        id: "TSK-RT-1",
        status: "needs-attention",
        progress: 80,
        completedCount: 8,
        currentItem: "IMG_9.txt",
        problemItems: [problem],
        options: { example: true },
        progressDetail: { phase: "export", completed: 3, total: 8, unit: "个成品" },
    });
    await adapter.createTask(task);
    const loaded = await adapter.getTask("TSK-RT-1");
    assert.ok(loaded);
    assert.equal(loaded.status, "needs-attention");
    assert.equal(loaded.completedCount, 8);
    assert.equal(loaded.currentItem, "IMG_9.txt");
    assert.deepEqual(loaded.problemItems, [problem]);
    assert.deepEqual(loaded.options, { example: true });
    assert.deepEqual(loaded.progressDetail, { phase: "export", completed: 3, total: 8, unit: "个成品" });
    assert.equal(loaded.isSeed, false);
});
it("listTasks 按创建时间倒序，支持 limit", async () => {
    const adapter = await getDatabaseAdapter();
    await adapter.createTask(sampleTask({ id: "TSK-ORD-1", createdAt: "2026-08-15T10:00:00.000Z" }));
    await adapter.createTask(sampleTask({ id: "TSK-ORD-2", createdAt: "2026-08-15T11:00:00.000Z" }));
    const all = await adapter.listTasks("u-test");
    assert.equal(all[0].id, "TSK-ORD-2");
    const limited = await adapter.listTasks("u-test", 1);
    assert.equal(limited.length, 1);
    assert.equal(limited[0].id, "TSK-ORD-2");
});
it("updateTask 持久化状态变更", async () => {
    const adapter = await getDatabaseAdapter();
    const task = sampleTask({ id: "TSK-UPD-1" });
    await adapter.createTask(task);
    await adapter.updateTask({ ...task, status: "processing", progress: 42, completedCount: 4 });
    const loaded = await adapter.getTask("TSK-UPD-1");
    assert.equal(loaded.status, "processing");
    assert.equal(loaded.progress, 42);
});
it("deleteTerminalTask 只删除终态任务及其条目", async () => {
    const adapter = await getDatabaseAdapter();
    for (const status of ["completed", "needs-attention", "failed"]) {
        const id = `TSK-DELETE-${status}`;
        await adapter.createTask(sampleTask({ id, status }));
        await adapter.initTaskItems(id, ["input-a.txt", "input-b.txt"], "2026-08-15T00:01:00.000Z");
        assert.equal(await adapter.deleteTerminalTask(id), "deleted");
        assert.equal(await adapter.getTask(id), null);
        assert.deepEqual(await adapter.listTaskItems(id), []);
    }
});
it("deleteTerminalTask 拒绝 queued/processing 且保留任务与条目", async () => {
    const adapter = await getDatabaseAdapter();
    for (const status of ["queued", "processing"]) {
        const id = `TSK-KEEP-${status}`;
        await adapter.createTask(sampleTask({ id, status }));
        await adapter.initTaskItems(id, ["input.txt"], "2026-08-15T00:01:00.000Z");
        assert.equal(await adapter.deleteTerminalTask(id), "not-terminal");
        assert.equal((await adapter.getTask(id))?.status, status);
        assert.equal((await adapter.listTaskItems(id)).length, 1);
    }
    assert.equal(await adapter.deleteTerminalTask("TSK-NOT-FOUND"), "not-found");
});
it("文件持久化：重新打开同一数据库文件，数据仍在且种子不重复", async () => {
    let adapter = await getDatabaseAdapter();
    await adapter.createTask(sampleTask({ id: "TSK-PERSIST-1" }));
    closeDatabase();
    openDatabase(dbFile);
    adapter = await getDatabaseAdapter();
    const loaded = await adapter.getTask("TSK-PERSIST-1");
    assert.ok(loaded, "重启后任务应仍在");
    const visible = await adapter.listTasks("u-001");
    assert.equal(visible.length, 0, "默认无种子，重启后也不播种");
});
