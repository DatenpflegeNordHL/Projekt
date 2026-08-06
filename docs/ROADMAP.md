# CodexLooper Roadmap

Status as of **2026-08-05**: core local workflow complete, WP8 Phase A merged, Phase B foundations in progress.

Controlling sources:

- Issue #9: reproducible CodexLooper benchmark;
- Issue #14: product roadmap and work-order constraints;
- `docs/architecture/CODEXLOOPER_LOOP_TRUST_INVARIANTS.md`: architecture and trust contract.

## Operating rule

Every roadmap item must pass the same evidence chain:

```text
research and inventory
  -> versioned plan
  -> independent plan review: PASS
  -> bounded implementation
  -> independent code review: PASS
  -> complete tests and CI
  -> merge and documented evidence
```

No model-authored success claim replaces a host-controlled check, verifier or independent review.

## Completed foundation

### WP0: Integration verification

**Complete**

- MEX, Ralphex, Codex CLI and CloseRouter integration verified;
- Terra established as builder and Sol as independent reviewer;
- controlled Codex invocation and model identity verified.

Evidence: PR #1 and main commit `8e3b589a09bd2935dea19ce94b36e18cc2482d83`.

### WP1: Minimal autonomous loop

**Complete**

- one bounded plan enters through one command;
- MEX preflight runs before model work;
- Ralphex coordinates implementation, retries and review;
- Terra produces a structured patch from a controlled snapshot;
- the trusted host validates paths, applies the patch, reruns checks and commits;
- Sol performs a separate read-only review;
- receipts capture Git state, completion gates, usage and estimated cost without secrets or full reasoning.

Evidence: PR #2 and main commit `28fd5b064237b4faedfc83232b15e38f561e610c`.

### WP2: Target-project bootstrap

**Complete**

- bootstraps clean existing Git repositories;
- preserves owner-authored files byte-for-byte;
- creates only missing scaffold files;
- blocks unsafe symlinks and path escapes;
- runs MEX setup and validation;
- produces a secret-free bootstrap receipt;
- remains idempotent after the visible scaffold is committed.

Evidence: PR #3 and main commit `489883a8db6941e528b9a97a772beaa351bbf6ee`.

### WP3 and WP4

**Complete, consolidated into WP1**

- bounded review and repair loop;
- usage and estimated-cost telemetry;
- pinned identity and receipt contracts.

### WP5: Real pilot and plan safety

**Complete**

- real Terra/Sol and bootstrap pilots exercised;
- tracked-plan and path-safety rules verified;
- rejected structured patches retained privately for diagnostics;
- full regression suite passed.

### WP6: Trust hardening

**Complete and merged**

- immutable runtime and preflight controls;
- host-controlled validation and commit authority;
- budget and allowed-path boundaries;
- optional, default-disabled advisory Code Review Graph context;
- CI fixture repair without weakening production validation.

Evidence: PR #7 and PR #8.

### WP7: Dashboard

**Deferred**

The CLI and machine-readable receipts remain the supported interface. A desktop or web dashboard is not required for the benchmark or trust model.

## WP8: Reproducible benchmark

The benchmark compares:

1. direct Codex CLI;
2. Ralphex without CodexLooper hardening;
3. CodexLooper using Terra and Sol through CloseRouter.

### Phase A: Deterministic offline harness

**Complete and merged**

Delivered:

- strict result schema v1;
- three deterministic Node fixtures;
- candidate contract and source map;
- probe controller and public checks;
- hidden verifiers and reference repairs outside the candidate workspace;
- initial, final and delta identities;
- evaluator boundaries resistant to candidate-controlled success claims.

Evidence:

- PR #17;
- merge commit `922bf2e0d3c66b647cfa71d4e3955084eb3a6240`;
- independent verdict `PASS`;
- WP8 tests `25/25`;
- complete suite `212/212`.

Phase A proves only deterministic offline fixture evaluation. It does not prove operating-system isolation, credential safety, provider telemetry or real model execution.

### Phase B: Isolated real-run foundation

**In progress, split into independently reviewed sprints**

The previous all-in-one architecture draft in PR #19 is frozen. It remains useful background, but it is not an implementation authority.

#### Reliability prerequisite

Draft PR #21 addresses process-supervisor shutdown reliability. Its current HEAD contains the startup-synchronisation fix and passes the complete suite locally (`212/212`). The PR remains a draft and must not merge until the current HEAD receives an independent final `PASS`.

#### B1a: Configuration and identity contracts

Draft PR #20 defines only:

- `codexlooper.real-run-config.v1`;
- strict ordinary-data parsing and validation;
- canonical JSON;
- runtime-allowlist identity;
- adapter-configuration identity;
- variant identity;
- configuration and configuration-cell digests;
- fixed compatibility vectors.

The compatibility-vector repair commit is `ae9b10564c57410b031f69f26a13b4a22f7f7109`. The independent re-review result is still required before the plan can be promoted or implemented.

#### B1b: Benchmark Result v2

**Not started**

Will define the exact machine-readable result contract for real runs, without executing adapters or models.

#### B1c: Deterministic scheduling

**Not started**

Will define seeded ordering, repetitions, configuration cells, time budgets and deterministic schedule identity.

#### Later Phase-B sprints

After B1a, B1b and B1c:

1. adapter contracts;
2. isolation-provider contracts and proofs;
3. credential boundaries;
4. provider telemetry and pricing;
5. evidence retention and cleanup;
6. Gate-B proof;
7. only then, authorised real runs.

No genuine model or agent benchmark run may begin before Gate B passes.

### Phase C: Small benchmark pilot

**Blocked by Phase B**

Planned minimum:

- five reproducible tasks;
- identical starting states for all comparison groups;
- at least one repetition per configuration cell;
- measured success, failures, tokens, cost, runtime and human intervention;
- separate accounting for unnecessary or unauthorised file changes;
- at least one synthetic adversarial task.

### Phase D: Full benchmark

**Blocked by Phase C**

Planned scope:

- 15 to 30 reproducible tasks;
- build, test, runtime, API, data, frontend and security categories;
- all three variants;
- machine-readable raw results and an understandable report;
- explicit publication of cases where CodexLooper performs worse.

## Product roadmap after the benchmark foundation

The order remains controlled by Issue #14:

1. **#9** Reproducible benchmark;
2. **#10** safe read-only analysis mode;
3. **#11** project adapters for Node, Python, Go, Rust and Java;
4. **#12** local run and analysis report;
5. **#13** compatibility checking;
6. **#15** deterministic review pipeline;
7. **#16** controlled skills, hooks and memory.

A later item may begin only after its predecessor has a usable, independently reviewed minimum state.

## Immediate execution order

```text
independent final PR #21 code-review PASS
  -> merge PR #21
  -> update main
  -> revalidate PR #20 against updated main
  -> independent PR #20 plan-review PASS
  -> merge and promote B1a plan
  -> implement B1a
  -> independent B1a code-review PASS
  -> plan B1b
```

PR #19 remains draft and unchanged during this sequence.

## Contributions currently useful

- deterministic reproduction of process and lifecycle races;
- Node 20 and Node 22 portability evidence;
- review of published identity and canonicalisation vectors;
- documentation corrections tied to merged behaviour;
- small fixtures and verifier tests within the authorised benchmark phase;
- evidence that simplifies or removes unnecessary CodexLooper complexity.

New providers, agents, mandatory graph systems, dashboards, browser automation and automatic deployment remain deferred until the benchmark justifies them.

## Deliberate safety limits

CodexLooper does not automatically push, merge, deploy, publish, purchase, contact third parties or alter external accounts. Credentials remain process-scoped and must not be written to Git, configuration, logs or receipts.
