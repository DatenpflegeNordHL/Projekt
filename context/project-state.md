# Project State

## Working

- WP0 is complete and merged at `8e3b589a09bd2935dea19ce94b36e18cc2482d83`.
- Ralphex integration is verified from source and end to end.
- MEX preflight, controlled CloseRouter launchers and isolated runtime state exist.
- Terra is the implementation and fix model.
- Sol is a separate read-only reviewer.
- Real CloseRouter identity and Codex CLI Responses smoke passed for both models.
- Nested executable plans are rejected and completed-plan filename collisions are blocked.
- Rejected Terra builder patches are retained privately for diagnostics.
- The current complete local regression result is 212 tests passed, 0 failed.
- WP6A Loop Trust Hardening is complete.
- The original CRG v2.3.6 package is installed and locally proven without graph or model execution.
- Current `main`: `922bf2e0d3c66b647cfa71d4e3955084eb3a6240`.

## WP8 Phase A merged and complete

- The deterministic offline benchmark-fixture harness is complete at
  implementation commit `0a94275`.
- PR #17 merged it to `main` at
  `922bf2e0d3c66b647cfa71d4e3955084eb3a6240`.
- Final independent review verdict: **PASS**; no P0, P1, or P2 findings.
- Benchmark tests: 25 passed, 0 failed. Full suite: 212 passed, 0 failed.
- CRG review coverage was `PARTIAL` because its graph did not fully include the
  then-unversioned WP8 files; the final review directly inspected the relevant
  implementation and test files.
- Phase A is an offline fixture validator only. Its Node-VM boundary is not an
  operating-system sandbox; it makes no model calls, has no production agent
  runner, produces no real benchmark results, and does not prove
  production-like leakage safety. These are expected limits, not open findings.
- The only authorised next WP8 work is Phase-B inventory and creation of a
  versioned plan for the isolated real-run runner. Phase B has not been
  implemented.

## Core CLI status

- WP1 through WP5 are complete; see `docs/ROADMAP.md` for accepted evidence.
- One tracked direct Markdown plan under `docs/plans/` is accepted per run.
- Design-stage, review-stage and blocked plans remain outside `docs/plans/`.
- The generated `codexlooper` command performs preflight and starts Ralphex.
- Codex `turn.completed` events are recorded as secret-free usage telemetry.
- Terra and Sol usage is separated and priced from the verified CloseRouter snapshot.
- Every run writes an atomic receipt with Git heads, commits, completion gates, tokens and estimated cost.
- A run is blocked unless the plan is completed, the worktree is clean, at least one commit exists and both Terra and Sol usage are present.

## WP6A completed trust root

The active runtime is content-addressed, copied outside the mutable source path for the run, sealed read-only and verified by SHA-256 manifest before model calls and host mutation boundaries.

The runner enforces:

- exact repository-root and branch authority;
- monotonic ancestry from the run-start SHA;
- immutable Terra, Sol, runner and Git-supervisor code for the active run;
- builder, reviewer, duration and estimated-cost budgets;
- process-group timeout with SIGTERM and SIGKILL fallback;
- a non-arbitrary validation allowlist;
- host-controlled plan archival;
- symlink-safe private installation roots.

The controlling invariant document is:
`docs/architecture/CODEXLOOPER_LOOP_TRUST_INVARIANTS.md`

Independent review evidence is recorded in:
`docs/architecture/WP6A_MANUAL_TRUST_REVIEW.md`

The authorised macOS Runtime A proof is recorded in:
`docs/architecture/WP6A_RUNTIME_A_LOCAL_PROOF.md`

## Runtime A proof

- source commit: `9c3798b15c5f794c0742d166f8ffead8da8acaf0`;
- platform: macOS arm64;
- local regression: 68 passed, 0 failed;
- real MEX scaffold initialised through bootstrap;
- immutable wrapper paths verified;
- preflight passed;
- branch drift rejected;
- runtime tampering rejected;
- paid model calls: 0;
- CRG builds: 0.

## CRG local install proof

Evidence is recorded in:
`docs/architecture/WP6B_CRG_LOCAL_INSTALL_PROOF.md`

- original repository: `tirth8205/code-review-graph`;
- approved version: `2.3.6`;
- release commit: `935695f800f2b02e71aae6d463f3df65f0c6493e`;
- isolated environment: `$HOME/.local/share/codexlooper/crg-2.3.6`;
- exact CLI output: `code-review-graph 2.3.6`;
- command SHA-256: `1c0e3e3ad5383069926583667f7c536e8111deddc793189e15d31f34e1d6d604`;
- dependency freeze SHA-256: `08f4a3b2a2265df20646078706006232f7d5137160949e0c5e7a4223faa950af`;
- graph builds: 0;
- model calls: 0;
- separate `code-review-graph install` subcommand used: false.

## Historical WP6B planning review

Evidence is recorded in:
`docs/architecture/WP6B_INDEPENDENT_PLAN_REVIEW.md`

This records the planning constraints that preceded the merged optional,
advisory CRG context in PR #7. It is historical evidence, not the current
execution sequence.

The exact upstream source review found four blocking gaps before promotion:

1. the console-script hash does not cover the Python interpreter, package or dependencies;
2. CRG defaults to process-based parser fan-out with up to eight workers;
3. legacy repository-root CRG database files may be moved or deleted by upstream code;
4. a minimal child environment does not provide OS-enforced network and write isolation.

The planning specification now requires:

- complete isolated-environment and interpreter manifest verification;
- a read-only CRG environment seal;
- `CRG_PARSE_EXECUTOR=thread` and `CRG_PARSE_WORKERS=1`;
- fail-closed legacy database guards and unchanged-repository proof;
- a verified macOS sandbox denying network and writes outside private run paths.

## Current gate

WP8 Phase A is merged and complete.

The only authorised next work is the Phase-B inventory and creation of a
versioned plan for the isolated real-run runner. No Phase-B implementation,
real model benchmark run, Phase C work, or later roadmap priority has begun.

Implementation may start only after an independent Phase-B plan review returns
PASS.

## Current CRG boundary

The merged CRG context remains optional, advisory, and default-disabled. It
does not replace Sol's independent review, and no general live-CRG or
operating-system-sandbox claim is made. Mandatory CRG use is not part of the
current roadmap focus.
