# WP6B Read-only Code Review Graph Integration

Status: **READY FOR FINAL PLAN REVIEW — NOT EXECUTABLE**

WP6A Loop Trust Hardening and the authorised macOS Runtime A proof are complete.
The original Code Review Graph v2.3.6 executable is installed and its local
identity is recorded in:

`docs/architecture/WP6B_CRG_LOCAL_INSTALL_PROOF.md`

This specification intentionally remains outside `docs/plans/`. It must not be
promoted or executed until explicit WP6B execution authorisation is given and a
separate independent plan review reports no blocking finding.

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
- CRG version output: `code-review-graph 2.3.6`.
- CRG command is a regular, executable, non-symlink file: PASS.
- Model calls during installation proof: `0`.
- CRG graph builds during installation proof: `0`.
- `code-review-graph install` used: `false`.

## Pinned upstream identity

- repository: `tirth8205/code-review-graph`
- version: `2.3.6`
- release commit: `935695f800f2b02e71aae6d463f3df65f0c6493e`
- local environment: `$HOME/.local/share/codexlooper/crg-2.3.6`
- local command: `$HOME/.local/share/codexlooper/crg-2.3.6/bin/code-review-graph`
- command SHA-256: `1c0e3e3ad5383069926583667f7c536e8111deddc793189e15d31f34e1d6d604`
- dependency freeze SHA-256: `08f4a3b2a2265df20646078706006232f7d5137160949e0c5e7a4223faa950af`
- Python used for the local installation proof: `3.14.6`

The adapter must re-check the command path, canonical path, mode, executable
identity, SHA-256 and exact version output during bootstrap and preflight. The
proof values are evidence, not permission to skip runtime verification.

## Upstream source evidence

The adapter contract is grounded in original Code Review Graph v2.3.6 source:

- `code_review_graph/__init__.py` declares `__version__ = "2.3.6"`;
- `code_review_graph/cli.py` prints `code-review-graph <version>` for `--version`;
- `build` accepts `--repo`, `--skip-flows` and `--data-dir`;
- `detect-changes` accepts `--base` and `--repo`, does not accept `--data-dir`,
  and prints full JSON when changes exist and `--brief` is absent;
- `detect-changes` prints the exact text `No changes detected.` when no changed
  files exist;
- `CRG_REPO_ROOT` controls repository resolution;
- `CRG_DATA_DIR` controls graph storage and contains `graph.db`.

Do not copy CRG implementation source into CodexLooper.

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
`refactor`, `uninstall`, `register`, `wiki`, `visualize` or any shell command
constructed from CRG output.

Use argument arrays with `shell: false`.

## Isolated environment

CRG receives only a minimal non-secret environment required by its pinned Python
runtime and `/usr/bin/git`:

- `HOME=<CODEXLOOPER_RUN_DIR>/crg-home`;
- `CRG_DATA_DIR=<CODEXLOOPER_RUN_DIR>/crg-data`;
- `CRG_REPO_ROOT=<absolute-project-root>`;
- `DO_NOT_TRACK=1`;
- `NO_COLOR=1`;
- bounded locale, temporary-directory, certificate and PATH variables as needed.

The CloseRouter credential, Codex configuration and unrelated user environment
must not be forwarded.

## Normalized adapter result

Every result contains exactly:

- `status`: `disabled`, `available` or `failed`;
- `version`: `null` or exactly `2.3.6`;
- `duration_ms`: non-negative integer;
- `report_path`: `null` or safe project-relative path below the private run
  directory;
- `truncated`: boolean;
- `error_class`: `null` or one of `unsafe_command`, `private_paths`,
  `version_mismatch`, `timeout`, `non_zero_exit`, `output_limit`,
  `malformed_json`, `projection_invalid`, `internal_error`;
- `advisory`: `null` or the strict projection below.

Required combinations:

- omitted command: `status=disabled`, `version=null`, `error_class=null`,
  `advisory=null`;
- successful version/build/detect: `status=available`, `version=2.3.6`,
  `error_class=null`;
- configured failure: `status=failed` with exactly one error class;
- unsafe command, version mismatch, runtime-integrity failure or private-path
  failure is fail-closed before analysis;
- a valid configured CRG runtime failure is fail-open for Sol review and is
  recorded without advisory data.

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

`2.3.6 + run-start-sha + current-head-sha`

Build once per cache key. A trusted-host commit changes `current-head-sha` and
invalidates the graph before the next review advisory.

Enforce deterministic ceilings for:

- version check duration and output;
- build duration, stdout, stderr and graph storage;
- detect duration and output;
- raw report size;
- projected advisory size;
- CRG builds per run.

Verify that no CRG child process remains after success, timeout or failure.

## Executable and path validation

The configured CRG path must be:

- absolute;
- a real regular file;
- non-symlink;
- executable by the current user;
- unchanged from bootstrap/preflight identity;
- SHA-256 exact when a pinned local identity is configured;
- version-exact.

Every directory from project root through the run directory and CRG data paths
must be real, contained and non-symlink. CRG may write only below the private run
directory.

## Terra task contract after promotion

- Work on exactly the current task.
- Return one structured unified diff only.
- Preserve existing file modes.
- Change only allowed paths.
- Do not fabricate validation results.
- Do not invoke or simulate Sol.
- Do not modify immutable Runtime A.
- Mark only the current task checkbox complete.

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

Implement executable/version/path validation, isolated environment creation,
bounded process execution, raw private report handling, exact no-change
normalization, strict projection, redaction and direct tests. Do not integrate
with bootstrap, runner or Sol in this task.

- [ ] Task 1 complete.

### Task 2: Original executable plumbing and receipts

Add optional `--crg-command` support to bootstrap, install and preflight. Record
and re-verify the original executable identity. Forward the validated executable,
run-start SHA and current trusted head through controlled variables. Add CRG
metadata and budget state to secret-free receipts. Preserve disabled legacy
behavior. Do not modify Sol integration in this task.

- [ ] Task 2 complete.

### Task 3: Fail-open Sol advisory integration

Build or reuse the graph by exact cache key, run detect, create the strict bounded
projection and append only that projection to the immutable Runtime A Sol review
prompt. Preserve the normal independent review for every valid CRG runtime
failure. Update focused tests and documentation.

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
- relative, nonexistent, non-executable and symlink command rejection;
- command SHA-256 identity success and mismatch;
- private-path and symlink containment rejection;
- version/build/detect timeout;
- non-zero exit;
- stdout, stderr, report and graph-storage ceilings;
- malformed JSON;
- exact no-change text normalization;
- projection unknown-field, path, count, length and numeric rejection;
- credential redaction and absence from child environment;
- exact argument arrays and `shell: false`;
- cache reuse for identical head and invalidation after trusted commit;
- fail-open Sol continuity;
- no remaining CRG process;
- unchanged behavior when CRG is omitted.

## Promotion gate

Promotion into `docs/plans/` requires all of the following:

- explicit authorisation to prepare and execute WP6B;
- independent review of this exact planning file;
- no blocking plan finding;
- current PR head has green CI;
- Runtime A evidence remains valid;
- CRG local install identity still matches the proof;
- promoted copy is exact except for status, executable path-policy metadata and
  task checkboxes required by the plan parser.

## Completion gate

WP6B completes only when:

- immutable Runtime A performs the implementation and independent Sol review;
- all tasks pass focused and repository-wide tests;
- branch and runtime identity remain unchanged through the run;
- GitHub CI passes;
- a separate independent diff review reports no blocking finding;
- Runtime B is bootstrapped from the reviewed candidate;
- no live CRG claim is made yet.

Only then may WP6C perform the isolated live CRG smoke.

No push, merge, release, target-product action or model spending is authorised by
this planning document alone.
