# Security policy

Report vulnerabilities privately through [GitHub Private Vulnerability Reporting](https://github.com/a844417934-coder/autohub-community/security/advisories/new). Do not send vulnerability details to a public issue. Include a minimal reproduction using synthetic data, the affected version and the expected security boundary; remove keys and private paths.

## Verified environment

Windows 11 was verified using non-elevated processes under an account belonging to Administrators. A pure standard-user account has not been separately verified; this is a documented v0.1 limitation. GitHub Hosted Windows CI runs on Windows Server 2025 and does not establish separate standard-account acceptance.

## Deployment boundary

Trusted LAN only / not internet hardened. Both listeners default to loopback and Admin cannot bind elsewhere. Browser access uses a single shared random capability key; no login, RBAC or separate-user isolation is advertised. Worker enrollment has a different key and subsequent process sessions and task leases. A missing Worker key fails closed. Worker key holders are trusted cluster members.

Host, Origin and Fetch-Metadata checks reject unexpected cross-site API access. CORS is not enabled. Keys are not accepted from query parameters or cookies. Do not expose plain HTTP over an untrusted network. The application serves only its own script/style resources and sends no telemetry.

File paths are derived from validated IDs and indexes. Uploads and results are bounded, temporary files are not downloadable, and existing symlink/junction components are refused. The trusted local OS account can still mutate the filesystem; protection against a malicious same-account process is not promised. Aggregate storage quotas and internet-scale denial-of-service controls are not implemented.

Executors are trusted installed code, never task-provided commands. Recovery may duplicate execution. Review extension code and give it only the privileges it needs. Do not use unknown executors with sensitive data.
