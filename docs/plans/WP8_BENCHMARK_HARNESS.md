# WP8: Minimal Benchmark Harness

Status: **planning only — not executable by CodexLooper**

## Purpose and scope

This plan defines the first, deliberately small benchmark harness for GitHub
Issue #9. It measures deterministic repair outcomes without starting Codex,
Ralphex, CodexLooper, CloseRouter, Sol, Terra, or CRG. It is not a replacement
for the runtime receipt format and must not import or modify runtime, provider,
builder, reviewer, Git-supervisor, or security code.

The first sprint is limited to:

1. a versioned, machine-validated result schema;
2. three deterministic Node fixture repositories;
3. an offline fixture/reference-repair validator;
4. a neutral result evaluator and its tests.

It does not include a benchmark runner for real agents, a model comparison,
network access, score ranking, dashboard work, new dependencies, or persisted
benchmark results.

## Non-goals and protected boundaries

- Do not change `src/run-hardened.mjs`, `src/runtime-integrity.mjs`, builder
  envelope code, provider configuration, Terra/Sol adapters, Git-supervisor,
  CRG code, or existing security gates.
- Do not add a compatibility path for raw diffs, `--recount`, fuzzy application,
  automatic hash repair, or model-decided success.
- Do not run a real model, Ralphex, CodexLooper, CloseRouter, or CRG command.
- Do not add npm dependencies; use Node 20+ standard-library modules only.
- Do not track mutable run output, copied workspaces, caches, transcripts,
  credentials, or benchmark result files.

## Proposed layout

The exact names below keep all new behavior outside current runtime modules:

```text
benchmarks/
  schema/benchmark-result.v1.mjs
  fixtures/
    logic-bug/
    syntax-build/
    cross-file-cause/
  reference-repairs/
    logic-bug.mjs
    syntax-build.mjs
    cross-file-cause.mjs
  harness/
    fixture-manifest.mjs
    validate-fixtures.mjs
    evaluate-result.mjs
test/
  benchmark-result.test.mjs
  benchmark-fixtures.test.mjs
  benchmark-evaluator.test.mjs
```

`reference-repairs/` is test-only harness input. A future runner must create a
new candidate workspace from only `fixtures/<id>/initial/`; it must never copy
the reference-repair directory, harness source, verifier source, or stored
result data into that workspace.

## Result schema: `codexlooper.benchmark-result.v1`

The schema must accept only ordinary JSON data with exact keys, reject unknown
fields, reject accessors/prototypes when called from JavaScript, and freeze the
validated copy. Canonical serialization uses UTF-8 byte limits and lowercase
SHA-256 digests. No field may contain a prompt, model reasoning, credential,
environment dump, absolute private path, or raw tool transcript.

Required top-level fields:

```json
{
  "schema": "codexlooper.benchmark-result.v1",
  "harness": { "identity_sha256": "…", "fixture_version": 1 },
  "fixture": { "id": "logic-bug", "version": 1, "input_sha256": "…" },
  "track": "controlled_parity",
  "variant": { "id": "candidate-a", "version": "…" },
  "run": {
    "id": "…",
    "replication_group": "…",
    "attempt_index": 1,
    "order": { "randomization_seed": "…", "sequence_index": 1 },
    "cache_state": "cold",
    "fresh_workspace": true
  },
  "environment": {
    "platform": "…",
    "architecture": "…",
    "shared": {
      "node_version": "…",
      "node_executable_sha256": "…",
      "resource_limits_sha256": "…",
      "timeout_retry_policy_sha256": "…"
    },
    "variant_runtime": {
      "executable_sha256": "…",
      "version": "…",
      "configuration_sha256": "…",
      "adapter_identity_sha256": "…",
      "runtime_allowlist_sha256": "…"
    }
  },
  "source": { "commit": "…", "initial_tree_sha256": "…" },
  "outcome": {
    "status": "passed",
    "termination": "completed",
    "test": { "command_id": "fixture-success", "exit_code": 0, "sha256": "…" }
  },
  "timing": { "setup_ms": 0, "execution_ms": 0, "verifier_ms": 0, "total_ms": 0 },
  "usage": {
    "status": "not_applicable",
    "source": "offline_harness",
    "model_calls": 0,
    "input_tokens": null,
    "cache_tokens": null,
    "output_tokens": null,
    "reasoning_tokens": null,
    "cost": {
      "status": "not_applicable",
      "amount": null,
      "currency": null,
      "pricing_snapshot_sha256": null
    }
  },
  "human_interventions": { "event_count": 0, "events_sha256": "…" },
  "changes": {
    "entries": [{ "path": "src/logic.mjs", "kind": "modify" }],
    "unauthorized_files": [],
    "final_tree_sha256": "…",
    "delta_sha256": "…"
  },
  "evidence": { "baseline_failure_sha256": "…", "reference_validation_sha256": "…" }
}
```

### Telemetry and timing rules

- `usage.status` is exactly `observed`, `unavailable`, `not_applicable`, or
  `invalid`. All token fields are nullable non-negative integers. They are
  numeric only when that individual measurement was actually observed from the
  bounded `usage.source`; otherwise they are `null`, never a synthetic `0`.
- `usage.source` is a bounded allowlisted identifier such as
  `offline_harness`, `codex_turn_completed`, `ralphex_receipt`, or
  `provider_receipt`; it cannot be arbitrary prose. `observed` requires a
  non-offline source. `invalid` records contradictory or malformed telemetry
  and prevents comparison of those measurements.
- `usage.model_calls` is a harness-counted non-negative integer. In the offline
  first sprint it is observed as `0`, while every token and cost field is
  `null` and `usage.status` is `not_applicable`.
- `usage.cost.status` is separately `observed`, `unavailable`,
  `not_applicable`, or `invalid`. `amount` is nullable and must be present only
  for `observed`; `currency` is then an uppercase ISO-4217 code and
  `pricing_snapshot_sha256` is a required digest of the immutable pricing
  snapshot. For all other cost states, `amount`, `currency`, and pricing digest
  are `null`.
- Only measurements with `usage.status=observed`, an equal compatible source,
  and the relevant non-null value may be compared. Unknown, unavailable,
  not-applicable, or invalid token/cost measurements must not be imputed,
  ranked, averaged, or displayed as zero.
- `timing.setup_ms`, `execution_ms`, `verifier_ms`, and `total_ms` are separate
  non-negative observed durations. `total_ms` covers the whole run and must be
  at least their sum. Setup includes workspace/configuration preparation;
  execution is agent or direct-tool work; verifier is external harness work.

### Harness identity and result rules

- `harness.identity_sha256` binds the result to the exact schema, fixture
  manifest, baseline verifier, success verifier, evaluator, command allowlist,
  and fixture version. It is not merely a source-commit label.
- Each component is SHA-256 hashed over raw file bytes, except the fixture
  version, which is UTF-8 encoded as its canonical base-10 integer. The
  combined digest is SHA-256 over the ASCII domain separator
  `codexlooper.benchmark-harness.v1\0`, followed by component records sorted by
  fixed name (`schema`, `fixture_manifest`, `baseline_verifier`, `success_verifier`,
  `evaluator`, `command_allowlist`, `fixture_version`). Each record is
  `name UTF-8 bytes`, `0x00`, and its 32 raw digest bytes. Tests must pin the
  exact algorithm and reject reordered, missing, or substituted components.
- `run.id` is a unique harness-generated identifier. `replication_group` binds
  repeated attempts for one fixture/variant/track/configuration; `attempt_index`
  is one-based; `order` records either a fixed sequence or its randomization
  seed and sequence index. `cache_state` is `cold` or `warm`, and
  `fresh_workspace` must be true for every scored attempt.
- `environment.shared` records the platform, architecture, shared Node version
  and executable hash, resource-limit digest, and timeout/retry-policy digest.
  `environment.variant_runtime` records the variant's own executable hash,
  version, configuration digest, adapter identity, and digest of its runtime
  path allowlist. Missing required tools are recorded only for a blocked run;
  they are never silently substituted.
- `variant.id` is opaque and never a quality score. `source.commit` is a full
  Git SHA when Git metadata exists; otherwise it is `null` and the mandatory
  tree digest remains the source identity.

### Outcome and change semantics

- `passed`: fixture/harness identity is valid, the candidate ran, the fixed
  external success verifier exited `0`, and there are no unauthorized changes.
- `failed`: identity is valid and execution completed, timed out, or was
  interrupted after candidate start, but the success verifier did not pass.
  Timeouts and interruptions receive a fixed `termination` value and remain in
  the result set.
- `blocked`: the harness could not start the candidate because a declared
  prerequisite, isolation boundary, executable identity, or resource limit was
  unavailable. It remains a result and may not be silently retried away.
- `invalid`: fixture, harness, telemetry, evidence, workspace identity, or path
  policy is malformed, tampered, or contradictory. Invalid records are never
  converted to failures or passes.
- `changes.entries` is sorted by safe project-relative POSIX path and records
  exactly one of `add`, `modify`, `delete`, `mode_change`, or `symlink_change`.
  `unauthorized_files` is the sorted subset of entries outside the manifest
  allowlist. The harness derives both; a candidate cannot submit either list.
- `human_interventions` is a harness-generated summary of a private bounded
  event log, not caller-provided JSON. Its digest binds typed, timestamped,
  monotonically numbered events; details remain private.

### Canonical initial-tree, final-tree, and delta identities

`source.initial_tree_sha256` identifies only the untouched fixture input tree
immediately before the candidate starts. `changes.final_tree_sha256` identifies
only the candidate workspace after it has completed or been stopped.
`changes.delta_sha256` identifies the canonical change set from that initial
tree to that final tree. None is a shorthand for another field.

The common snapshot encoding is platform-independent:

1. Enumerate regular files and symlinks below one tree root. Normalize each to
   a safe UTF-8 POSIX relative path and sort by raw UTF-8 bytes. Exclude exactly
   `.git/**`, `.codexlooper/**`, `.ralphex/**`, and the declared runner-private
   metadata directory. All other paths, including generated paths, participate.
2. Emit one length-prefixed binary record per path. A regular-file record has a
   type tag, Unix permission bits masked to `0o777`, byte length, and SHA-256 of
   the raw file bytes. A symlink record has a type tag, masked mode, raw UTF-8
   link-target bytes, and SHA-256 of those bytes. Directories are implied by
   descendants and are not encoded. No absolute path, platform separator,
   mtime, owner, locale, line-ending conversion, Git index, or traversal order
   participates.
3. `initial_tree_sha256` is SHA-256 of
   `codexlooper.initial-tree.v1\0` followed by the initial-tree records.
   `final_tree_sha256` is SHA-256 of `codexlooper.final-tree.v1\0` followed by
   the final-tree records. Thus an identical final tree always receives the
   same `final_tree_sha256`, regardless of the candidate's repair route.

`delta_sha256` is a separate baseline-bound comparison:

1. Enumerate the sorted union of initial and final paths and retain only paths
   whose two entries differ. For each, emit a length-prefixed record containing
   the path, an explicit kind, and both the initial and final entry encodings;
   absence is a distinct entry type.
2. Kinds are `add`, `delete`, `mode_change`, `symlink_change`, or `modify`.
   `mode_change` applies only when the entry type and payload are unchanged but
   the masked mode differs; `symlink_change` applies when a symlink target or
   symlink/file type differs; all other changed regular-file or compound entry
   changes are `modify`. The derived `changes.entries` uses this same rule.
3. Hash `codexlooper.workspace-delta.v1\0`, then the 32 raw bytes of
   `initial_tree_sha256`, then the 32 raw bytes of `final_tree_sha256`, followed
   by the sorted changed-path records. This makes a delta explicitly dependent
   on its baseline even if a different fixture can reach the same final tree.

Tests must pin all three domain separators and algorithms; cover additions,
modifications, deletions, permission-only changes, symlink target changes,
excluded metadata, byte-sort order, platform path normalization, a repeated
identical final tree reached through different repair sequences, and a common
final tree with different baselines producing different deltas.

## Fixture contract

Every fixture has an immutable manifest containing its ID, version, permitted
candidate paths, deterministic baseline command, deterministic success command,
and hashes of all initial fixture files. The harness refuses a duplicate ID,
unknown manifest key, changed initial file, unsafe path, executable fixture
hook, or command outside a fixed Node/test command allowlist.

### `logic-bug` (version 1)

- Initial defect: a small pure function returns the wrong Boolean for one
  documented edge case.
- Initial state: the fixed source and test are committed fixture inputs; the
  success test deterministically fails against the initial source.
- Permitted candidate path: `src/logic.mjs` only.
- Success command: a fixed Node test command that imports the public function
  and checks ordinary and edge-case behavior.
- Expected behavior: initial command is non-zero; the reference repair changes
  only `src/logic.mjs` and makes the same command exit `0`.

### `syntax-build` (version 1)

- Initial defect: one known malformed Node module causes a deterministic
  `node --check` failure.
- Permitted candidate path: `src/entry.mjs` only.
- Success command: fixed `node --check src/entry.mjs`, followed by a fixed
  behavior check so a merely parseable but incorrect replacement does not pass.
- Expected behavior: the initial command is non-zero; the reference repair
  changes only the malformed source and both checks exit `0`.

### `cross-file-cause` (version 1)

- Initial defect: two source files form a stable causal path: a caller passes
  an invalid value across a module boundary and the callee exposes the wrong
  observable result.
- Permitted candidate paths: `src/producer.mjs` and `src/consumer.mjs` only.
- Success command: a fixed Node test imports the public consumer API and
  checks the causal case plus an independent control case.
- Expected behavior: the initial command is non-zero; the reference repair
  changes one or both allowed source files and makes every asserted case pass.

## Required comparison tracks

Every future real benchmark run declares exactly one track. The evaluator and
reporting layer must keep the tracks separate and must never combine their
results into a common leaderboard, average, win rate, or cost ranking.

### Controlled parity

- Within a replication group, every variant shares the identical fixture and
  fixture-input digest, task brief, harness, baseline verifier, success
  verifier, Node version and Node executable, platform and architecture,
  resource limits, timeout/retry rules, initial workspace state, and
  randomization or execution-order rule.
- No variant receives exclusive MEX context, `AGENTS.md`, `ROUTER.md`, reference
  material, hidden project files, pre-existing cache, or system-specific setup.
- Each variant instead records its own executable hash, version, configuration
  digest, and adapter identity. Those four variant-identity values must remain
  constant over all repetitions of one configuration cell. Any change creates
  a new configuration cell whose outcomes must not be mixed with earlier runs.
- This track measures constrained repair behavior only; it does not claim to
  represent each system's intended native workflow.

### Native workflow

- Every system uses its intended normal workflow, with the harness recording
  all setup, context, builder, reviewer, repair, retry, and verification work.
- CodexLooper may use MEX and Terra/Sol; Ralphex may use its native review
  phases; direct Codex runs in its ordinary direct form.
- The result records all observed setup/execution/verifier durations, model
  calls, telemetry source/status, human-intervention events, executable hashes,
  and configuration digests. Unavailable telemetry stays unavailable rather
  than becoming zero.
- This track measures end-to-end workflow behavior only; its results cannot be
  compared numerically with controlled-parity results.

## Technical isolation and anti-tampering controls

Merely not copying a reference repair into a workspace is insufficient. Before
any leakage-safe model comparison, the future runner must enforce all of the
following technical boundaries:

- the candidate process can read its newly created candidate workspace, the
  fixed task brief, and only the explicit runtime-path allowlist required to
  run its variant: that variant's executable, necessary runtime/toolchain,
  required dynamic libraries, minimal configuration, necessary certificates,
  and one bounded credential only when the variant requires it;
- every allowlisted runtime path has a recorded identity and SHA-256 hash. A
  credential is recorded only as a bounded credential type/identifier and
  access policy, never as a secret value. No allowlisted path may contain a
  reference repair, harness or verifier source, result data, foreign project
  file, or reachable Git history containing a reference solution;
- reference repairs are stored outside every path reachable by the candidate
  process and are absent from any Git history reachable from its workspace;
- no harness path, verifier path, reference digest, result path, parent-project
  path, or unnecessary user or home-directory path is injected into the
  candidate environment, prompt, project files, Git remotes, or command
  arguments. A bounded credential, where necessary, is provided only through
  the recorded allowlist mechanism and does not disclose harness data;
- a filesystem permission boundary, operating-system sandbox, container mount
  namespace, or equivalently enforceable isolation boundary prevents traversal,
  symlink escape, process inspection, inherited-file-descriptor access, and
  access to all non-allowlisted paths.

Without this boundary, the harness may validate fixture health offline but must
not claim a leakage-safe model comparison.

The manifest, baseline verifier, hidden success verifier, validator, evaluator,
and reference repair are outside permitted candidate paths. Candidate workspaces
receive only the initial fixture production inputs. The harness invokes all
verifiers from outside the candidate workspace and never copies hidden verifier
source, expected values, or paths into the candidate.

### Candidate feedback boundary

- The public candidate check is permitted during repair. It is identically
  known to every variant, its command is allowlisted, and it contains no hidden
  success criterion. Its normal output may be shown to the candidate.
- The hidden success verifier runs only after the candidate process has
  completed or been aborted. It produces no pass/fail feedback while the
  candidate is working; its code, expected values, and filesystem paths remain
  invisible, and it must not be callable by agentic repair loops.
- If a native workflow runs its own tests or review phases while repairing,
  those activities and their cost/time/telemetry are recorded as part of that
  workflow. They do not replace the external hidden success verifier.

The evaluator must:

1. hash and validate initial fixture inputs before the candidate starts;
2. record the expected failing baseline command and require its non-zero exit;
3. derive changed paths from before/after state, rather than accepting a path
   list from a variant;
4. mark any changed verifier, manifest, package metadata, harness,
   reference-repair, or non-allowlisted path as `unauthorized_files` and force
   `status=invalid`;
5. run the fixed success command itself and derive `status` from its exit code;
6. reject a result object lacking evaluator-created evidence digests.

This prevents ordinary test editing and hand-filled success fields from being
accepted by the harness. It is not cryptographic proof against a person who can
modify the harness executable or its filesystem; local filesystem authority is
the trust boundary. Future externally comparable runs need the isolation above
and signed/attested artifacts before claiming stronger anti-forgery properties.

## Validation sequence

Create one offline validation entrypoint, for example
`node benchmarks/harness/validate-fixtures.mjs`, that for every fixture:

1. validates the manifest and initial file digests;
2. creates a temporary isolated workspace from the initial state;
3. runs the baseline command and requires failure;
4. creates a separate fresh workspace;
5. applies the trusted reference repair through a harness-owned API;
6. derives changed paths and rejects any unauthorized path;
7. runs the exact success command and requires success;
8. evaluates a result only through `evaluate-result.mjs` and verifies schema,
   harness identity, status, evidence digests, `not_applicable` offline usage,
   and recorded changed paths;
9. removes every temporary workspace in `finally`.

The validator must neither call an LLM nor accept a human-written result JSON.
It must generate a bounded private intervention event log even when empty. It
must use a deterministic injected clock in unit tests so duration assertions are
stable; wall-clock duration in real runs remains observational metadata and is
never a score threshold.

## Future resources, retries, and replication policy

The first sprint records no real agent execution. Before any future real run,
the benchmark configuration must declare and digest all of these rules:

- a fixed positive repetition count for every fixture/variant/track/
  configuration cell;
- randomization seed or balanced deterministic execution order, recorded per
  attempt so no variant receives a systematic warm-cache or operator-order
  advantage;
- separate configuration IDs and separate reports for default configuration and
  equal-budget configuration;
- fixed limits for wall time, model calls, input/output/reasoning tokens when
  applicable, cost when observed, workspace storage, and retries;
- no silent retry: every retry receives its own `run.id`, incremented attempt
  index, duration, termination, every model invocation/count observed during
  that retry, telemetry, and intervention events;
- timeout, cancellation, process failure, and interruption remain reported
  outcomes. They cannot be deleted, rerun until a pass, or converted to an
  unrecorded warm-up.

## Human intervention event contract

The harness owns a bounded private append-only event log. A candidate, agent,
or user cannot populate `human_interventions` after the fact. At the instant of
an intervention, the harness records a monotonically increasing event number,
typed allowlisted kind, monotonic timestamp offset, and bounded counter. Kinds
include `manual_start`, `manual_stop`, `manual_patch`, `manual_retry`,
`manual_configuration_change`, and `manual_verifier_override`; the latter two
force `invalid` unless expressly part of the declared native-workflow setup.

At finalization the harness derives `event_count` and `events_sha256` from the
canonical event log. It exposes no arbitrary free-form text in result JSON. A
future report may display aggregate counts only; detailed event data remains
private evidence.

## Implementation tasks

- [ ] Add the strict `benchmark-result.v1` schema/parser and unit tests for
  exact keys, bounds, safe paths, version handling, nullable unavailable
  telemetry, separate cost status/pricing digest, run metadata, and
  invalid/forged outcome combinations.
- [ ] Add fixture manifests and the three minimal initial Node fixtures with
  fixed baseline/success commands and path allowlists.
- [ ] Add harness-owned reference repair functions and isolation helpers that
  copy only fixture initial state to a temporary workspace.
- [ ] Add the fixture validator and tests proving baseline failure, reference
  repair success, allowed-path enforcement, canonical workspace-tree hashing,
  separate initial/final/delta identity algorithms and domain separators,
  combined harness identity, private intervention-event derivation, and cleanup.
- [ ] Add the evaluator and tests proving result fields are derived from the
  execution record, unauthorized changes force `invalid`, and direct manual
  result construction cannot be accepted by the public evaluator API. Test all
  four outcome statuses and the fact that an offline result is `not_applicable`,
  never token/cost zero-filled.
- [ ] Add a narrow npm script only if it invokes the offline validator; do not
  alter the existing runtime commands or introduce dependencies.
- [ ] Run focused benchmark tests, `npm run check`, `git diff --check`, and
  `mex check --json` before implementation handoff.

## Deferred real-run work

The configuration parser for future controlled-parity/native-workflow
declarations, repetition count, ordering seed, equal-budget/default split,
executable identities, and resource limits is not part of the first offline
harness sprint. It may be implemented only in a separately authorized real-run
sprint.

The first sprint remains limited to:

1. the result schema;
2. three deterministic fixtures;
3. the offline fixture/reference-repair validator; and
4. the neutral evaluator and its tests.

No executable real-run configuration or agent runner may be created in the
first sprint.

## Critical comparison review

### Comparison bias

- Fixtures are intentionally tiny and must not be presented as general software
  engineering capability measurements.
- Controlled-parity and native-workflow tracks answer different questions and
  must never share a ranking. Their reports, replication groups, configuration
  digests, and aggregate tables remain distinct.
- Controlled parity requires identical initial bytes, task brief, visible
  context, Node version/executable, platform/architecture, resource and
  timeout/retry policies, ordering rule, and success verifier. Variant
  executable, version, configuration digest, and adapter identity remain
  variant-specific but fixed within one configuration cell. Native workflow
  instead reports every system-specific setup/context/review cost rather than
  pretending those workflows are equal.
- The benchmark reports pass/fail and raw measurements; it must not combine
  quality, cost, duration, and interventions into an arbitrary scalar score in
  this sprint.
- Default-configuration and equal-budget observations remain separate. No
  timeout, interruption, unavailable tool, or retry may be dropped to improve a
  variant's apparent rate.
- Reference repairs establish fixture validity only. They are not a baseline
  competitor and must never be scored as a model result.

### Data leakage and isolation

- Reference repairs, expected test values, harness/verifier internals, and
  reachable Git history must be technically inaccessible to the candidate
  process, not merely omitted from a copied directory.
- No harness paths, verifier paths, parent workspace paths, reference digests,
  cache paths, or result paths enter candidate environment variables, prompts,
  project files, remotes, or arguments. The only exception is a recorded,
  bounded credential supplied through the runtime allowlist when required by a
  variant; it must not grant access to protected benchmark material.
- The public candidate check is equally known and usable during repair. The
  hidden external success verifier remains inaccessible and produces no
  candidate feedback until the candidate process has ended.
- Without an enforceable filesystem or sandbox boundary, a run is useful only
  as offline fixture validation and may not be labelled leakage-safe.
- No prompts, model messages, reasoning, secrets, absolute private paths, cache
  values, or raw logs enter result JSON. Bounded diagnostic digests are enough
  to link evidence without publishing its contents.
- Fixture IDs and manifests are versioned. Any edit changes `input_sha256` and
  makes results incomparable rather than silently mixing versions.

### Manipulable success criteria

- A passing test alone is insufficient; the evaluator also validates immutable
  fixture identity, allowed changed paths, and harness-owned evidence.
- Candidate-provided `success`, tokens, costs, changed files, or human
  intervention fields are never trusted. A future adapter supplies raw tool
  telemetry to the evaluator, which calculates the record.
- Unknown telemetry cannot appear as numerical zero. Only observed compatible
  telemetry is eligible for comparison; unavailable values remain absent from
  aggregates rather than changing a variant's cost or token total.
- The initial failure and reference-repair success are mandatory fixture-health
  gates. A fixture that passes initially or whose reference repair fails is
  invalid and produces no comparison result.

## Acceptance criteria for the first sprint

- All three fixtures fail from their fixed initial states and pass after their
  known reference repairs.
- The schema records every requested neutral measurement field with a stable
  versioned contract, explicit null/unknown telemetry semantics, full harness
  identity, reproducibility metadata, and separate canonical initial-tree,
  final-tree, and baseline-bound delta identities.
- Tests prove test/manifest tampering and unauthorized changes cannot receive a
  passing result through the evaluator, and prove direct manual result fields
  cannot override harness-derived outcome, changes, evidence, or interventions.
- The plan contains distinct controlled-parity and native-workflow tracks and
  requires their separate reporting, resource/retry accounting, and technical
  leakage boundary before real model comparisons.
- No production runtime/security file is changed, no dependency is added, and
  no model/network/CRG command is used.
- `npm run check`, focused benchmark tests, `git diff --check`, and
  `mex check --json` pass after implementation.
