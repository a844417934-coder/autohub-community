# Changelog

## 0.1.0 — 2026-09-14

- Extracted the SQLite task queue, atomic claims, Worker protocol and workbench from AutoHub.
- Added a local text executor, generated demo configuration and file round-trip smoke test.
- Restricted default listeners, added capability keys, Worker sessions, task leases and bounded file operations.
- Added Windows acceptance tests for task takeover and explicit item retry.

Windows 11 was verified with non-elevated processes under an Administrators-group account. A pure standard-user account has not been separately verified. GitHub Hosted Windows CI passed; this edition remains for local and trusted-team use.
