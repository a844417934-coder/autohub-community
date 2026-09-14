// Extracted AutoHub atomic scheduling and item SQL; local-only community edition.
export function claimTaskSql(toolCount) {
    const placeholders = toolCount > 0 ? `AND tool_id IN (${toolCount > 1 ? Array(toolCount).fill("?").join(", ") : "?"})` : "";
    return `
    UPDATE autohub_tasks
    SET status = 'processing', assigned_worker_id = ?, started_at = ?, updated_at = ?
    WHERE id = (
      SELECT id FROM autohub_tasks
      WHERE status = 'queued' AND is_seed = 0 AND assigned_worker_id IS NULL ${placeholders}
        AND (required_worker_id IS NULL OR required_worker_id = ?)
        AND (has_uploads = 0 OR inputs_ready = 1)
        AND (
          SELECT COUNT(*) FROM autohub_tasks active
          WHERE active.status = 'processing' AND active.assigned_worker_id = ?
        ) < ?
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING id
  `;
}
export const REQUeUE_STALE_TASKS_SQL = `
  UPDATE autohub_tasks
  SET status = 'queued', assigned_worker_id = NULL, started_at = NULL,
      progress = 0, completed_count = 0, current_item = NULL,
      payload_json = json_remove(
        CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,
        '$.progressDetail', '$.failedReason', '$.problemItems', '$.resultItems'
      ),
      updated_at = ?
  WHERE status = 'processing'
    AND assigned_worker_id IS NOT NULL
    AND assigned_worker_id NOT IN (
      SELECT id FROM autohub_workers WHERE last_heartbeat_at >= ?
    )
`;
export const MARK_WORKERS_OFFLINE_SQL = `
  UPDATE autohub_workers
  SET status = 'offline', current_task_id = NULL, active_task_count = 0, updated_at = ?
  WHERE last_heartbeat_at < ?
`;
export const UPSERT_WORKER_SQL = `
  INSERT INTO autohub_workers (
    id, hostname, cpu, ram, gpu, tools, status, current_task_id,
    capacity, active_task_count, resources_json, last_heartbeat_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    hostname = excluded.hostname,
    cpu = excluded.cpu,
    ram = excluded.ram,
    gpu = excluded.gpu,
    tools = excluded.tools,
    status = excluded.status,
    current_task_id = excluded.current_task_id,
    capacity = excluded.capacity,
    active_task_count = excluded.active_task_count,
    resources_json = excluded.resources_json,
    last_heartbeat_at = excluded.last_heartbeat_at,
    updated_at = excluded.updated_at
`;
export const SETTLE_WORKER_TASK_SQL = `
  UPDATE autohub_workers
  SET active_task_count = CASE WHEN active_task_count > 0 THEN active_task_count - 1 ELSE 0 END,
      status = CASE WHEN active_task_count > 1 THEN 'busy' ELSE 'online' END,
      current_task_id = CASE WHEN current_task_id = ? THEN NULL ELSE current_task_id END,
      updated_at = ?
  WHERE id = ?
`;
export const GET_TASK_BY_ID_SQL = "SELECT * FROM autohub_tasks WHERE id = ? LIMIT 1";
export const RESET_ITEMS_SQL = "UPDATE autohub_task_items SET status = 'pending', error = NULL, output_storage_key = NULL WHERE task_id = ?";
export const RESET_RUNNING_ITEMS_SQL = "UPDATE autohub_task_items SET status = 'pending', error = NULL, output_storage_key = NULL WHERE task_id = ? AND status = 'running'";
export const INSERT_ITEM_SQL = `
  INSERT OR IGNORE INTO autohub_task_items (task_id, idx, name, status, error, updated_at)
  VALUES (?, ?, ?, 'pending', NULL, ?)
`;
export const LIST_ITEMS_SQL = "SELECT task_id, idx, name, status, error, input_storage_key, output_storage_key, updated_at FROM autohub_task_items WHERE task_id = ? ORDER BY idx ASC";
export const SET_ITEM_STATUS_SQL = `
  UPDATE autohub_task_items SET status = ?, error = ?, updated_at = ? WHERE task_id = ? AND idx = ?
`;
export const SET_ITEM_INPUT_KEY_SQL = "UPDATE autohub_task_items SET input_storage_key = ?, updated_at = ? WHERE task_id = ? AND idx = ?";
export const SET_ITEM_DONE_WITH_OUTPUT_SQL = `
  UPDATE autohub_task_items
  SET status = 'done', error = NULL, output_storage_key = ?, updated_at = ?
  WHERE task_id = ? AND idx = ?
`;
export const SET_TASK_INPUTS_READY_SQL = "UPDATE autohub_tasks SET inputs_ready = 1, updated_at = ? WHERE id = ?";
