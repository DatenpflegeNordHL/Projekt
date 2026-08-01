# WP8 Phase B: Isolated Real-Run Runner

Status: **Planning draft — not executable, implementation not authorised**

## Authority, baseline, and non-authorisation

This is a design and inventory record, not an executable CodexLooper plan. It
must remain outside `docs/plans/` until an independent plan review returns
`PASS`; no promotion is authorised by this document. Its baseline is main
commit `88e1d1d566d05919550688bceadff4b719f893d8`, after Phase-A merge PR #17
(`922bf2e0d3c66b647cfa71d4e3955084eb3a6240`) and documentation-sync PR #18
(`88e1d1d566d05919550688bceadff4b719f893d8`). GitHub Issue #9 is the
benchmark epic and Issue #14 is the controlling roadmap.

Phase A is complete: its deterministic offline harness received independent
`PASS`, its focused tests are 25/25, and the repository suite is 212/212.
Phase B is **planning only**. This plan authorises neither an implementation,
a real model/agent/provider/CRG run, nor a credential read. Gate B must be
proved with fake adapters and dummy credentials before any real run can start.
No claim below says that technical isolation or leakage resistance is already
proved.

## Scope and explicit non-goals

The future runner will compare three variants, each under separately bound
configuration cells:

1. direct Codex CLI;
2. Ralphex without CodexLooper hardening; and
3. CodexLooper with Terra and Sol through CloseRouter.

It must preserve Phase-A result semantics, make the harness rather than a
candidate decide success, and keep native workflow and controlled parity
separate. This planning change does not create a runner, adapter,
configuration, fixture, credential, result, receipt, provider integration, or
network path. It does not alter `benchmarks/**`, runtime/security code, CI,
or the existing receipt format.

## Inventory: Phase-A benchmark harness

| Component | Purpose / public interface | Trust, reuse, and protected boundary | Phase-B gap |
| --- | --- | --- | --- |
| `benchmark-result.v1` | `RESULT_SCHEMA`, `parseUntrustedBenchmarkResult`, `buildHarnessIdentity`, and `sha256` validate/freeze strict ordinary-data results. | Candidate/adapter result data is untrusted; reuse strict parsing, status matrix, canonical SHA-256 identities, and unavailable-vs-zero semantics. Do not widen v1 silently. | No real-run configuration, richer variant identity, telemetry provenance, or private evidence references. |
| Fixture manifests | `FIXTURES`, `getFixture`, manifest validators bind IDs, versions, exact inputs and fixed commands. | Trusted manifest/fixture source; candidate sees only declared initial source. Reuse identity binding; keep manifests out of workspaces. | No real-run configuration cell or variant binding. |
| Candidate contract | `candidateContract(fixture)` returns declared entry and paths. | Trusted contract; candidate source untrusted. Reuse exact input policy for existing fixtures. | No general tool/adapter input contract. |
| Candidate source map | `validateSourceMap`, `treeDigest`, safe POSIX paths, file/byte limits. | Harness seals exact candidate bytes before probing. Reuse path/mode/symlink/digest discipline. | It is neither process isolation nor an OS sandbox. |
| Probe controller and verifier protocol | `runCandidateProbe` uses separate controller, authenticated IPC, one bounded record bound to request/tree. | Candidate/controller output remains untrusted until verified. Reuse host-owned transport principles. | Node probe-specific; no arbitrary tool lifecycle or telemetry stream. |
| Fixture validator | `createCandidateWorkspace`, `validateFixture`, `validateCandidateFixture`, `validateAllFixtures`. | Copies only inputs and cleans in `finally`. Reuse fresh-workspace/cleanup discipline. | No hardened process tree, network, credential or real-adapter boundary. |
| Neutral evaluator | `snapshotTree`, `readCandidateSourceMap`, `deriveChanges`, `executableSha256`. | Harness-derived initial/final/delta identities. Reuse exact-byte and executable hashing. | No cross-process evidence, artifact retention, or protected-root policy. |
| Public checks | One deterministic visible check per fixture. | Harness-controlled but visible; output never decides success alone. | No real-run test-command policy/parity contract. |
| Hidden verifiers | Fixture-specific `success-verifier.mjs`. | Trusted and excluded from candidate workspace; behavior stays unchanged. | Technical non-reachability from a real child is unproved. |
| Reference repairs | Three harness-only repair modules. | Trusted test-only inputs; never copied to candidate. | Not a real-run oracle/candidate input. |
| Result semantics | Harness identity, fixture input, initial/final/delta digests, intervention digest, timing, `not_applicable` usage. | Harness derives success-bearing values. | No per-attempt real event provenance/pricing evidence. |

### Fixture and test evidence

`logic-bug`, `syntax-build`, and `cross-file-cause` each provide initial
sources, public checks, hidden verifiers, and reference repairs. Their candidate
contracts allow respectively one logic source, one entry source, and two
producer/consumer sources. Existing tests prove baseline failure/reference
success, exclusion of harness material, cleanup on failures, source-map
sealing, IPC replay rejection, unsafe-path/import/VM/WebAssembly rejection,
tree/delta compatibility, and executable-byte drift. These are reusable
principles, not a proof that arbitrary real tools cannot access protected data.

## Inventory: runtime, telemetry, and trust components

| Requirement | Existing component and proof | Reusable for Phase B | Gap | Protected boundary |
| --- | --- | --- | --- | --- |
| Immutable runtime / manifest | `src/runtime-integrity.mjs`, install/preflight; bootstrap/runtime path tests and Runtime-A proof. | Content-addressed copy, modes, external executable checks. | Need Phase-B tool/adapter manifest, not a trust-root mutation. | Runtime manifest/trust root. |
| Paths/bootstrap/install | `src/runtime-paths.mjs`, `src/bootstrap.mjs`, install/bootstrap scripts and tests. | Private-directory and symlink-safe patterns. | Candidate/evidence-root contracts. | Bootstrap/installer behavior. |
| Git authority | `src/git-authority.mjs`, `src/git-supervisor.mjs`, `scripts/vcs-guard.mjs`; dedicated tests. | Exact root/branch/start-SHA/ancestry checks. | Candidate must not receive parent history. | Git supervisor/branch authority. |
| Filtered launch profiles | `src/launcher.mjs`, `src/profiles.mjs`, `bin/codex-closerouter.mjs`. | Allowlisted environment and profile metadata patterns. | Per-variant minimal environment and FD policy. | Provider credential handling. |
| Process termination | `scripts/run.mjs` creates detached groups and sends SIGTERM then SIGKILL; process-supervisor tests cover SIGTERM-ignore. | Host-owned timeout/grace/group pattern. | Prove descendant cleanup per variant and record evidence. | Existing runner lifecycle. |
| Budgets | `src/run-budget.mjs` and tests. | Monotonic reservation/reconciliation. | Separate real-run calls/tokens/retries/storage/artifact cell limits. | Existing builder/reviewer budgets. |
| Telemetry/pricing | `src/telemetry.mjs`, `src/claude-stream.mjs` parse `turn.completed`, record secret-free JSONL and aggregate `MODEL_PRICING`; telemetry tests. | Event parser, redaction, count aggregation, pricing-snapshot concept. | No parity mapping, per-variant provenance, immutable external pricing artifact. | Existing receipt format. |
| Diagnostics/receipts | `src/codex-diagnostics.mjs`, `scripts/run.mjs`, `src/live-smoke.mjs`. | Redaction/private atomic-write patterns. | Phase-B public/private artifact contract must be separate. | Existing receipts. |
| Terra/Sol / CloseRouter | Terra/Sol/runtime binaries and installer config; protocol/live-smoke tests. | Known profile identities and launcher structure. | Not a benchmark adapter API; no direct Codex or un-hardened Ralphex adapters. | Terra/Sol contracts. |
| CRG isolation precedent | `src/code-review-graph.mjs`, `src/crg-runtime-config.mjs`; CRG sandbox/foundation/mutation tests. | Exact runtime identity, minimal env, private write root, fail-closed availability. | CRG-specific and not evidence of a general agent sandbox. | Optional CRG boundary. |
| Cleanup | Benchmark validator and `src/builder-snapshot.mjs`. | `finally` cleanup/private path rules. | Cleanup attestation, interruption recovery, retention. | Existing snapshot semantics. |

## Comparison variants and invariants

Every run has a `track` of exactly `controlled_parity` or
`native_workflow`. Results from these tracks must never be aggregated, ranked,
or compared in the same configuration cell. The harness, not an adapter,
creates the run ID, workspace, snapshots, outcome, unauthorised-file list,
evidence digests and human-intervention summary.

| Variant | Adapter / executable / configuration identity | Environment, telemetry, and termination | Track rule |
| --- | --- | --- | --- |
| Direct Codex CLI | Pinned absolute regular executable, raw-byte SHA-256, verified version, adapter digest, canonical config digest, runtime allowlist digest. | Minimal allowlist; one bound credential only if policy requires it; host counts starts and owns process group. Authenticated `turn.completed` data may be raw tool evidence. | Native uses documented CLI behavior; parity uses shared fixture/budgets but must not call itself native. |
| Ralphex without hardening | Same tuple plus exact Ralphex executable/version and declared non-CodexLooper config bytes. | One policy-bound credential at most; receipt/tool data is untrusted until schema validation; host owns termination. | Native orchestration and controlled adapter invocation are separately labelled. |
| CodexLooper Terra/Sol through CloseRouter | Bind immutable runtime-manifest digest, Terra/Sol wrapper digests, endpoint/model identity and adapter digest. | Child-only filtered credential; only type/policy/status recorded. Existing `turn.completed` parser supplies raw events and host owns timing/termination. | Controlled parity cannot erase the native two-role workflow. |

No candidate or adapter may determine `outcome.status`, `unauthorized_files`,
`initial_tree_sha256`, `final_tree_sha256`, `delta_sha256`, evidence
digests, human-intervention summary, or benchmark success.

## Versioned configuration contract (design only)

The proposed schema is `codexlooper.real-run-config.v1`. It accepts only
ordinary JSON with exact keys; unknown, inherited, accessor, symbol-keyed and
duplicate fields are rejected. Canonical UTF-8 sorted-key serialization uses a
domain-separated SHA-256; every relevant change creates a new configuration
cell.

| Field | Type, bounds, validation |
| --- | --- |
| `schema`, `track` | Exact schema and either `controlled_parity` or `native_workflow`; no mixed value. |
| `fixtures` | Non-empty bounded dense array of unique trusted `{id, version, input_sha256}`. |
| `variant` | Bounded IDs plus `adapter_id`, absolute `executable_path`, executable SHA-256, version, adapter SHA-256, configuration SHA-256. |
| `runtime` | Approved absolute executable/runtime roots after realpath, regular-file, ownership/mode and symlink checks; project-relative allowlist entries resolve only below their declared root. |
| `credential_policy` | Policy ID plus required boolean only; no credential, header, command-line value or environment dump. |
| `replication` | Positive bounded count, replication group, one-based attempt, fixed ordering seed and one-based sequence position. |
| `cache` / workspace | `cold` or `warm`; every scored attempt requires a fresh workspace; cache cells remain distinct. |
| `budgets` | Positive bounded wall-time, termination grace, model-call, retry, token, cost, workspace-storage and artifact-size limits. |
| `telemetry` | Source allowlist and immutable pricing-snapshot digest; field availability is explicit. |
| `evidence`, `results`, `cleanup` | Policy identifiers for private/public roots, atomic-write limits, retention and cleanup attestation; no private absolute paths in public result. |

Relative paths are safe POSIX paths; absolute paths are host-supplied canonical
roots only. Escape, symlink, canonical-path duplication, missing tool,
hash/version drift or unknown fields block before start. Missing telemetry is
`unavailable`, never zero; contradictory telemetry is `invalid`; secrets are
rejected from configuration, results and diagnostics.

## Host-controlled lifecycle

| Step | Responsible component / inputs | Evidence and failure mapping | Cleanup / test strategy |
| --- | --- | --- | --- |
| Configuration validation | Host validates untrusted config against trusted schema. | Canonical digest; field/path/hash errors => `blocked`. | No child; pending private state deleted; strict-parser tests. |
| Fixture and harness identity | Host hashes trusted manifest/schema/verifier/evaluator bytes. | Fixture/harness identities; mismatch => `blocked`. | No child; substitution tests. |
| Variant identity | Host verifies executable/version/adapter/runtime allowlist/policy. | Full identity tuple; drift/missing tool => `blocked`. | No child; hash/version tests. |
| Fresh workspace | Host copies approved fixture inputs only. | Initial snapshot; copy/path error => `blocked` or `invalid`. | Delete workspace; copy failure tests. |
| Isolation preparation | Host provisions minimal environment and technical confinement. | Capability/profile identity; unavailable/mismatch => `blocked`. | Delete workspace; fake-provider and macOS tests. |
| Candidate start | Host uses fixed argv without shell and creates a process group. | Start time/PID; launch error => `blocked`, started failure => `failed`. | Start failure tests. |
| Bounded execution | Host captures timing/events with output ceilings. | Redacted bounded event digest; timeout/overflow => `failed` or `invalid`. | Terminate group; timeout tests. |
| Process-tree termination | Host SIGTERM, waits grace, SIGKILLs, verifies descendants. | Termination/descendant evidence; missing proof => `invalid`. | Cleanup tests for ignored SIGTERM/child. |
| Snapshot and hidden verification | Host snapshots only after candidate end, derives delta, runs verifier. | Final/delta/unauthorised/verifier digests; only compliant zero-exit verifier can pass. | `failed`/ `invalid`; protected-path tests. |
| Telemetry validation | Host validates source, sequence, terminal events and pricing identity. | Telemetry digest; contradiction => `invalid`, absence => `unavailable`. | malformed/duplicate/early-exit tests. |
| Artifact finalization | Host atomically writes public result/private evidence. | Output digests/modes; interrupted/oversize/tampered => `invalid`. | Delete partial public output. |
| Cleanup verification | Host verifies configured deletion/retention. | Cleanup attestation; failure => `invalid`. | Never ignore failure; cleanup tests. |

`passed` requires every required identity, isolation, termination, verifier,
telemetry-validity and cleanup gate. `failed` is an ordinary started
candidate/test failure. `blocked` is a safe precondition missing before start.
`invalid` is malformed, contradictory or insufficient integrity/isolation/
evidence/telemetry/filesystem/cleanup proof.

## Technical isolation: recommendation and open proof

Phase A supplies copying and Node-VM controls, not OS isolation. On this macOS
baseline `/usr/bin/sandbox-exec` is available; existing CRG tests prove only a
narrow, pinned CRG Seatbelt profile with one private SQLite write location.
That precedent must not be generalized by name alone.

The recommended architecture is a portable `IsolationProvider` interface,
initially with a test-only fake provider and a macOS Seatbelt provider. Its
host-owned launch contract binds read-only executable/runtime roots, a fresh
candidate root writable only as required, an inaccessible private evidence root,
no network, no home-directory access, no parent repository/Git history, no
hidden verifier/reference repair/harness access, minimal explicit environment,
and closed inherited descriptors. The host snapshots and verifies outside the
candidate sandbox.

Gate B must prove those effects with fake executables that attempt file reads/
writes, symlink escape, network access, environment dumping and process escape.
If a provider is absent or cannot express a required boundary, the run is
`blocked`; copy-only isolation, adapter promises, and best-effort profiles are
not alternatives. Other platforms require their own reviewed providers and are
blocked until proved.

## Credential, telemetry, artifacts, retries

A variant declares only credential requirement and credential-policy ID. After
identity/isolation gates, the host may inject one bound dummy or real credential,
removes other credential-like variables, rejects secrets in argv, and redacts
exact/pattern values from bounded diagnostics. Gate B uses fake adapters and
dummy credentials. Tests inspect environment dumps, argv, temp files, child
descendants, failed receipts and malformed events.

Per field telemetry is classified as `harness_observed`, `tool_observed`,
`provider_observed`, `receipt_derived`, `unavailable`, `invalid`, or
`not_applicable`. The host observes call count and setup/execution/verifier/
total durations. Adapters only offer raw `turn.completed`, receipt, or
provider data; duplicates, contradictions, malformed values, missing terminal
events or pricing drift are `invalid`. Tokens cover input, cache, output and
reasoning; observed cost requires immutable pricing-snapshot identity. No
estimate is called observed.

Public artifacts: validated result, config/variant/harness/fixture digests,
bounded status summary and cleanup status. Private evidence: bounded redacted
event stream, tool telemetry, termination evidence, private verifier detail and
credential-redaction evidence. Future code must enforce private modes, size
limits, atomic temp-and-rename writes, digest binding, retention and cleanup;
interrupted writes, absent/tampered evidence or private data committed to Git
invalidate the attempt.

There are no silent retries and no retry-until-PASS. Every attempt receives a
new host run ID, visible one-based index and retained outcome. Fixed seeds/
balanced sequence positions are cell inputs; cold/warm and default/equal-budget
cells are distinct; every scored attempt gets a fresh workspace; humans cannot
change a running cell.

## Future file-level implementation plan (not authorised)

| Section | Proposed files and purpose | Tests / acceptance criteria | Stop-gate and non-goal |
| --- | --- | --- | --- |
| B1 contracts and identities | New `benchmarks/real-run/config.v1.mjs`, `variant-identity.mjs`, `result.v2.mjs`; strict config, canonical identity and result contracts. | `test/real-run-config.test.mjs`, `test/real-run-identity.test.mjs`: unknown fields, paths, symlinks, digest/version drift, track/cell separation. | Stop on Phase-A compatibility issue; no executable invocation. |
| B2 adapters and fakes | `benchmarks/real-run/adapters/{contract,direct-codex,ralphex,codexlooper,fake}.mjs`; test-only tools under `test/fixtures/real-run/`. | `test/real-run-adapters.test.mjs`: fixed argv/env, identity binding, success/failure/malformed telemetry. | No real provider/tool invocation and no runtime refactor. |
| B3 isolation and lifecycle | `benchmarks/real-run/isolation/{provider,macos-seatbelt,fake}.mjs`, `runner.mjs`, `workspace.mjs`. | `test/real-run-isolation.test.mjs`, `test/real-run-lifecycle.test.mjs`: macOS denial proof; portable lifecycle/process behavior. | Unproven isolation blocks; no fallback safety claim. |
| B4 telemetry/evidence/cleanup | `telemetry.mjs`, `evidence.mjs`, `artifacts.mjs`. | `test/real-run-telemetry.test.mjs`, `test/real-run-evidence.test.mjs`: state semantics, pricing drift, redaction, limits, atomic writes, cleanup. | Existing receipt format remains unchanged. |
| B5 complete Gate-B proof | Test-only fake programs and `test/real-run-gate-b.test.mjs`; optional proof document only after evidence. | Complete offline fake-adapter proof and CI partitioning. | No real run; promotion/review is separate. |

For each proposed module, trusted inputs are host configuration,
manifest/identity bytes and harness policy; untrusted inputs are adapter events,
child filesystem state and candidate output. Dependencies are Node standard
library and compatible Phase-A identity helpers only. The first sprint must not
modify Phase-A schema semantics, hidden verifiers, reference repairs, runtime
trust root, Git supervisor, Terra/Sol contracts, provider credential handling,
receipt format, branch authority, runtime integrity checks, or CI live-smoke
authorization. Any later exception needs individual rationale, compatibility/
regression tests, and separate review.

### Required offline fake-adapter tests

Platform-neutral: success, ordinary failure, timeout, SIGTERM-ignore,
surviving descendant, unauthorised file, symlink escape, protected-path/
hidden-verifier/public-check access, forbidden environment, malformed/
contradictory/duplicate terminal telemetry, early telemetry exit, executable/
configuration/adapter/pricing drift, missing tool/isolation, cleanup failure,
artifact overflow, interrupted result write, track mixing, retry omission,
order-seed mismatch and credential-redaction failure.

macOS-only: prove actual Seatbelt denial of network and unapproved reads/writes
while allowing only needed candidate/runtime paths. GitHub CI can run portable
fakes, schemas, lifecycle, telemetry and artifact tests; macOS Gate-B proof
runs locally and in macOS CI only with the policy tool available. Missing
isolation is a tested `blocked` result, not a skipped safety gate.

## Open decisions and plan-review acceptance

| Decision | Options/evidence | Recommended option | Remaining proof | Blocking status |
| --- | --- | --- | --- | --- |
| macOS isolation | Narrow CRG `sandbox-exec` proof exists; Phase A is copy/VM only. | Dedicated Seatbelt policy behind `IsolationProvider`. | Adversarial fake-tool denial/allow and descendant tests. | Gate B blocker. |
| Cross-platform support | Fake provider portable; no general OS proof. | macOS-only real-run eligibility initially; other platforms block. | Reviewed provider per platform. | Blocks other platforms. |
| Result schema | Phase-A v1 is strict offline schema. | Separate v2/explicit extension after compatibility review. | Parser/migration tests. | B1 blocker. |
| Ralphex raw telemetry | Existing receipts/streams lack benchmark adapter contract. | Treat as untrusted receipt-derived data. | Fake-adapter provenance proof. | B2 blocker. |
| Pricing | Existing in-code pricing is useful but not bound real-run artifact. | Immutable versioned snapshot with digest. | Snapshot lifecycle/drift tests. | B4 blocker. |

A plan review may return `PASS` only when it confirms: all variant start/
identity contracts; track/cell binding; fresh workspaces; hidden-material
inaccessibility; technical isolation and blocked fallback; process-tree
termination; token/cost/timing semantics; retries/order; public/private
artifact separation; cleanup proof; complete offline Gate-B tests; exact later
file scope and protected boundaries; and B1 as the smallest next sprint.
