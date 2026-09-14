// Extracted AutoHub Worker HTTP protocol; local files only.
export function createApi(config, fetchImpl = globalThis.fetch) {
    const authHeaders = {
        "content-type": "application/json",
        "x-autohub-worker-key": config.key,
    };
    async function call(path, body, timeoutOverrideMs) {
        const timeoutMs = Math.max(1, Number(timeoutOverrideMs) || Number(config.apiTimeoutMs) || 5_000);
        const controller = new AbortController();
        const timeoutError = new Error(`Worker API ${path} 在 ${timeoutMs}ms 内无响应（已超时）`);
        let timer;
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => {
                reject(timeoutError);
                controller.abort(timeoutError);
            }, timeoutMs);
        });
        try {
            return await Promise.race([deadline, (async () => {
                    const response = await fetchImpl(config.server + path, {
                        method: "POST",
                        redirect: "error",
                        headers: authHeaders,
                        body: body ? JSON.stringify(body) : undefined,
                        signal: controller.signal,
                    });
                    if (!response.ok) {
                        const text = await response.text().catch(() => "");
                        const error = new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
                        error.status = response.status;
                        throw error;
                    }
                    return await response.json();
                })()]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function callRaw(path, { method = "GET", body, contentType, extraHeaders = {} } = {}) {
        const headers = { "x-autohub-worker-key": config.key };
        if (contentType)
            headers["content-type"] = contentType;
        Object.assign(headers, extraHeaders);
        const options = { method, headers, body, redirect: "error", signal: AbortSignal.timeout(5000) };
        if (body && typeof body.pipe === "function")
            options.duplex = "half";
        const response = await fetchImpl(config.server + path, options);
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            const error = new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
            error.status = response.status;
            throw error;
        }
        return response;
    }
    return { register(info) {
            return call("/api/workers", { workerId: config.workerId, ...info });
        },
        heartbeat(currentTaskId, activeTaskCount, capacity, resources) {
            return call(`/api/workers/${config.workerId}/heartbeat`, {
                currentTaskId: currentTaskId ?? null,
                activeTaskCount,
                capacity,
                resources,
            });
        },
        claim(tools) {
            return call(`/api/workers/${config.workerId}/claim`, Array.isArray(tools) ? { tools } : {});
        },
        itemResult(taskId, idx, status, error) {
            return call(`/api/workers/${config.workerId}/tasks/${taskId}/items/${idx}/result`, { status, error });
        },
        async downloadInput(taskId, idx) {
            const response = await callRaw(`/api/workers/${config.workerId}/tasks/${taskId}/items/${idx}/input`, { method: "GET" });
            const contentType = response.headers.get("content-type") ?? "application/octet-stream";
            return { data: Buffer.from(await response.arrayBuffer()), contentType };
        },
        uploadResult(taskId, idx, data, contentType = "application/octet-stream") {
            return callRaw(`/api/workers/${config.workerId}/tasks/${taskId}/items/${idx}/result`, {
                method: "PUT",
                body: data,
                contentType,
            }).then((response) => response.json());
        },
        complete(taskId, resultItems) {
            return call(`/api/workers/${config.workerId}/tasks/${taskId}/complete`, { resultItems });
        },
        failed(taskId, reason, completedCount) {
            return call(`/api/workers/${config.workerId}/tasks/${taskId}/failed`, { reason, completedCount });
        },
        release(taskId) {
            return call(`/api/workers/${config.workerId}/tasks/${taskId}/release`, {});
        } };
}
