# CodexLooper Roadmap

Status: **Core CLI and trust hardening complete; WP8 Phase A merged; Phase B
planning only** as of 2026-08-01.

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

Evidence includes merged PR #5; the subsequent trust-hardening work merged in
PR #7.

## WP6: Trust hardening and optional advisory CRG context

**MERGED**

PR #7 merged the trust-hardening series, including immutable runtime and
preflight controls, host-controlled validation and commit boundaries, and an
optional, default-disabled advisory CRG context for Sol. PR #8 subsequently
repaired post-merge CI fixtures without relaxing production validation.

CRG remains optional and advisory. It is not a prerequisite for normal
CodexLooper operation, and this repository does not claim a general productive
benefit from it. The earlier WP8 Phase-A review had `PARTIAL` CRG coverage
because its then-unversioned files were not fully indexed.

The unverified live-CRG/sandbox boundary remains a known limitation; no live
smoke or general sandbox claim is made here.

## WP7: Dashboard

**OPTIONAL, DEFERRED**

The CLI and JSON receipts remain the supported interface. A desktop or web
dashboard is a future product idea and is unrelated to the WP6 trust-hardening
work.

## Current controlled roadmap

1. **#9 Benchmark-Epic**
   - Phase A: **complete**, merged by PR #17 at
     `922bf2e0d3c66b647cfa71d4e3955084eb3a6240`.
   - Independent verdict: `PASS`; WP8 tests: `25/25`; full suite: `212/212`.
   - Phase B: **planning active only**.
   - Phase C: blocked.
   - Phase D: blocked.
2. **#10** Read-only analysis mode.
3. **#11** Project adapters.
4. **#12** Local run and analysis report.
5. **#13** Compatibility checking.
6. **#15** Deterministic review pipeline.
7. **#16** Controlled skills, hooks and memory.

For Phase B, only inventory and planning are authorised. Implementation may
start only after a versioned plan and an independent plan review return `PASS`.
No real model or agent benchmark run may start before Gate B passes.

## Current execution sequence

```text
Phase-B inventory
→ versioned Phase-B plan
→ independent plan review
→ bounded implementation sprint
→ independent code review
→ tests and separate commit
```

No later roadmap item may begin before its predecessor has a usable, independently
reviewed minimum state.

## Current supported workflow

The hardened local CLI remains supported for bounded plans. External actions and
optional CRG advisory context remain separately authorised and controlled.

## Deliberate safety limits

CodexLooper does not automatically push, merge, deploy, publish, purchase,
contact third parties or perform other external actions. Those require a
separately authorised outer workflow.
