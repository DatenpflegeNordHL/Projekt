# WP6B Read-only Code Review Graph Integration

Status: **BLOCKED ON CRG ENVIRONMENT SEAL AND SANDBOX PROOF**

WP6A Loop Trust Hardening and the authorised macOS Runtime A proof are complete.
The original Code Review Graph v2.3.6 package is installed and its local package
identity is recorded in:

`docs/architecture/WP6B_CRG_LOCAL_INSTALL_PROOF.md`

Independent plan review is recorded in:

`docs/architecture/WP6B_INDEPENDENT_PLAN_REVIEW.md`

This specification intentionally remains outside `docs/plans/`. It must not be
promoted or executed until:

1. the complete CRG environment is content-manifested and sealed read-only;
2. the canonical Python interpreter identity is recorded;
3. the macOS sandbox prerequisite is proven;
4. this exact plan receives a final independent review with no blocking finding;
5. explicit WP6B execution authorisation is given.

Controlling contract:
`docs/architecture/CODEXLOOPER_LOOP_TRUST_INVARIANTS.md`

## Goal

Extend CodexLooper with an optional, local, bounded and read-only Code Review
Graph advisory stage that improves Sol review targeting without weakening
runtime immutability, branch authority, sandboxing, path policy, credential
handling, receipts or independent review.

A separate WP6C plan performs the first isolated live self-hosted CRG smoke only
after Runtime B is installed from the reviewed WP6B candidate.

## Satisfied prerequisites

- WP6A trust hardening: PASS.
- Runtime A local proof on macOS arm64: PASS.
- Local regression: 68 passed, 0 failed.
- Original CRG package installed from exact release commit: PASS.
- CRG package and CLI version: `2.3.6`.
- Installed console command regular, executable and non-symlink: PASS.
- Model calls during installation proof: `0`.
- CRG graph builds during installation proof: `0`.
- `code-review-graph install` used: `false`.

## Open prerequisites

- full isolated-environment SHA-256 manifest;
- canonical Python interpreter path, version and SHA-256;
- read-only CRG environment seal;
- post-seal exact version proof;
- verified macOS sandbox command and profile;
- denied network proof;
- denied write-outside-private-run proof;
- final independent review of this exact planning file.

## Pinned upstream identity

- repository: `tirth8205/code-review-graph`
- version: `2.3.6`
- release commit: `935695f800f2b02e71aae6d463f3df65f0c6493e`
- local environment: `$HOME/.local/share/codexlooper/crg-2.3.6`
- local console command: `$HOME/.local/share/codexlooper/crg-2.3.6/bin/code-review-graph`
- console command SHA-256: `1c0e3e3ad5383069926583667f7c536e8111deddc793189e15d31f34e1d6d604`
- dependency freeze SHA-256: `08f4a3b2a2265df20646078706006232f7d5137160949e0c5e7a4223faa950af`
- Python version used for installation: `3.14.6`

The console-command hash alone is not a sufficient runtime identity. Bootstrap
and preflight must verify the complete sealed environment manifest, canonical
interpreter identity, command identity and exact version output.

## Confirmed upstream behavior

The adapter contract is grounded in original Code Review Graph v2.3.6 source:

- the project script resolves to `code_review_graph.cli:main`;
- `build` accepts `--repo`, `--skip-flows` and `--data-dir`;
- `detect-changes` accepts `--base` and `--repo`, does not accept `--data-dir`,
  and is described as analysis-only against an existing graph;
- `detect-changes` prints the exact text `No changes detected.` when no changed
  files exist;
- `CRG_DATA_DIR` controls graph storage when no private registry entry overrides it;
- `get_data_dir()` creates its selected directory and an inner `.gitignore`;
- the parser defaults to a process executor on macOS and Linux and may select up
  to eight workers;
- `CRG_PARSE_EXECUTOR=thread` and `CRG_PARSE_WORKERS=1` provide the required
  bounded single-worker mode;
- the upstream legacy migration path can rename `.code-review-graph.db` and
  delete legacy WAL, SHM or journal side files at repository root.

Do not copy CRG implementation source into CodexLooper.

## Complete environment identity and seal

Before promotion, create a deterministic manifest outside the CRG environment
covering every directory, regular file and symlink in the isolated environment.
For regular files record:

- canonical relative path;
- file type;
- exact mode;
- byte size;
- SHA-256.

For symlinks record:

- canonical relative path;
- literal link target;
- canonical resolved target;
- whether the target is inside or outside the environment.

Separately record the canonical Python interpreter path, version, mode, size and
SHA-256. Only expected Python launcher symlinks may resolve outside the environment.
Unknown external symlink targets are rejected.

After manifest creation:

- make non-executable regular files read-only;
- make executable regular files read-only and executable;
- make directories read-only and searchable;
- verify that no file can be added, changed or removed by the unprivileged run;
- verify the complete manifest before every CRG invocation;
- reject added, missing, changed or mode-changed entries;
- never let candidate code update the manifest or environment.

Required Python environment controls:

- `PYTHONNOUSERSITE=1`;
- `PYTHONSAFEPATH=1`;
- `PYTHONDONTWRITEBYTECODE=1`.

## Pinned CLI contract

Only these argument-array invocations are authorised:

1. Version:
   `<absolute-crg-command> --version`
2. Private graph build:
   `<absolute-crg-command> build --repo <absolute-project-root> --skip-flows --data-dir <absolute-private-crg-data-dir>`
3. Read-only change analysis:
   `<absolute-crg-command> detect-changes --repo <absolute-project-root> --base <40-hex-run-start-sha>`

Required trimmed version output:
`code-review-graph 2.3.6`

Never invoke `install`, `init`, `serve`, `mcp`, `watch`, `daemon`, `embed`,
`update`, `postprocess`, `refactor`, `uninstall`, `register`, `unregister`,
`repos`, `wiki`, `visualize`, `eval` or any shell command constructed from CRG
output.

Use argument arrays with `shell: false`.

## Isolated child environment

CRG receives only a minimal non-secret environment:

- `HOME=<CODEXLOOPER_RUN_DIR>/crg-home`;
- `CRG_DATA_DIR=<CODEXLOOPER_RUN_DIR>/crg-data`;
- `CRG_REPO_ROOT=<absolute-project-root>`;
- `CRG_PARSE_EXECUTOR=thread`;
- `CRG_PARSE_WORKERS=1`;
- `PYTHONNOUSERSITE=1`;
- `PYTHONSAFEPATH=1`;
- `PYTHONDONTWRITEBYTECODE=1`;
- `DO_NOT_TRACK=1`;
- `NO_COLOR=1`;
- `PATH=/usr/bin:/bin` unless an exact reviewed system path is required;
- bounded locale, temporary-directory and certificate variables only when needed.

Reject inherited conflicting `CRG_*` and `PYTHON*` variables. The CloseRouter
credential, Codex configuration and unrelated user environment must not be
forwarded.

## macOS operating-system sandbox

The authorised macOS path must execute CRG through a verified OS sandbox profile.
The profile must:

- deny network access;
- deny writes outside the private run and private temporary directories;
- allow read-only access to the project checkout;
- allow read-only access to the sealed CRG environment and canonical interpreter;
- allow read-only access to required system libraries and `/usr/bin/git`;
- allow bounded process execution required by CRG and Git;
- preserve process-group timeout and forced termination;
- be stored or generated by immutable Runtime A code;
- be hashed and recorded in the receipt;
- fail closed when the sandbox command, profile or denial probes fail.

An alternative operating-system isolation mechanism requires separate architecture
approval before use.

## Legacy CRG repository-mutation guard

Before every CRG invocation, fail closed if any repository-root path exists:

- `.code-review-graph.db`;
- `.code-review-graph.db-wal`;
- `.code-review-graph.db-shm`;
- `.code-review-graph.db-journal`.

Record Git status and protected-path identities before the command. After every
CRG command verify:

- Git status is unchanged;
- no tracked or untracked repository path was added, removed or modified;
- no legacy database or side file was moved or deleted;
- only the private run and temporary directories changed.

The adapter must never perform or permit legacy CRG migration.

## Normalized adapter result

Every result contains exactly:

- `status`: `disabled`, `available` or `failed`;
- `version`: `null` or exactly `2.3.6`;
- `duration_ms`: non-negative integer;
- `report_path`: `null` or safe project-relative path below the private run
  directory;
- `truncated`: boolean;
- `error_class`: `null` or one of `unsafe_command`, `private_paths`,
  `environment_integrity`, `sandbox_unavailable`, `sandbox_denied`,
  `legacy_repository_state`, `repository_mutation`, `version_mismatch`,
  `timeout`, `non_zero_exit`, `output_limit`, `malformed_json`,
  `projection_invalid`, `internal_error`;
- `advisory`: `null` or the strict projection below.

Required combinations:

- omitted command: `status=disabled`, `version=null`, `error_class=null`,
  `advisory=null`;
- successful trusted version/build/detect: `status=available`, `version=2.3.6`,
  `error_class=null`;
- configured runtime failure after trust checks: `status=failed` with exactly one
  error class and fail-open continuity toward normal Sol review;
- environment, sandbox, path, legacy-state, repository-mutation, executable or
  version trust failure is fail-closed before advisory analysis.

## Strict Sol advisory projection

Raw CRG JSON never enters the Sol prompt. Store a bounded raw report privately,
then project only allowlisted fields:

```json
{
  "base_sha": "40-hex",
  "head_sha": "40-hex",
  "risk_score": 0.0,
  "changed_files": ["safe/project-relative/path"],
  "test_gap_count": 0,
  "review_priorities": [
    {
      "file": "safe/project-relative/path",
      "line": 1,
      "kind": "changed_function"
    }
  ]
}
```

Projection requirements:

- exact known keys only;
- safe project-relative paths with no traversal, NUL or control characters;
- bounded string length, list count and encoded byte size;
- finite numeric risk score within an explicit range;
- non-negative bounded line numbers and test-gap count;
- allowlisted priority kinds only;
- no source snippets, summaries, `_hints`, arbitrary names or unknown fields.

The exact upstream text `No changes detected.` is normalized to a successful
empty projection with risk score zero. Any other non-JSON detect output is
`malformed_json`.

Sol receives a clearly delimited label stating that the projection is untrusted
advisory metadata and that every finding must be verified against repository
source and tests.

## Runtime and branch prerequisites

Runtime A already enforces:

- immutable content-addressed runtime files and manifest verification;
- branch equality before every host mutation and at finalization;
- monotonic ancestry from run-start SHA to final SHA;
- independent model-call, duration and cost budgets;
- candidate code cannot replace the active Sol reviewer.

WP6B must not weaken or bypass those gates.

## CRG build lifecycle

Graph data is private to one run. Cache only by:

`2.3.6 + sealed-environment-manifest-sha256 + run-start-sha + current-head-sha`

Build once per cache key. A trusted-host commit changes `current-head-sha` and
invalidates the graph before the next review advisory.

Enforce deterministic ceilings for:

- version-check duration and output;
- build duration, output and graph storage;
- detect duration and output;
- raw report size;
- projected advisory size;
- CRG builds per run.

Verify that no CRG or Git child process remains after success, timeout or failure.

## Candidate allowed paths

The promoted executable plan may allow only the minimum necessary paths:

- `package.json`;
- `src/code-review-graph.mjs`;
- `src/bootstrap.mjs`;
- `src/run.mjs`;
- `bin/sol-review.mjs`;
- `scripts/bootstrap.mjs`;
- `scripts/install.mjs`;
- `scripts/preflight.mjs`;
- corresponding focused tests;
- `README.md`;
- `docs/ROADMAP.md`;
- `context/project-state.md`;
- `docs/WP6_CODE_REVIEW_GRAPH.md`;
- the promoted active plan itself.

Do not allow runtime directories, Git metadata, user configuration, generated
CRG data or unrelated product files.

## Tasks after promotion

### Task 1: Standalone bounded CRG adapter

Implement complete environment and interpreter verification, executable and path
validation, isolated child environment, OS sandbox launch, legacy-state guard,
bounded process execution, raw private report handling, exact no-change
normalization, strict projection, redaction and focused tests. Do not integrate
with bootstrap, runner or Sol in this task.

- [ ] Task 1 complete.

### Task 2: Original executable plumbing and receipts

Add optional CRG environment, manifest and sandbox identity support to bootstrap,
install and preflight. Record and re-verify the complete sealed environment,
interpreter, command and sandbox profile. Forward only validated identities,
run-start SHA and current trusted HEAD. Add secret-free CRG metadata and budget
state to receipts. Preserve disabled legacy behavior. Do not modify Sol integration
in this task.

- [ ] Task 2 complete.

### Task 3: Fail-open Sol advisory integration

Build or reuse the graph by exact cache key, run detect, create the strict bounded
projection and append only that projection to the immutable Runtime A Sol review
prompt. Preserve normal independent review for every valid CRG runtime failure.
Update focused tests and documentation.

- [ ] Task 3 complete.

## Validation requirements

After every task, the trusted host must run focused syntax/tests plus:

- repository-wide `npm run check`;
- `git diff --check`;
- runtime-integrity verification;
- branch-lock and ancestry verification;
- clean-worktree verification.

Focused tests must include:

- disabled mode;
- exact version success and mismatch;
- console-command, interpreter and full-environment identity success and mismatch;
- added, missing, changed and mode-changed environment entries;
- unexpected external symlink target rejection;
- relative, nonexistent, non-executable and symlink command rejection;
- private-path and symlink-containment rejection;
- missing sandbox and sandbox-profile mismatch;
- denied network and denied outside-write probes;
- exact `CRG_PARSE_EXECUTOR=thread` and `CRG_PARSE_WORKERS=1` child environment;
- legacy database and side-file rejection;
- unchanged repository before and after every CRG command;
- version/build/detect timeout;
- non-zero exit;
- stdout, stderr, report and graph-storage ceilings;
- malformed JSON;
- exact no-change text normalization;
- projection unknown-field, path, count, length and numeric rejection;
- credential redaction and absence from child environment;
- exact argument arrays and `shell: false`;
- cache reuse for identical head and invalidation after trusted commit;
- fail-open Sol continuity after trusted runtime failures;
- fail-closed behavior for trust and repository-mutation failures;
- no remaining CRG or Git process;
- unchanged behavior when CRG is omitted.

## Promotion gate

Promotion into `docs/plans/` requires all of the following:

- complete CRG environment and interpreter seal proof;
- macOS sandbox availability and denial proof;
- independent review of this exact planning file with no blocking finding;
- explicit authorisation to prepare and execute WP6B;
- current PR head has green CI;
- Runtime A evidence remains valid;
- CRG package identity still matches the installation proof;
- promoted copy is exact except for status, executable path-policy metadata and
  task checkboxes required by the plan parser.

## Completion gate

WP6B completes only when:

- immutable Runtime A performs the implementation and independent Sol review;
- all tasks pass focused and repository-wide tests;
- branch, runtime, CRG environment and sandbox identity remain unchanged;
- GitHub CI passes;
- a separate independent diff review reports no blocking finding;
- Runtime B is bootstrapped from the reviewed candidate;
- no live CRG claim is made yet.

Only then may WP6C perform the isolated live CRG smoke.

No push, merge, release, target-product action or model spending is authorised by
this planning document alone.
