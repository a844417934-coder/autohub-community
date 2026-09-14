# Troubleshooting

- **Wrong Node version:** install Node 22.23.2 x64 and confirm node --version. Node's built-in SQLite may print an ExperimentalWarning; do not confuse it with a failed test.
- **Port already in use:** stop your previous community demo or choose two distinct config ports within 43000–43999. Never stop unrelated processes to obtain a port.
- **401:** use browserKey for browser APIs; workerKey only enrolls Workers. Process sessions are returned at registration. Do not use a username header or cookie as authentication.
- **403 Host/Origin:** open the exact local URL. LAN requires explicit allowedHosts. Do not disable the guard to make a cross-origin page work.
- **Task stays queued:** start a Worker, check matching demo-text capability, and ensure all inputs were committed. A Worker with a fresh registration cannot be registered again under the same name.
- **Worker restart or Server restart:** wait for the fifteen-second stale heartbeat interval when reusing a Worker name. Restart Workers after a Server restart. No automatic enrollment recovery loop is promised.
- **Upload fails:** supply 1–16 filenames without path syntax and nonempty files at most 65,536 bytes. Committed inputs are immutable. Invalid UTF-8 and oversized summaries fail the demo executor.
- **Retry:** only failed tasks can retry. In the result panel, retry a failed item to preserve successful items. The whole-task retry endpoint resets every item.
- **Read-only diagnostics:** request /api/diagnostics on the configured adminPort with x-autohub-browser-key. The listener always stays on loopback.
- **Audit registry error:** use npm audit --registry=https://registry.npmjs.org. Some mirrors do not implement security audit endpoints; a registry error is not a passing audit.

Verification commands: npm run check, npm test, npm run build, npm run demo:smoke. Installation uses npm ci with the committed lockfile. Tests create isolated temporary directories, use dedicated community ports and generate all input data. Do not run multiple copies of the test suite simultaneously because its ports are fixed.
