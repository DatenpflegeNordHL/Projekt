# CodexLooper Roadmap

Status: **Core CLI roadmap complete** as of 2026-07-20.

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

Ralphex review phases, host-applied Terra fixes and the independent Sol review were implemented and verified as part of WP1 instead of being delayed into a separate work package.

## WP4: Token and cost controls

**COMPLETE, consolidated into WP1**

Official Codex `turn.completed` usage events are recorded, model prices are pinned in the receipt logic, and every successful run reports an estimated CloseRouter cost.

## WP5: Real pilot

**COMPLETE, consolidated into WP1 and WP2**

Both the autonomous Terra/Sol development loop and the real target-project bootstrap were exercised with the pinned external tools in GitHub Actions.

## WP6: Dashboard

**OPTIONAL, DEFERRED**

The CLI and JSON receipts are the supported v1 interface. A desktop or web dashboard is not required for the autonomous loop to function and remains a future product layer.

## Current supported workflow

1. Install Node.js 20+, Codex CLI, MEX 0.6.3 and Ralphex 1.6.0.
2. Run `scripts/bootstrap.mjs` once against a clean target repository.
3. Review and commit the generated visible scaffold.
4. Add a bounded plan under `docs/plans/`.
5. Run the generated `.codexlooper/bin/codexlooper` command with that plan.
6. Inspect the secret-free receipt under `.codexlooper/runs/`.

## Deliberate safety limits

CodexLooper does not automatically push, merge, deploy, publish, purchase, contact third parties, or perform other external actions. Those require a separately authorized outer workflow.
