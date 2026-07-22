# CodexLooper Roadmap

Status: **Core CLI complete; WP6 trust hardening active** as of 2026-07-22.

Controlling architecture contract:
`docs/architecture/CODEXLOOPER_LOOP_TRUST_INVARIANTS.md`

## WP0: Integration verification

**COMPLETE**

- verified MEX, Ralphex, Codex CLI and CloseRouter integration;
- established Terra as builder and Sol as separate reviewer;
- proved real model identity and transport;
- fixed the Ralphex-compatible controlled Codex invocation.

Evidence: PR #1 and main commit `8e3b589a09bd2935dea19ce94b36e18cc2482d83`.

## WP1: Minimal autonomous loop

**COMPLETE**

- one plan enters the loop through one command;
- MEX preflight runs before model work;
- Ralphex executes retries and review phases;
- Terra works read-only in an isolated snapshot and returns a structured patch;
- a trusted host validates allowed paths, applies the patch, reruns checks and commits;
- Sol performs a separate read-only review;
- receipts record Git state, completion gates, token usage and estimated cost;
- secret values and full model reasoning are excluded from receipts.

Real pilot result:

- 3 local commits;
- 6 Terra calls;
- 2 Sol calls;
- estimated cost: `$0.024880346`;
- all completion and cleanliness gates passed.

Evidence: PR #2 and main commit `28fd5b064237b4faedfc83232b15e38f561e610c`.

## WP2: Reusable target-project bootstrap

**COMPLETE**

- bootstraps a clean existing Git repository;
- preserves owner-authored files byte-for-byte;
- creates only missing MEX and CodexLooper scaffold files;
- rejects unsafe symlinks and path escapes;
- runs real `mex setup` and `mex check --json`;
- installs the verified CodexLooper runtime;
- writes a secret-free bootstrap receipt;
- second bootstrap is idempotent after committing the visible scaffold.

Real pilot result:

- Codex CLI `0.144.6`;
- MEX `0.6.3`;
- Ralphex `1.6.0`;
- bootstrap PASS;
- idempotency PASS;
- MEX score `79/100` on the intentionally minimal empty fixture.

Evidence: PR #3 and main commit `489883a8db6941e528b9a97a772beaa351bbf6ee`.

## WP3: Review and repair loop

**COMPLETE, consolidated into WP1**

Ralphex review phases, host-applied Terra fixes and the independent Sol review
were implemented and verified as part of WP1.

## WP4: Token and cost telemetry

**COMPLETE, consolidated into WP1**

Official Codex `turn.completed` usage events are recorded, model prices are
pinned in receipt logic, and every successful run reports estimated CloseRouter
cost.

Hard per-run budgets remain a WP6A requirement.

## WP5: Real pilot and plan safety

**COMPLETE**

- autonomous Terra/Sol loop and target bootstrap were exercised;
- direct tracked plans are accepted and nested plans are rejected;
- completed-plan filename collisions are blocked;
- rejected Terra structured patches are preserved privately for diagnostics;
- full repository regression suite passes.

Evidence includes merged PR #5 and the diagnostic work in draft PR #7.

## WP6A: Loop trust hardening

**BLOCKING, ACTIVE, MUST BE IMPLEMENTED OUTSIDE THE CURRENT LOOP**

Specification:
`docs/architecture/WP6A_LOOP_TRUST_HARDENING.md`

Required outcomes:

- content-addressed immutable runtime per bootstrap;
- generated wrappers execute copied runtime files, never mutable repository code;
- runtime manifest and preflight hash verification;
- fixed branch authority before every host mutation and at finalization;
- monotonic Git ancestry checks;
- CodexLooper-enforced builder, reviewer, duration and cost budgets;
- bounded Ralphex task iteration default;
- receipts record runtime, branch and budget evidence without secrets;
- independent tests and review before Runtime A is trusted.

The current autonomous loop must not implement and approve this trust-root
replacement itself.

## WP6B: Read-only Code Review Graph integration

**BLOCKED BY WP6A**

Design-stage specification:
`docs/planning/WP6B_READONLY_CODE_REVIEW_GRAPH_INTEGRATION.md`

The specification is intentionally outside `docs/plans/` and therefore cannot be
executed by CodexLooper. After WP6A passes and immutable Runtime A is bootstrapped,
an exact reviewed copy may be promoted into `docs/plans/`.

Required outcomes:

- original external Code Review Graph v2.3.6 executable;
- upstream release commit `935695f800f2b02e71aae6d463f3df65f0c6493e`;
- no CRG MCP, installer, hooks, embeddings, cloud or write-capable tools;
- private graph data per run;
- exact version, executable and path validation;
- strict bounded advisory projection for Sol instead of raw CRG output;
- official no-change output normalization;
- fail-open Sol review for valid CRG runtime failures;
- graph cache keyed by CRG version, run-start SHA and current trusted HEAD;
- deterministic process, output, storage and build-count ceilings.

## WP6C: Isolated live CRG smoke

**BLOCKED BY WP6B**

Runtime B, installed from the reviewed WP6B candidate, must prove in an isolated
fixture repository:

- successful private build and detect path;
- exact no-change handling;
- strict advisory projection;
- CRG failure does not suppress Sol;
- branch switching is blocked;
- active-runtime tampering is blocked;
- no residual CRG process;
- no credential in child environment, report, logs or receipt;
- all CI and receipt gates pass.

No live CRG claim may be made before WP6C passes.

## WP7: Dashboard

**OPTIONAL, DEFERRED**

The CLI and JSON receipts remain the supported interface. A desktop or web
dashboard is a future product layer and is not required for loop correctness.

## Fixed execution sequence

1. Implement WP6A outside the current autonomous loop.
2. Run tests, GitHub CI and independent review.
3. Bootstrap immutable Runtime A from the reviewed WP6A commit.
4. Promote the reviewed WP6B plan into `docs/plans/`.
5. Execute WP6B with Runtime A.
6. Run tests, CI and independent review.
7. Bootstrap candidate Runtime B.
8. Execute WP6C in an isolated fixture.
9. Obtain explicit human merge authorisation.
10. Merge and bootstrap Runtime C from `main`.

No later success waives an earlier gate.

## Current supported workflow

Until WP6A completes, the existing core CLI remains supported for bounded plans
that do not modify the active CodexLooper trust root. Do not use it to modify and
approve its own runner, Terra adapter, Sol reviewer or Git supervisor.

## Deliberate safety limits

CodexLooper does not automatically push, merge, deploy, publish, purchase,
contact third parties or perform other external actions. Those require a
separately authorised outer workflow.
