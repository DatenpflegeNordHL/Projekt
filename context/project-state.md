# Project State

## Working

- WP0 is complete and merged at `8e3b589a09bd2935dea19ce94b36e18cc2482d83`.
- Ralphex v1.6.0 integration is verified from source and end to end.
- MEX preflight, controlled CloseRouter launchers and isolated runtime state exist.
- Terra is the implementation and fix model.
- Sol is a separate read-only reviewer.
- Real CloseRouter identity and Codex CLI Responses smoke passed for both models.
- Node.js 20 and 22 CI pass on the accepted core baseline.
- The repository secret `CLOSEROUTER_API_KEY` is configured for GitHub workflows.
- Nested executable plans are rejected and completed-plan filename collisions are blocked.
- Rejected Terra builder patches are retained privately for diagnostics.
- The current complete local regression result is 49 tests passed, 0 failed.

## Core CLI status

- WP1 through WP5 are complete; see `docs/ROADMAP.md` for accepted evidence.
- One tracked direct Markdown plan under `docs/plans/` is accepted per run.
- Design-stage and blocked plans remain outside `docs/plans/`.
- The generated `codexlooper` command performs preflight and starts Ralphex.
- Codex `turn.completed` events are recorded as secret-free usage telemetry.
- Terra and Sol usage is separated and priced from the verified CloseRouter snapshot.
- Every run writes an atomic receipt with Git heads, commits, completion gates, tokens and estimated cost.
- A run is blocked unless the plan is completed, the worktree is clean, at least one commit exists and both Terra and Sol usage are present.

## Active blocker: mutable trust root

The current generated wrappers still execute mutable CodexLooper source files
from the same repository being changed. Therefore the current autonomous loop
must not modify and approve its own runner, Terra adapter, Sol reviewer or Git
supervisor.

The controlling invariant document is:
`docs/architecture/CODEXLOOPER_LOOP_TRUST_INVARIANTS.md`

## Fixed next sequence

1. **WP6A Loop Trust Hardening**
   - implement outside the current autonomous loop;
   - install a content-addressed immutable runtime;
   - add runtime manifest verification;
   - add branch lock and monotonic ancestry checks;
   - add builder, reviewer, duration and cost budgets;
   - pass CI and independent review;
   - bootstrap immutable Runtime A.
2. **WP6B Read-only CRG Integration**
   - currently stored at
     `docs/planning/WP6B_READONLY_CODE_REVIEW_GRAPH_INTEGRATION.md`;
   - remains non-executable until WP6A passes;
   - promote an exact reviewed copy to `docs/plans/` only after Runtime A exists;
   - execute with original CRG v2.3.6 and immutable Runtime A.
3. **WP6C Isolated Live CRG Smoke**
   - bootstrap Runtime B from the reviewed WP6B candidate;
   - prove success, no-change, fail-open, branch-lock, runtime-tamper and secret-leak cases in a fixture repository.
4. Obtain explicit merge authorisation, merge, then bootstrap Runtime C from `main`.

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

The immediate next engineering task is WP6A. Do not start the former CRG plan
from terminal; it has been removed from `docs/plans/` deliberately. After WP6A
passes and Runtime A is bootstrapped, promote and execute WP6B through the normal
receipt runner.
