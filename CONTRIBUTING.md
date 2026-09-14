# Contributing

Keep changes focused on a small, understandable Windows Worker cluster. Explain the problem, resulting behavior and actual verification. Use synthetic fixtures and retain the original license of dependencies. Do not include private configuration, task data, credentials, machine names or screenshots from other installations.

Use Node 22.23.2. Run npm ci, npm run check, npm test, npm run build and npm run demo:smoke. The check script validates JavaScript syntax; no TypeScript/lint result is implied. Tests cover extracted database cases, file ownership, upload limits, task completion, task takeover and item retry. The CI is intentionally build/test only and has no publication step.

Discuss broad scope changes before implementation. New executors require input validation, explicit trust boundaries, license review and real file-result tests. Security issues belong in the private channel described in SECURITY.md, not a public issue.
