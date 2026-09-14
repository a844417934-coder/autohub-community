# Executor API

The v0.1 reference executor is `executeText({ workspace, inputName, outputName })` in worker-client/executor.mjs. It reads a bounded UTF-8 input and writes a JSON text summary containing byte/line/word counts, SHA-256 and uppercase text. It returns an output filename selected by trusted code.

The Worker chooses a fresh workspace, fixed input.txt and result.txt names, downloads the assigned item, invokes the function and uploads actual bytes. The Server promotes final bytes before marking the item done. No task payload may select a shell command, executable, import path or working directory. The filesystem helper rejects absolute paths, traversal, alternate streams and linked path components. The local OS account and filesystem remain trusted; this is not an untrusted-code sandbox.

To add an executor, review and install its source yourself, give it a fixed tool ID in both Server and Worker allowlists, define bounded validated inputs, and invoke it through a static import. Update tests and third-party notices. Never implement dynamic eval, child-process commands or arbitrary imports driven by submitted task data.

Worker protocol: POST /api/workers enrolls with x-autohub-worker-key, returning a session. Heartbeat and claim require x-autohub-worker-session. Claims return a task lease, supplied as x-autohub-task-lease on task input/result/complete/failed/release routes. All task/item identifiers are validated. Item results use PUT with actual bytes; POST result is restricted to a bounded failure report.

Recovery is at-least-once and can repeat all items after an interruption. Protect external side effects with your own durable idempotency key. Explicit item retry only reruns the failed item. The local --fail-once and --delay test switches are injected by acceptance commands; submitted task options cannot enable them.
