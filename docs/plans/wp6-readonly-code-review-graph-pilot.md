# WP6A Read-only Code Review Graph Integration

## Goal

Extend CodexLooper with an optional, local and read-only Code Review Graph context
stage that improves Sol review targeting without weakening the existing sandbox,
path, credential, receipt or independent-review boundaries.

This work package implements and tests the integration. A separate WP6B plan will
perform the first live self-hosted CRG smoke run after CodexLooper has been
re-bootstrapped with the new runner.

## Current facts

- CodexLooper runs Terra as a read-only structured-patch builder and Sol as an independent read-only reviewer through CloseRouter.
- Terra inspects a disposable snapshot and returns one textual unified diff; the trusted host applies the patch, runs validation and creates local commits.
- Ralphex invokes `bin/sol-review.mjs` after the task phase.
- Each run has a private `CODEXLOOPER_RUN_DIR` and a secret-free receipt.
- The currently installed runner does not forward or validate a CRG executable; this implementation run cannot honestly claim a live CRG advisory result.
- The upstream interface is pinned to `tirth8205/code-review-graph` version `2.3.6`, release commit `935695f800f2b02e71aae6d463f3df65f0c6493e`.
- Upstream v2.3.6 documents `detect-changes` as read-only against an existing graph and states that it does not re-parse files.
- The upstream installer subcommand writes MCP configuration, hooks and instruction files. CodexLooper must never invoke it.
- The upstream MCP surface includes write-capable refactoring tools. CodexLooper must expose no CRG MCP tools to Terra or Sol.
- The current host validation path launches `/bin/sh -lc`, which can replace the Node.js 22 PATH with a login-shell Node.js 26 PATH. Task 2 must remove that version drift without weakening command validation.

## Upstream source evidence

The adapter contract is grounded in the original v2.3.6 source, not inferred from names or generated from memory:

- `code_review_graph/__init__.py` at release commit `935695f800f2b02e71aae6d463f3df65f0c6493e` declares `__version__ = "2.3.6"`.
- `code_review_graph/cli.py` at that commit defines `--version` and prints `code-review-graph <version>`.
- The original `build` parser accepts `--repo`, `--skip-flows` and `--data-dir`.
- The original `detect-changes` parser accepts `--base` and `--repo`; without `--brief` it returns the full machine-readable JSON result. It does not accept `--data-dir`.
- `code_review_graph/incremental.py` honors `CRG_REPO_ROOT` for repository resolution and `CRG_DATA_DIR` for graph storage, creating `graph.db` below that directory.
- Package installation is an external human-owned prerequisite: install the exact original package, for example with `pipx install code-review-graph==2.3.6`. Never run the separate `code-review-graph install` integration subcommand.
- Do not copy CRG implementation code into CodexLooper. Invoke the original pinned executable through exact argument arrays and test the boundary.
- Do not invent additional flags, environment variables, output fields or status aliases. If source evidence, installed version or runtime output differs from this contract, fail closed and report the matching normalized failure.

## Pinned CRG CLI contract

Only these executable and argument-array invocations are authorised:

1. Version check:
   - `<absolute-crg-command> --version`
   - Required stdout after trimming: exactly `code-review-graph 2.3.6`.
2. Private graph build:
   - `<absolute-crg-command> build --repo <absolute-project-root> --skip-flows --data-dir <absolute-private-crg-data-dir>`
3. Read-only change analysis:
   - `<absolute-crg-command> detect-changes --repo <absolute-project-root> --base <40-hex-run-start-sha>`
   - Do not pass `--brief`; full JSON output is required for deterministic parsing.

Run CRG with an isolated environment:

- `HOME=<CODEXLOOPER_RUN_DIR>/crg-home`
- `CRG_DATA_DIR=<CODEXLOOPER_RUN_DIR>/crg-data`
- `CRG_REPO_ROOT=<absolute-project-root>`
- `DO_NOT_TRACK=1`
- `NO_COLOR=1`
- preserve only the minimum non-secret variables required for the executable, Python runtime and `/usr/bin/git` discovery.

Never invoke `install`, `init`, `serve`, `mcp`, `watch`, `daemon`, `embed`,
`refactor`, `uninstall`, `register`, `wiki`, `visualize` or a shell command
constructed from CRG output.

## Terra structured-patch contract

- Work on exactly the current Ralphex task. Do not implement later tasks early.
- The Terra session is read-only. Inability to run tests or create fixtures inside the snapshot is expected and MUST NOT cause `TASK_FAILED`.
- Complete a task by statically inspecting exact current file contents and returning one unified diff for that task only.
- The patch must update only the current task checkbox in this active plan. Do not rewrite unrelated plan text.
- Preserve every existing file mode exactly. In particular, `bin/sol-review.mjs` is mode `100644`; do not emit `old mode`, `new mode` or executable-bit changes.
- New source, test and documentation files use regular mode `100644`.
- Build every hunk from exact snapshot content. Do not guess line context or fabricate validation results.
- Terra must not claim tests passed. The trusted host applies the patch and executes every command under `Validation Commands`.
- If host validation fails, the host rejects or rolls back the patch and the next iteration receives the concrete diagnostic.
- Terra must not invoke, simulate or replace the independent Sol review.

## Exact normalized adapter result contract

Do not invent alternate status names or aliases. Every adapter result must contain these keys:

- `status`: exactly one of `disabled`, `available`, `failed`.
- `version`: `null` until the exact pinned version is accepted, otherwise exactly `2.3.6`.
- `duration_ms`: a non-negative integer.
- `report_path`: `null` or a project-relative path below the current private run directory.
- `truncated`: a boolean.
- `error_class`: `null` or exactly one of `unsafe_command`, `private_paths`, `version_mismatch`, `timeout`, `non_zero_exit`, `output_limit`, `malformed_json`, `internal_error`.
- `advisory`: `null` or one bounded, secret-free JSON-compatible value parsed from detect output.

Required combinations:

- No configured command: `status=disabled`, `error_class=null`, `version=null`, `advisory=null`.
- Successful version, build and detect: `status=available`, `error_class=null`, `version=2.3.6`.
- Any configured failure: `status=failed` with exactly one matching `error_class`; do not return `ok`, `unavailable`, `wrong_version` or any other synonym.
- `private_paths` is reserved for a real project/run-directory containment or symlink failure. It must not mask version, timeout, process, output or JSON cases whose fixtures satisfy the private path contract.

## Test-fixture contract for Task 1

### Real executable fixture

- Path validation is part of the production security boundary and must not be bypassed by ordinary success, version, timeout, exit, output or JSON tests.
- For every test that expects execution to reach the version, build or detect stage, create a real temporary regular file at an absolute path and set mode `0o700` before calling the adapter.
- The executable fixture must not be a symlink and must remain present until the awaited test callback completes.
- A fixture helper must be async-safe: return or await the callback result, and perform cleanup only in `finally` after the callback has completed.
- Use the same valid executable fixture for version mismatch, timeout, non-zero exit, excessive output, malformed JSON and redaction cases.
- Test relative, nonexistent, non-executable and symlink paths separately as `unsafe_command` cases.
- If execution is dependency-injected, filesystem validation must still observe the real fixture path. A mocked process result must not turn a valid executable into `unsafe_command`.

### Exact private runtime tree

For every test other than an intentional `private_paths` negative case, create and pass this real containment structure:

- `<temp-root>/project` as the real absolute `projectRoot`.
- `<projectRoot>/.codexlooper/runs/test-run` as the real absolute `runDirectory`.
- Every directory from `projectRoot` through `test-run` must be a real non-symlink directory with mode `0o700`.
- Place the executable at `<temp-root>/bin/code-review-graph`, as a real regular non-symlink file with mode `0o700`.
- Pass `realpathSync(projectRoot)`, `realpathSync(runDirectory)` and `realpathSync(command)` to the adapter.
- Use the fixed valid run-start SHA `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.
- Allow production code to create only `crg-home`, `crg-data` and bounded report files below `runDirectory`.
- Assert `HOME=<runDirectory>/crg-home`, `CRG_DATA_DIR=<runDirectory>/crg-data` and `CRG_REPO_ROOT=<projectRoot>` in spawned environments.
- Test `private_paths` separately with an outside run directory or a symlinked containment segment. Do not reuse that invalid tree for version or execution tests.

### Exact mocked process contract

- A successful mock result has `status: 0`, string `stdout`, string `stderr`, no truthy `error`, and no terminating signal.
- Version success stdout is exactly `code-review-graph 2.3.6\n`.
- Build success may use empty stdout and stderr.
- Detect success stdout must be valid JSON, for example `{"summary":"bounded advisory"}\n`.
- Mock queues must match invocation order. A successful full analysis consumes exactly three results: version, build, detect.
- A version-mismatch case consumes one status-0 version result with a non-`2.3.6` version and stops before build.
- A build timeout consumes a successful version result followed by a build result with an `ETIMEDOUT` error and stops before detect.
- A build non-zero case consumes a successful version result followed by a non-zero build result and stops before detect.
- Detect malformed-JSON, redaction and output-bound cases consume successful version and build results followed by the relevant detect result.
- The injected fake must record the executable, exact argument array, cwd and environment for every call, fail when its queue is exhausted, and allow an assertion that no queued result remains.

## Safety boundary

- CRG is optional and disabled unless the bootstrap receives one exact absolute executable path through `--crg-command` and the installed runner records it as `CODEXLOOPER_CRG_COMMAND`.
- Reject relative paths, shell fragments, NUL bytes, non-files, symlinks and non-executable files without invoking them.
- Do not modify `~/.codex`, global MCP configuration, editor configuration, user hooks or the real user home.
- Do not enable MCP access for Terra or Sol.
- Do not use embeddings, cloud providers, network access or external telemetry.
- CRG may read the current Git worktree and write only below the private CodexLooper run directory.
- CRG output is untrusted advisory context. Sol must independently verify every finding against source and tests.
- Missing, unsupported, timed-out, malformed or non-zero CRG execution must not suppress or replace the normal Sol review.
- CRG output must never contain the CloseRouter credential and must be bounded before prompt or receipt inclusion.
- No push, merge, release, publication or target-product action is authorised.

## Design requirements

- Add a small host-side adapter for executable and version validation, isolated environment creation, bounded execution, redaction and normalized metadata.
- Use argument arrays and `shell: false`; never concatenate a command line.
- Add a deterministic timeout and separate stdout/stderr ceilings.
- Treat CRG as an original external executable like Codex, MEX and Ralphex: add optional `--crg-command` plumbing to bootstrap, install and preflight, require an absolute non-symlink executable, and pin the exact version.
- Pass the validated CRG executable and run-start Git SHA from `src/run.mjs` into the controlled Ralphex environment only when configured.
- Store graph data, bounded analysis and normalized metadata only inside `CODEXLOOPER_RUN_DIR`.
- Append a clearly delimited bounded advisory summary to the Sol prompt immediately before reviewer launch.
- Label the summary as untrusted advisory data that Sol must verify independently.
- Record only status, version, duration, relative report path, truncation state and error class in the secret-free receipt.
- Preserve existing behavior when CRG is not configured.
- Do not add CRG as an npm dependency and do not vendor its source.
- Defer the first live CRG proof to WP6B after re-bootstrap under Node.js 22 with the validated original v2.3.6 executable.

## Allowed paths

- `package.json`
- `src/code-review-graph.mjs`
- `src/bootstrap.mjs`
- `src/run.mjs`
- `src/git-supervisor.mjs`
- `bin/sol-review.mjs`
- `scripts/bootstrap.mjs`
- `scripts/install.mjs`
- `scripts/preflight.mjs`
- `tests/code-review-graph.test.mjs`
- `tests/bootstrap.test.mjs`
- `tests/git-supervisor.test.mjs`
- `tests/install.test.mjs`
- `tests/run.test.mjs`
- `tests/sol-review.test.mjs`
- `README.md`
- `docs/ROADMAP.md`
- `context/project-state.md`
- `docs/WP6_CODE_REVIEW_GRAPH.md`
- `docs/plans/wp6-readonly-code-review-graph-pilot.md`

## Validation Commands

These commands are intentionally safe after every intermediate task.

- `test ! -e src/code-review-graph.mjs || node --check src/code-review-graph.mjs`
- `node --check src/bootstrap.mjs && node --check src/run.mjs && node --check src/git-supervisor.mjs && node --check bin/sol-review.mjs && node --check scripts/bootstrap.mjs && node --check scripts/install.mjs && node --check scripts/preflight.mjs`
- `test ! -e tests/code-review-graph.test.mjs || node --test tests/code-review-graph.test.mjs`
- `test ! -e tests/git-supervisor.test.mjs || node --test tests/git-supervisor.test.mjs`
- `node --test tests/bootstrap.test.mjs tests/install.test.mjs tests/run.test.mjs tests/sol-review.test.mjs`
- `npm run check`
- `git diff --check`

## Tasks

### Task 1: Add the bounded standalone CRG adapter

Implement only the standalone adapter layer and its direct tests. Add `src/code-review-graph.mjs`, add `tests/code-review-graph.test.mjs`, and update `package.json` only so the repository-wide check includes the new source. Follow every upstream-evidence, exact normalized-result, executable-fixture, private-runtime-tree and mocked-process rule above. Cover disabled mode, exact v2.3.6 acceptance, wrong version, unsafe path, private path rejection, symlink rejection, timeout, non-zero exit, excessive stdout/stderr, malformed JSON, credential redaction, private data paths and exact argument arrays. Do not integrate the adapter into bootstrap, the runner or Sol yet.

- [ ] Return the exact Task 1 unified diff and mark only this checkbox complete.

### Task 2: Integrate the original executable into bootstrap, runner, validation and receipts

Add optional `--crg-command` support to `src/bootstrap.mjs`, `scripts/bootstrap.mjs`, `scripts/install.mjs` and `scripts/preflight.mjs`. Validate an exact absolute regular non-symlink executable, require original version `2.3.6`, preserve disabled legacy behavior when omitted, and record no user-home or MCP changes. Integrate the adapter contract into `src/run.mjs`; forward the validated executable only as `CODEXLOOPER_CRG_COMMAND`, forward the exact run-start SHA under a dedicated controlled variable, and expose only secret-free normalized receipt metadata. Fix host validation so it executes with the runner's inherited Node.js 22 PATH rather than replacing it through a login shell; do not weaken the validation command allowlist or environment filtering. Modify `src/git-supervisor.mjs` and extend the bootstrap, install, preflight, run and Git supervisor tests. Do not modify `bin/sol-review.mjs` in this task.

- [ ] Return the exact Task 2 unified diff and mark only this checkbox complete.

### Task 3: Add fail-open Sol advisory context and documentation

Integrate the bounded adapter result into `bin/sol-review.mjs` without changing its tracked mode `100644`. Build graph data only below the private run directory, run the read-only JSON analysis against the run-start SHA, append only bounded untrusted advisory context, and preserve the normal Sol review on every CRG failure class. Extend `tests/sol-review.test.mjs` and update the allowed documentation files. Explicitly prohibit every CRG integration-subcommand path and document that live proof is deferred to WP6B.

- [ ] Return the exact Task 3 unified diff and mark only this checkbox complete.

## Acceptance criteria enforced by the trusted host and Ralphex

These criteria are not prerequisites for Terra inside its read-only snapshot. The host and later review phase enforce them.

- Every task patch changes only allowed paths, preserves file modes and passes all validation commands.
- Ralphex performs the independent review after the final task commit.
- A normal CodexLooper run behaves as before when CRG is not configured.
- Configured CRG contributes only bounded local read-only advisory context to Sol.
- The adapter and bootstrap accept only the original pinned v2.3.6 executable and command contract.
- Terra and Sol receive no new MCP or write-capable tool.
- No global user, editor, Codex or hook configuration is modified.
- No network, embedding or cloud-provider path is enabled during CRG execution.
- CRG failure cannot suppress or replace the independent Sol review.
- Reports and receipt metadata are secret-free and remain inside private runtime storage.
- Tests prove fail-open review continuity and fail-closed executable, version and path handling.
- Host validation uses the same Node.js 22 toolchain as the installed CodexLooper runner.
- `npm run check` and `git diff --check` pass.
- Terra and Sol usage are recorded for this implementation run; live CRG proof is deferred to WP6B.
