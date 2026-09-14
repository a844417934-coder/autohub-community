# Architecture

The community runtime extracts the original AutoHub SQLite adapter, shared atomic scheduling SQL, completion/assignment state transitions, Worker HTTP methods, React data hooks and task-card structure. Database and protocol code was converted from TypeScript to ordinary ES modules. External storage, maintenance, deployment, cloud/starter runtime integration and private tool adapters were removed. The community HTTP boundary, capability keys, sessions, task leases and text executor are new.

The Server owns all authoritative task/item state. Submission creates queued tasks with inputs_ready=false. Each upload is stored under a generated task ID and item index through temporary-file promotion. Commit verifies every input reference. The original UPDATE ... RETURNING claim SQL enforces tool matching and capacity using actual processing task rows. A task lease protects assignment writes from old executions.

A Worker enrolls with the Worker key and gets a process session. Heartbeats run every three seconds. The Server expires sessions after fifteen seconds, releases affected tasks and resets their item state. Server restart also invalidates sessions and requeues old assignments. Restart Workers after a Server restart. Task takeover is at-least-once. Explicit item retry keeps done items and only returns the remaining items to the Worker.

Completion checks item count, done status and a real final output reference. A status-only success report cannot complete a task. File routes always verify the item belongs to the addressed task; Worker routes additionally verify process session, current assignment and task lease. Browser key holders share one trusted workspace and can see all its tasks; there are no separate tenants.

The single Server serializes requests around asynchronous reads and writes, while SQLite retains atomic claims. This favors understandable correctness for small trusted clusters over high-throughput internet service. An authenticated slow request can delay the queue; this edition makes no denial-of-service resistance claim.

Admin diagnostics use a separate listener fixed to loopback and expose counts and Worker snapshots only. Both listeners require exact configured Host values and deny cross-site Origin/Fetch-Metadata requests. State APIs require a browser capability header; no cookies or client-selected user IDs are trusted.
