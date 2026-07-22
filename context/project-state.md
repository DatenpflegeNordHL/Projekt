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
- The current complete local regression result is 68 tests passed, 0 failed.
- WP6A Loop Trust Hardening is complete.
- The original CRG v2.3.6 executable is installed and locally proven without graph or model execution.

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
- command regular, executable and non-symlink: PASS;
- graph builds: 0;
- model calls: 0;
- separate `code-review-graph install` subcommand used: false.

## Fixed next sequence

1. **WP6B final plan review**
   - canonical specification remains at
     `docs/planning/WP6B_READONLY_CODE_REVIEW_GRAPH_INTEGRATION.md`;
   - WP6A and original-executable prerequisites are satisfied;
   - perform an independent review of the exact planning file;
   - keep the plan non-executable until explicit WP6B execution authorisation.
2. **WP6B implementation under Runtime A**
   - after explicit authorisation, promote the reviewed bounded copy to `docs/plans/`;
   - implement the standalone adapter, original executable plumbing and advisory-only Sol integration;
   - keep CRG fail-open toward the independent Sol review;
   - pass focused tests, repository-wide tests, CI and independent diff review;
   - bootstrap Runtime B from the reviewed candidate.
3. **WP6C isolated live CRG smoke**
   - prove success, no-change, fail-open, branch-lock, runtime-tamper and secret-leak cases in a fixture repository.
4. Obtain explicit merge authorisation, merge, then bootstrap Runtime C from `main`.

No step may be skipped or reordered because a later test passes.

## CRG baseline

- never run the separate `code-review-graph install` integration subcommand;
- never expose CRG MCP or write-capable tools to Terra or Sol;
- never pass raw CRG output directly into the Sol prompt;
- re-check command path, SHA-256 and exact version during bootstrap and preflight;
- keep graph data private to one run;
- no real CRG graph build before WP6C.

## Remaining external setup

- Rename the GitHub repository from `Projekt` to `codexlooper` when convenient.
- Store the local CloseRouter credential securely before an authorised paid model run.

## Next use gate

WP6A and the original CRG installation prerequisite are complete. The immediate next action is independent review of the exact WP6B planning specification. Promotion into `docs/plans/`, Runtime A execution, model spending, CRG graph building, PR merge and release remain blocked until their stated authorisation gates are satisfied.
