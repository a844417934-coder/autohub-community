# Security policy — unpublished candidate

This candidate has no published repository or verified private reporting channel yet. **Publication is blocked until GitHub Private Vulnerability Reporting is enabled and confirmed on the independent community repository.** Do not send vulnerability details to a public issue. The intended future private report endpoint is https://github.com/a844417934-coder/autohub-community/security/advisories/new; it is not claimed active in this candidate.

## Deployment boundary

Trusted LAN only / not internet hardened. Both listeners default to loopback and Admin cannot bind elsewhere. Browser access uses a single shared random capability key; no login, RBAC or separate-user isolation is advertised. Worker enrollment has a different key and subsequent process sessions and task leases. A missing Worker key fails closed. Worker key holders are trusted cluster members.

Host, Origin and Fetch-Metadata checks reject unexpected cross-site API access. CORS is not enabled. Keys are not accepted from query parameters or cookies. Do not expose plain HTTP over an untrusted network. The application serves only its own script/style resources and sends no telemetry.

File paths are derived from validated IDs and indexes. Uploads and results are bounded, temporary files are not downloadable, and existing symlink/junction components are refused. The trusted local OS account can still mutate the filesystem; protection against a malicious same-account process is not promised. Aggregate storage quotas and internet-scale denial-of-service controls are not implemented.

Executors are trusted installed code, never task-provided commands. Recovery may duplicate execution. Review extension code and give it only the privileges it needs. Do not use unknown executors with sensitive data.
