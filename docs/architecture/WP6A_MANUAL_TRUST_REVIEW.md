# WP6A Manual Trust-Boundary Review

Review date: 2026-07-22

Review mode: manual static and test-evidence review performed outside the
CodexLooper/Ralphex/Terra/Sol execution loop. No paid model call, CRG build,
merge, release or live smoke was used.

Reviewed code candidate before this evidence-only commit:
`a05e9fc7f5fc89d2348362942d5fb0514d7fa5a4`.

## Scope

The review covered the trust-sensitive implementation in:

- `scripts/install.mjs`;
- `scripts/preflight.mjs`;
- `scripts/run.mjs`;
- `scripts/vcs-guard.mjs`;
- `bin/codex-runtime.mjs`;
- `bin/terra-runtime.mjs`;
- `bin/sol-runtime.mjs`;
- `src/runtime-integrity.mjs`;
- `src/runtime-paths.mjs`;
- `src/git-authority.mjs`;
- `src/git-supervisor.mjs`;
- `src/run-budget.mjs`;
- `src/run-policy.mjs`;
- `src/run-hardened.mjs`;
- the related deterministic tests and real Ralphex v1.6.0 offline fixture.

## Findings closed during review

### 1. Validation commands were too permissive

The original policy accepted arbitrary single-line shell commands and the host
executed them through `/bin/sh -c`.

Resolution:

- plans now accept only exact non-executing validation forms:
  - `git diff --check`;
  - `node --check <plan-approved JavaScript file>`;
  - bounded `test -d`, `test -e`, `test -f` or `test -s` predicates;
- shell syntax, quoting, redirects, pipes, command substitution, arbitrary
  scripts, `npm`, `node --test`, destructive Git commands and paths outside the
  plan policy are rejected while the plan is parsed;
- deterministic negative tests cover representative bypass attempts.

Status: **CLOSED**.

### 2. Installer directory creation could traverse prepared symlinks

The runtime was content-addressed, but the installation roots were previously
created recursively before all path segments were proven to be real private
directories.

Resolution:

- `.codexlooper`, `.codexlooper/runtime`, `.codexlooper/bin`,
  `.codexlooper/codex-home` and `.ralphex` are now checked and created one
  segment at a time;
- symlinked or non-directory segments fail closed;
- atomic installer writes require a canonical verified parent;
- regression tests cover symlinked `.codexlooper` and `.ralphex` roots.

Status: **CLOSED**.

### 3. Ambient worker flag could bypass the outer hard timeout

A pre-existing internal worker environment flag could select the worker path
without starting the process-group supervisor.

Resolution:

- every supervised start generates a random 192-bit worker token;
- worker authorization also requires the recorded parent PID to equal the
  actual parent PID;
- inherited or stale environment flags no longer select the worker path;
- the existing stubborn-child test continues to prove the SIGTERM/SIGKILL
  process-group bound.

Status: **CLOSED**.

### 4. Install state omitted the explicit branch policy

Runtime, tool and budget evidence existed, but the branch authority contract
was not written explicitly into `install-state.json`.

Resolution:

The install state now records:

- lock the current branch at run start;
- require the exact repository root;
- reject detached HEAD;
- require the run-start SHA to remain an ancestor;
- reject Ralphex branch mutation.

A deterministic installer test verifies the exact policy object.

Status: **CLOSED**.

## Trust-boundary checks

### Immutable runtime

- active wrappers reference only files below the content-addressed runtime;
- runtime file hashes, modes, directory modes, manifest hash, runtime ID,
  Node executable and external executable hashes are verified;
- Git-authority checks re-verify the configured runtime before host mutation
  boundaries;
- runtime tampering fails before model execution.

Result: **PASS**.

### Git authority

- branch, repository root and run-start SHA are captured before execution;
- detached HEAD, branch drift and rewritten ancestry fail closed;
- the VCS adapter blocks Ralphex checkout, switch, reset, merge, rebase,
  cherry-pick, revert and branch mutation;
- host-controlled patch, validation, commit and plan-archive boundaries repeat
  authority checks.

Result: **PASS**.

### Paid-call and duration budgets

- builder and reviewer attempts are reserved before invocation;
- missing private budget state blocks a paid call;
- reserved and actual estimated cost are monotonic and bounded;
- the outer worker enforces the total duration with process-group SIGTERM and
  SIGKILL fallback;
- CRG build allowance remains zero.

Result: **PASS**.

### Receipt and secret handling

- install state and receipts contain runtime, tool, branch and budget evidence;
- CloseRouter credentials and unrelated API/token variables are not persisted;
- full model messages and private reasoning are not stored in receipts.

Result: **PASS**.

### CRG activation boundary

- the CRG specification remains under `docs/planning/`;
- no executable CRG plan exists under `docs/plans/`;
- no CRG installer, MCP integration, hook, embedding, cloud service or live run
  was activated.

Result: **PASS**.

## CI evidence

Before this evidence-only commit, GitHub Actions run `29931558755` completed
successfully for candidate `624d7810196d74b5f6339f0ee72672725c78f46a`:

- Node.js 20 static checks and tests: PASS;
- Node.js 22 static checks and tests: PASS;
- real Ralphex v1.6.0 offline E2E: PASS;
- diff hygiene: PASS;
- paid live-smoke steps: correctly skipped.

A final CI run is still required for the final evidence commit.

## Verdict

**WP6A CODE REVIEW: PASS**

No blocking code-level trust-boundary finding remains in the reviewed
candidate. The final completion gate is the model-free local macOS Runtime A
proof from the final reviewed branch head:

```sh
npm run prove:runtime-a
```

The proof must report both `branch_drift_rejected: true` and
`runtime_tamper_rejected: true`. CRG promotion remains prohibited until that
local proof is recorded and the final branch head has green CI.
