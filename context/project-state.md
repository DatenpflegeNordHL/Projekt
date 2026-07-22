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

## Core CLI status

- WP1 through WP5 are complete; see `docs/ROADMAP.md` for accepted evidence.
- One tracked direct Markdown plan under `docs/plans/` is accepted per run.
- Design-stage and blocked plans remain outside `docs/plans/`.
- The generated `codexlooper` command performs preflight and starts Ralphex.
- Codex `turn.completed` events are recorded as secret-free usage telemetry.
- Terra and Sol usage is separated and priced from the verified CloseRouter snapshot.
- Every run writes an atomic receipt with Git heads, commits, completion gates, tokens and estimated cost.
- A run is blocked unless the plan is completed, the worktree is clean, at least one commit exists and both Terra and Sol usage are present.

## WP6A completed trust root

The active runtime is now content-addressed, copied outside the mutable source path for the run, sealed read-only and verified by SHA-256 manifest before model calls and host mutation boundaries.

The runner now enforces:

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

## Fixed next sequence

1. **WP6B Read-only CRG Integration**
   - specification remains at
     `docs/planning/WP6B_READONLY_CODE_REVIEW_GRAPH_INTEGRATION.md`;
   - WP6A prerequisites are now satisfied;
   - install the original CRG v2.3.6 executable in an isolated environment;
   - review and promote an exact bounded copy to `docs/plans/` only under explicit execution authorisation;
   - execute with immutable Runtime A;
   - keep CRG advisory-only and fail-open toward the independent Sol review.
2. **WP6C Isolated Live CRG Smoke**
   - bootstrap Runtime B from the reviewed WP6B candidate;
   - prove success, no-change, fail-open, branch-lock, runtime-tamper and secret-leak cases in a fixture repository.
3. Obtain explicit merge authorisation, merge, then bootstrap Runtime C from `main`.

No step may be skipped or reordered because a later test passes.

## CRG baseline

- original repository: `tirth8205/code-review-graph`;
- approved version: `2.3.6`;
- release commit: `935695f800f2b02e71aae6d463f3df65f0c6493e`;
- install the original package in an isolated environment;
- never run the separate `code-review-graph install` integration subcommand;
- never expose CRG MCP or write-capable tools to Terra or Sol;
- never pass raw CRG output directly into the Sol prompt.

## Remaining external setup

- Rename the GitHub repository from `Projekt` to `codexlooper` when convenient.
- Install the exact original CRG v2.3.6 executable before WP6B promotion.
- Store the local CloseRouter credential securely before a local paid model run.

## Next use gate

WP6A is complete. WP6B may now be prepared from the reviewed planning specification, but it must remain non-executable until explicit authorisation is given to promote and run it. PR 7 remains Draft and must not be merged or released without separate authorisation.
