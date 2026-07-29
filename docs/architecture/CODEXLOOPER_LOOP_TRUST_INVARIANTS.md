# CodexLooper Loop Trust Invariants

Status: **CANONICAL AND NON-NEGOTIABLE**

Last reviewed: 2026-07-22

This document is the controlling architecture contract for every autonomous
CodexLooper run. Plans, prompts, implementation choices and reviews must conform
to it. A deviation requires an explicit human-approved architecture decision and
an update to this document before implementation begins.

## 1. Trust-root generations

Every autonomous change uses three distinct runtime generations:

1. **Runtime A** is installed from the reviewed pre-run commit and executes the
   implementation loop.
2. **Runtime B** is installed from the candidate result only after Runtime A,
   repository tests and independent review pass. Runtime B executes live smoke
   tests against an isolated fixture repository.
3. **Runtime C** is installed from merged `main` only after the candidate and
   smoke gates pass.

A runtime may build its successor, but it must never replace or mutate itself
while it is executing.

## 2. Immutable active runtime

The active Terra adapter, Sol reviewer, runner, Git supervisor, policy parser,
profile launcher, telemetry code and every transitive CodexLooper module must be
copied into a content-addressed runtime directory during bootstrap.

Generated launchers must reference that copied runtime, not mutable files in the
working repository.

The runtime installation must include a manifest containing at least:

- runtime schema version;
- source Git commit;
- relative file paths;
- SHA-256 for every copied file;
- expected file mode;
- Node.js executable and major version;
- external tool paths and pinned versions.

Preflight must verify the manifest before model execution. A missing file, hash
mismatch, unexpected symlink, unsafe permission or Node.js version mismatch is a
fail-closed error.

Repository changes produced during a run become eligible only for a later
runtime generation after the current run and independent gates finish.

## 3. Branch and ancestry authority

CodexLooper, not Ralphex or either model, owns branch authority.

At run start CodexLooper records:

- exact branch name;
- exact start SHA;
- exact repository root.

The expected branch is forwarded through a controlled environment variable.
The host supervisor verifies it before every patch application, validation and
commit. The final runner verifies it again after Ralphex exits.

A run fails closed when:

- the branch changes;
- HEAD is detached unexpectedly;
- the start SHA is no longer an ancestor of the final SHA;
- history is rewritten during the run;
- the repository root changes.

Ralphex must operate on the existing authorised branch and may not create or
switch branches inside a CodexLooper run.

## 4. Model-role separation

Terra is a read-only builder and repair model. It returns bounded structured
patches only.

The trusted host alone may:

- apply patches;
- enforce allowed paths;
- run validation commands;
- create local commits;
- write receipts.

Sol is a separate read-only reviewer. The Sol executable used for a run belongs
to the immutable active runtime and may not be replaced by candidate code before
that run's independent review completes.

Terra must never simulate Sol, approve its own work or modify the active runtime.

## 5. External-tool provenance

Codex, MEX, Ralphex and Code Review Graph are original external executables, not
reimplemented or vendored into CodexLooper.

Bootstrap and preflight must require absolute regular non-symlink executable
paths and verify pinned versions. Where practical, install state also records a
SHA-256 of the executable entrypoint and the verified upstream commit.

For Code Review Graph the approved baseline is:

- repository: `tirth8205/code-review-graph`;
- version: `2.3.6`;
- release commit: `935695f800f2b02e71aae6d463f3df65f0c6493e`.

Installing the package is allowed. Invoking the separate
`code-review-graph install` integration command is prohibited because it writes
MCP configuration, hooks, skills and instruction files.

## 6. CRG is advisory, bounded and non-authoritative

CRG may read the authorised worktree and write graph data only below the private
run directory. It receives no CloseRouter credential and exposes no MCP tools to
Terra or Sol.

Raw CRG output is untrusted repository-derived data. The complete bounded output
may be stored privately, but the Sol prompt receives only a strict projection
with allowlisted fields, lengths and counts.

The projection may contain only:

- base SHA and head SHA;
- numeric risk score;
- bounded safe project-relative changed paths;
- bounded test-gap count;
- bounded structured review-priority records containing safe paths, line numbers
  and allowlisted kinds.

It must not contain source snippets, free-form hints, unknown fields, control
characters or arbitrary summary text.

The exact upstream no-change output `No changes detected.` is normalized to a
successful empty advisory. Other unexpected non-JSON output remains a failure.

A validly configured CRG failure is **fail-open for Sol review**: Sol still runs
without CRG context and the receipt records the normalized CRG failure. Unsafe
paths, version mismatches, runtime-integrity failures and credential exposure are
fail-closed before CRG execution.

## 7. CRG build lifecycle

A CRG graph is private to one CodexLooper run. It is never reused across runs.
Within a run it may be reused only for the exact cache key:

`crg-version + run-start-sha + current-head-sha`

A new trusted-host commit invalidates the cache and requires a new build before
the next CRG advisory.

Every CRG process has deterministic time, stdout, stderr and storage ceilings.
The runner verifies that no CRG child remains after completion or failure.

## 8. Loop and cost bounds

The autonomous loop must have independent limits at both layers:

- Ralphex iteration and review-patience limits;
- CodexLooper builder-call limit;
- CodexLooper reviewer-call limit;
- maximum run duration;
- maximum estimated CloseRouter cost;
- maximum CRG builds per run.

The default Ralphex task limit for bounded plans is 12, not 50. Exceeding any
CodexLooper budget fails closed before another paid model call.

## 9. Plan lifecycle

Only one tracked direct Markdown file under `docs/plans/` is executable per run.
Designs or blocked plans remain outside that directory.

A plan may be promoted into `docs/plans/` only when all prerequisite gates are
already implemented and verified. Ralphex moves a successfully completed plan to
`docs/plans/completed/`.

The final receipt requires:

- unchanged authorised branch;
- monotonic Git ancestry;
- clean worktree;
- at least one trusted-host commit;
- completed plan path;
- recorded Terra and Sol usage;
- successful runtime-integrity verification;
- secret-free metadata.

## 10. Mandatory WP6 sequence

The order is fixed:

1. **WP6A: Loop trust hardening**, implemented outside the existing autonomous
   loop because the current runtime still references mutable repository files.
2. CI, direct tests and independent diff review of WP6A.
3. Bootstrap immutable Runtime A from the reviewed WP6A commit.
4. Promote the blocked CRG integration plan into `docs/plans/`.
5. **WP6B: CRG integration**, executed by immutable Runtime A.
6. CI and independent review of the WP6B candidate.
7. Bootstrap candidate Runtime B.
8. **WP6C: isolated live CRG smoke**, including success, no-change, fail-open,
   branch-lock, runtime-tamper and secret-leak tests.
9. Human-authorised merge.
10. Bootstrap Runtime C from merged `main`.

No step may be skipped because a later step appears to pass.

## 11. External-action boundary

No autonomous run may push, merge, release, deploy, publish, purchase, contact a
third party or modify a target product without separate explicit human
authorisation.
