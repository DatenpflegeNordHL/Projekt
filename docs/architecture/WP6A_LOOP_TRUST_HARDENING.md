# WP6A Loop Trust Hardening

Status: **BLOCKING PREREQUISITE**

Execution mode: external/manual implementation with normal repository tests and
independent review. Do not execute this specification through the current
CodexLooper/Ralphex loop because the current generated launchers still reference
mutable files in the same repository.

Controlling contract:
`docs/architecture/CODEXLOOPER_LOOP_TRUST_INVARIANTS.md`

## Goal

Remove the self-referential trust cycle before Code Review Graph integration.
After WP6A, one running CodexLooper generation can build a successor without
changing the validator, reviewer or runner that governs the current run.

## Required implementation

### 1. Content-addressed immutable runtime

Bootstrap/install must copy every runtime file and transitive local module needed
by the generated runner, Terra adapter and Sol reviewer into a private
content-addressed directory below `.codexlooper/runtime/`.

Generated wrappers must execute only files from that runtime directory. They must
not import or execute mutable `src/`, `bin/` or `scripts/` files from the working
repository.

Create a private manifest containing source commit, file hashes, modes, Node.js
identity, external executable paths and verified versions. Preflight verifies the
complete manifest before any model call.

The runtime directory and manifest must be non-symlink paths with owner-only
write access. Runtime files must not be writable by the model sandbox.

### 2. Branch lock and monotonic ancestry

At run start record the exact branch and SHA. Forward the expected branch through
the controlled child environment.

Verify branch equality and repository root:

- before preflight;
- after preflight;
- before each host patch check;
- before validation;
- before each host commit;
- after Ralphex exits.

Verify that the run-start SHA remains an ancestor of the final SHA. Any branch
switch, detached HEAD, rewritten history or repository-root drift fails closed.

Ralphex must use the existing branch. It may not create or switch branches during
a CodexLooper run.

### 3. Independent run budgets

Add CodexLooper-enforced limits independent of Ralphex:

- maximum builder calls;
- maximum reviewer calls;
- maximum estimated cost;
- maximum elapsed run duration;
- maximum CRG builds reserved for later WP6B.

Check the applicable budget before every paid model invocation. Record configured
limits and final consumption in the secret-free receipt.

Reduce the generated bounded-plan Ralphex default from `max_iterations = 50` to
`max_iterations = 12`. Preserve `task_retry_count = 1`,
`max_external_iterations = 2` and `review_patience = 2` unless tests justify a
stricter value.

### 4. Receipt and install-state evidence

Install state must record:

- runtime schema;
- runtime directory;
- source commit;
- runtime manifest path and manifest SHA-256;
- expected branch policy;
- tool paths and verified versions;
- configured budgets.

Run receipts must record runtime identity, branch-before, branch-after,
ancestry-check result and budget state without storing credentials, full model
messages or private reasoning.

## Mandatory tests

Add deterministic tests proving:

1. generated wrappers reference only the copied runtime;
2. modifying repository `src/`, `bin/` or `scripts/` after bootstrap does not
   change the active runtime behavior;
3. modifying or replacing one runtime file causes preflight to fail before model
   execution;
4. symlinked runtime files or directories are rejected;
5. Ralphex branch creation or branch switching is detected before a host commit;
6. detached HEAD and non-ancestor final history are rejected;
7. normal same-branch trusted-host commits pass;
8. builder, reviewer, duration and estimated-cost limits stop another model call;
9. the generated Ralphex configuration uses the bounded iteration values;
10. install state and receipts remain secret-free;
11. `npm run check` and `git diff --check` pass on Node.js 22;
12. the worktree is clean after every fixture.

## Completion gate

WP6A is complete only when:

- all repository tests pass;
- GitHub CI passes;
- an independent review finds no blocking trust-boundary issue;
- immutable Runtime A is bootstrapped from the reviewed candidate commit;
- Runtime A passes a local fixture proving runtime-tamper rejection and branch
  lock enforcement;
- the result is committed on the authorised PR branch.

Only after this gate may the CRG integration specification be promoted from
`docs/planning/` into executable `docs/plans/`.

## Prohibited shortcuts

- Do not let the current mutable runtime implement and approve its own trust-root
  replacement through the autonomous loop.
- Do not merely hash mutable repository files while continuing to execute them.
- Do not rely only on final branch inspection; check before each host mutation.
- Do not treat Ralphex iteration limits as cost limits.
- Do not activate candidate runtime code before the current independent review
  finishes.
- Do not push, merge or release without separate human authorisation.
