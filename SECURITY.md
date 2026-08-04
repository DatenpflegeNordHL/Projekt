# Security Policy

## Supported version

Security fixes currently target the latest commit on `main`. The project is under active development and does not yet maintain parallel supported release branches.

## Reporting a vulnerability

Do not publish credentials, exploit details or sensitive repository data in a public issue.

Use GitHub private vulnerability reporting or a private security advisory for this repository when available. If that route is unavailable, contact the repository owner privately before opening a public issue.

Include:

- affected commit or version;
- affected file and code path;
- reproduction steps or a minimal proof of concept;
- expected and observed behaviour;
- security impact;
- whether credentials, network access, Git authority, hidden verifiers or candidate-workspace isolation are involved;
- any temporary mitigation already tested.

Reports will be assessed against the project's trust invariants and reproduced without using real credentials where possible.

## Security-sensitive areas

The following areas require especially careful review:

- runtime and executable identity;
- process-group termination and cleanup;
- allowed-path and patch validation;
- Git authority and commit boundaries;
- credential and environment handling;
- model/provider identity and fallback behaviour;
- hidden verifier and reference-repair isolation;
- telemetry, receipts and secret redaction;
- benchmark candidate-workspace separation;
- network and filesystem isolation for future real runs.

## Disclosure expectations

Please allow time to reproduce, classify and prepare a bounded fix before public disclosure. The repository owner will document whether the report is confirmed, the affected scope, the remediation and any remaining limitation.

## Explicit non-claims

Until Gate B passes, CodexLooper does not claim a general operating-system sandbox for real model benchmark runs. The completed WP8 Phase-A harness is deterministic and offline; it does not prove real-run credential, network or process isolation.
