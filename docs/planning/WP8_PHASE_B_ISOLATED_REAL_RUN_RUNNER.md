# WP8 Phase B: Isolated Real-Run Runner

Status: **Planning draft — not executable, implementation not authorised**

## Authority, baseline, and non-authorisation

This is a design and inventory record, not an executable CodexLooper plan. It
must remain outside `docs/plans/` until an independent plan review returns
`PASS`. Its baseline is main commit
`88e1d1d566d05919550688bceadff4b719f893d8`. GitHub Issue #9 is the
benchmark epic and Issue #14 is the controlling roadmap.

Phase A supplies deterministic fixtures, source identities, hidden verification,
and a strict v1 result parser. Phase B is planning only. This plan authorises
neither implementation, plan promotion, credential use, a real model, agent,
provider, Codex, Ralphex, CodexLooper, CloseRouter, or CRG run. Gate B uses fake
adapters and dummy credentials until an independently reviewed implementation
proves every stated boundary.

## Independent review status

Independent Sol review of commit `ad05efe38407da3a5ce41701f4293be2e434fd54`
returned `CHANGES_REQUIRED` with no P0 findings, five P1 findings and five
P2 findings.

This revision addresses only the reviewed planning gaps. It does not authorise
implementation, plan promotion, credentials, real adapters or real model runs.

A new independent review of the corrected commit is required.

## Scope and protected boundaries

The future runner has exactly three variant families:

1. `direct-codex-cli.v1`;
2. `ralphex-unhardened.v1`; and
3. `codexlooper-terra-sol.v1`.

Every run has exactly one track: `controlled_parity` or `native_workflow`.
Reports, configuration cells, resource accounting, and aggregation are separate
by track. The host alone creates workspaces, run IDs, snapshots, changed-path
records, result status, evidence digests, and intervention summaries.

Phase-A fixtures, hidden verifiers, reference repairs, `benchmark-result.v1`,
runtime trust roots, Git supervisor, Terra/Sol production contracts, receipt
format, branch authority, and live-smoke authorisation remain protected. This
plan creates no implementation, executable configuration, provider integration,
or network path.

## Inventory and reuse decisions

| Existing component | Phase-B decision | Boundary |
| --- | --- | --- |
| `benchmarks/schema/benchmark-result.v1.mjs` | Keep v1 unchanged; reuse ordinary-data and SHA-256 discipline as patterns. | Phase-A results remain v1. |
| Fixture manifests, source maps, snapshots, evaluator | Reuse fixture identity and snapshot algorithms directly for existing fixtures. | Candidate input remains fixture initial sources only. |
| Probe controller and verifier protocol | Reuse host-owned authenticated transport principles only. | Node VM controls are not OS isolation. |
| Runtime integrity, runtime paths, Git authority | Reuse canonical-path and immutable-identity patterns after extraction. | Existing trust roots are unchanged. |
| Launcher, profiles, and process supervisor | Reuse no adapter or lifecycle implementation directly. | Existing runtime semantics are protected. |
| Telemetry and `MODEL_PRICING` | Reuse parser and redaction concepts only. | In-code pricing is not a Phase-B snapshot. |
| CRG Seatbelt support | Reuse profile-identity and denial-test patterns only. | The CRG profile is not a general agent sandbox. |

## Normative data rules

Every Phase-B parser accepts only ordinary JSON data. Every object has exactly
the keys stated in this plan; unknown, inherited, accessor-backed, symbol-keyed,
non-enumerable, proxy-backed, sparse-array, and duplicate-key input is rejected.
Objects use Object.prototype and arrays use Array.prototype. JSON text is decoded
with duplicate-key detection before object construction.

Strings contain valid Unicode scalar values, contain no NUL or C0/C1 control
character, contain no lone surrogate, and use raw UTF-8 semantics: no Unicode
normalisation occurs. Every digest is lower-case 64-hex SHA-256. Every number is
a safe integer; floats, exponent notation, -0, NaN, and infinity are rejected.
A null value is valid only where this plan explicitly states null.

A safe relative path is non-empty, uses POSIX slash only, has no backslash, no
empty segment, and no dot or dot-dot segment. An absolute path is canonical,
non-symlinked, and host supplied. No configuration, event, public result, or
diagnostic field contains a secret, free-form prompt, model message, reasoning
text, raw tool output, arbitrary environment dump, or user-specific absolute
path. IDs match ASCII `[a-z0-9][a-z0-9._-]*`. Versions match ASCII
`[A-Za-z0-9][A-Za-z0-9._+.-]*`.

## Versioned real-run configuration contract

The sole configuration schema is `codexlooper.real-run-config.v1`. Every field
shown is required. No optional field, extension field, or alternative field name
exists.

~~~json
{
  "schema": "codexlooper.real-run-config.v1",
  "track": "controlled_parity",
  "fixtures": [
    { "id": "logic-bug", "version": 1, "input_sha256": "<64 lowercase hex>" }
  ],
  "variant": {
    "id": "direct-codex-cli",
    "adapter_id": "direct-codex-cli.v1",
    "adapter_sha256": "<64 lowercase hex>",
    "executable_path": "/canonical/host/path",
    "executable_sha256": "<64 lowercase hex>",
    "version": "1.0.0",
    "configuration_sha256": "<64 lowercase hex>",
    "runtime_allowlist_sha256": "<64 lowercase hex>"
  },
  "runtime": {
    "platform": "darwin",
    "architecture": "arm64",
    "node_version": "v24.0.0",
    "node_executable_sha256": "<64 lowercase hex>",
    "isolation_provider_id": "macos-seatbelt.v1",
    "isolation_profile_sha256": "<64 lowercase hex>",
    "allowlist": [
      {
        "path": "/canonical/host/runtime",
        "sha256": "<64 lowercase hex>",
        "mode": 493,
        "role": "runtime"
      }
    ]
  },
  "credential_policy": {
    "id": "direct-codex-openai-env.v1",
    "type": "openai_api_key",
    "required": true,
    "injection_channel": "child_environment",
    "allowed_environment_key": "OPENAI_API_KEY"
  },
  "replication": {
    "group": "cp-a",
    "repetition_index": 1,
    "repetition_count": 1,
    "attempt_index": 1,
    "retry_index": 0
  },
  "ordering": {
    "seed": "0123456789abcdef0123456789abcdef",
    "sequence_index": 1,
    "sequence_count": 1
  },
  "cache": { "state": "cold", "policy_id": "no-cache.v1" },
  "workspace": { "fresh": true, "storage_limit_bytes": 10485760 },
  "budgets": {
    "wall_time_ms": 60000,
    "termination_grace_ms": 2000,
    "model_calls": 1,
    "retry_limit": 0,
    "input_tokens": 100000,
    "output_tokens": 100000,
    "reasoning_tokens": 100000,
    "cost_amount": 1000000,
    "cost_currency": "USD",
    "artifact_limit_bytes": 10485760
  },
  "telemetry": {
    "allowed_sources": ["harness_observed", "tool_observed"],
    "pricing_snapshot_sha256": "<64 lowercase hex>"
  },
  "evidence": { "policy_id": "private-evidence.v1" },
  "results": { "policy_id": "public-result.v2" },
  "cleanup": { "policy_id": "strict-cleanup.v1" }
}
~~~

| Object.field | Type, min/max | Exact validation | Null |
| --- | --- | --- | --- |
| `schema` | string, 31 bytes | exact schema value | never |
| `track` | string, 18–19 bytes | `controlled_parity` or `native_workflow` | never |
| `fixtures` | dense array, 1–64 | bytewise UTF-8 sorted; unique id/version; trusted manifests only | never |
| `fixtures[].id` | string, 1–64 bytes | ASCII ID equal to trusted manifest ID | never |
| `fixtures[].version` | integer, 1–65535 | exact trusted manifest version | never |
| `fixtures[].input_sha256` | string, 64 bytes | trusted fixture-input digest | never |
| `variant.id` | string, 1–64 bytes | `direct-codex-cli`, `ralphex-unhardened`, or `codexlooper-terra-sol` | never |
| `variant.adapter_id` | string, 1–64 bytes | matching family with `.v1` suffix | never |
| `variant.adapter_sha256` | string, 64 bytes | adapter source-identity digest | never |
| `variant.executable_path` | string, 1–4096 bytes | canonical absolute regular executable, never symlink | never |
| `variant.executable_sha256` | string, 64 bytes | raw executable-byte digest | never |
| `variant.version` | string, 1–128 bytes | exact parsed version token | never |
| `variant.configuration_sha256` | string, 64 bytes | digest of exact non-secret adapter-config document | never |
| `variant.runtime_allowlist_sha256` | string, 64 bytes | equal to derived allowlist digest | never |
| `runtime.platform` | string, 5–6 bytes | `darwin` or `linux` | never |
| `runtime.architecture` | string, 3–5 bytes | `arm64` or `x64` | never |
| `runtime.node_version` | string, 3–32 bytes | exact v-prefixed Node version | never |
| `runtime.node_executable_sha256` | string, 64 bytes | raw Node executable digest | never |
| `runtime.isolation_provider_id` | string, 1–64 bytes | `macos-seatbelt.v1` or fake provider in tests only | never |
| `runtime.isolation_profile_sha256` | string, 64 bytes | canonical provider-profile digest | never |
| `runtime.allowlist` | dense array, 1–128 | sorted canonical runtime entries | never |
| `runtime.allowlist[].path` | string, 1–4096 bytes | canonical absolute non-symlink path | never |
| `runtime.allowlist[].sha256` | string, 64 bytes | file bytes or canonical directory-tree digest | never |
| `runtime.allowlist[].mode` | integer, 0–511 | mode masked by 0777 | never |
| `runtime.allowlist[].role` | string, 1–32 bytes | `executable`, `runtime`, `library`, `certificate`, `adapter_config`, or `cache_root` | never |
| `credential_policy.id` | string, 1–64 bytes | policy table ID | never |
| `credential_policy.type` | string, 4–32 bytes | `none`, `openai_api_key`, or `closerouter_api_key` | never |
| `credential_policy.required` | boolean | matches adapter/policy table | never |
| `credential_policy.injection_channel` | string, 17 bytes | exact `child_environment` | never |
| `credential_policy.allowed_environment_key` | string, 4–64 bytes | `NONE`, `OPENAI_API_KEY`, or `CLOSEROUTER_API_KEY` | never |
| `replication.group` | string, 1–64 bytes | ASCII ID, fixed for cell | never |
| `replication.repetition_index` | integer, 1–1024 | planned primary coordinate | never |
| `replication.repetition_count` | integer, 1–1024 | total planned primaries | never |
| `replication.attempt_index` | integer, 1–4096 | contiguous all-attempt count | never |
| `replication.retry_index` | integer, 0–64 | zero primary; positive retry coordinate | never |
| `ordering.seed` | string, 32 bytes | lower-case 32-hex seed | never |
| `ordering.sequence_index` | integer, 1–65536 | one-based derived schedule position | never |
| `ordering.sequence_count` | integer, 1–65536 | exact schedule length | never |
| `cache.state` | string, 4–5 bytes | `cold` or `warm` | never |
| `cache.policy_id` | string, 1–64 bytes | `no-cache.v1` or `cell-private-cache.v1` | never |
| `workspace.fresh` | boolean | exact true | never |
| `workspace.storage_limit_bytes` | integer, 65536–1073741824 | candidate workspace byte ceiling | never |
| `budgets.wall_time_ms` | integer, 1000–3600000 | inclusive wall limit | never |
| `budgets.termination_grace_ms` | integer, 1–60000 | no greater than wall time | never |
| `budgets.model_calls` | integer, 0–10000 | zero only with `none` credential policy | never |
| `budgets.retry_limit` | integer, 0–64 | maximum retry index | never |
| `budgets.input_tokens`, `output_tokens`, `reasoning_tokens` | integer, 0–1000000000 | per-attempt ceilings | never |
| `budgets.cost_amount` | integer, 0–1000000000 | micro-units of currency; no floats | never |
| `budgets.cost_currency` | string, 3 bytes | exact `USD` | never |
| `budgets.artifact_limit_bytes` | integer, 4096–1073741824 | total artifact ceiling | never |
| `telemetry.allowed_sources` | dense array, 1–6 | sorted unique subset of source precedence | never |
| `telemetry.pricing_snapshot_sha256` | string, 64 bytes | immutable snapshot digest | never |
| `evidence.policy_id` | string, 1–64 bytes | exact `private-evidence.v1` | never |
| `results.policy_id` | string, 1–64 bytes | exact `public-result.v2` | never |
| `cleanup.policy_id` | string, 1–64 bytes | exact `strict-cleanup.v1` | never |

The nested `variant`, `runtime`, `credential_policy`, `replication`,
`ordering`, `cache`, `workspace`, `budgets`, `telemetry`, `evidence`,
`results`, and `cleanup` objects have exactly the child keys listed in this
table and no other keys. Cross-field rules are mandatory: retry index is no
greater than retry limit; sequence index is no greater than sequence count; cold
uses `no-cache.v1`; warm uses `cell-private-cache.v1`; every credential policy
matches its adapter; and every variant identity matches its family. Any malformed
config, path, digest, or cross-field relation is `blocked` before candidate
start.

### Canonicalisation and identity digests

Canonical JSON is RFC 8785 JSON Canonicalization Scheme after validation.
Objects sort property names by raw UTF-8 bytes; arrays preserve declared order;
strings preserve raw Unicode scalar sequences; null encodes as UTF-8 `null`;
integers use their shortest base-10 form. UTF-8 is used for every digest input.

`configuration_sha256` is SHA-256 of
`codexlooper.real-run-config.v1\0` followed by canonical JSON for the complete
validated configuration. Every field change creates a new configuration digest.

`runtime_allowlist_sha256` is SHA-256 of
`codexlooper.real-run-runtime-allowlist.v1\0` followed by canonical JSON of
`runtime.allowlist`. It must equal `variant.runtime_allowlist_sha256`.

`variant_identity_sha256` is SHA-256 of
`codexlooper.real-run-variant-identity.v1\0` followed by canonical JSON of
exactly `variant`, `runtime.platform`, `runtime.architecture`,
`runtime.node_version`, `runtime.node_executable_sha256`,
`runtime.isolation_provider_id`, `runtime.isolation_profile_sha256`, and
derived `runtime_allowlist_sha256`.

`configuration_cell_sha256` is SHA-256 of
`codexlooper.real-run-configuration-cell.v1\0` followed by canonical JSON of
exactly `schema`, `track`, `fixtures`, `variant`, `runtime`,
`credential_policy`, `replication.group`, `replication.repetition_count`,
`ordering.seed`, `ordering.sequence_count`, `cache`, `workspace`, `budgets`,
`telemetry`, `evidence`, `results`, and `cleanup`. It excludes only
`replication.repetition_index`, `replication.attempt_index`,
`replication.retry_index`, and `ordering.sequence_index`. A changed included
byte requires a new configuration cell.

Compatibility vectors use the exact RFC 8785 bytes of the literal objects
below. `canonical_config_utf8_sha256` is SHA-256 of those bytes without a
domain prefix. `configuration_sha256` is the domain-separated full-config
digest in the preceding rule. They are calculated once here and B1a copies,
but does not regenerate, these fixed expected values.

Vector A (`controlled_parity`, direct Codex, cold) is this complete object:

~~~json
{"schema":"codexlooper.real-run-config.v1","track":"controlled_parity","fixtures":[{"id":"logic-bug","version":1,"input_sha256":"4444444444444444444444444444444444444444444444444444444444444444"}],"variant":{"id":"direct-codex-cli","adapter_id":"direct-codex-cli.v1","adapter_sha256":"2ca26bbd142c240a263ea0c9a94e15ff1266422c882a7da69e4cda482a0d61a7","executable_path":"/opt/codex/bin/codex","executable_sha256":"5555555555555555555555555555555555555555555555555555555555555555","version":"1.0.0","configuration_sha256":"8de2e677d62cd84edb228c0d5588d3d4cd9da60a388fc05c8d0fd6951f7fb887","runtime_allowlist_sha256":"2f13cc7517006824a947832da0c8537f286b568745f728add4121d5c8b29c1c8"},"runtime":{"platform":"darwin","architecture":"arm64","node_version":"v24.0.0","node_executable_sha256":"6666666666666666666666666666666666666666666666666666666666666666","isolation_provider_id":"macos-seatbelt.v1","isolation_profile_sha256":"7777777777777777777777777777777777777777777777777777777777777777","allowlist":[{"path":"/opt/codex/bin/codex","sha256":"5555555555555555555555555555555555555555555555555555555555555555","mode":493,"role":"executable"}]},"credential_policy":{"id":"direct-codex-openai-env.v1","type":"openai_api_key","required":true,"injection_channel":"child_environment","allowed_environment_key":"OPENAI_API_KEY"},"replication":{"group":"cp-a","repetition_index":1,"repetition_count":1,"attempt_index":1,"retry_index":0},"ordering":{"seed":"0123456789abcdef0123456789abcdef","sequence_index":1,"sequence_count":1},"cache":{"state":"cold","policy_id":"no-cache.v1"},"workspace":{"fresh":true,"storage_limit_bytes":10485760},"budgets":{"wall_time_ms":60000,"termination_grace_ms":2000,"model_calls":1,"retry_limit":0,"input_tokens":100000,"output_tokens":100000,"reasoning_tokens":100000,"cost_amount":1000000,"cost_currency":"USD","artifact_limit_bytes":10485760},"telemetry":{"allowed_sources":["harness_observed","tool_observed"],"pricing_snapshot_sha256":"8888888888888888888888888888888888888888888888888888888888888888"},"evidence":{"policy_id":"private-evidence.v1"},"results":{"policy_id":"public-result.v2"},"cleanup":{"policy_id":"strict-cleanup.v1"}}
~~~

`canonical_config_utf8_sha256=d1d7ddfd48480b05250741c8b5190cdcc7df806cb7edea4760bbf70e95c02a04`; `runtime_allowlist_sha256=2f13cc7517006824a947832da0c8537f286b568745f728add4121d5c8b29c1c8`; `adapter_configuration_sha256=8de2e677d62cd84edb228c0d5588d3d4cd9da60a388fc05c8d0fd6951f7fb887`; `variant_identity_sha256=fef6ed8a8c49e48d2325bee551618673fb7fdbfde3bc5faff4843caad068c0f9`; `configuration_sha256=8b90d3a8a4594b2ad4617b6549a34c5c1de99cd3713ad61e5d4c3b29cf7284e3`; `configuration_cell_sha256=f94e0b461c500c52fb2ffb5e32e90a0db7e2321b09e77a137162955584b79362`.

Vector B (`native_workflow`, CodexLooper, warm) is this complete object:

~~~json
{"schema":"codexlooper.real-run-config.v1","track":"native_workflow","fixtures":[{"id":"logic-bug","version":1,"input_sha256":"4444444444444444444444444444444444444444444444444444444444444444"}],"variant":{"id":"codexlooper-terra-sol","adapter_id":"codexlooper-terra-sol.v1","adapter_sha256":"8a57fe79b79742dd743b9187bb2d21fa7ad63aafdb747fef137c5ba82fafc89e","executable_path":"/opt/codexlooper/bin/runner","executable_sha256":"5555555555555555555555555555555555555555555555555555555555555555","version":"1.0.0","configuration_sha256":"f0b9db40ec8acef8a9f19bfdc9631cf423f283eb5929f79ef393ef6a7a32107f","runtime_allowlist_sha256":"411e804a7bf862e98c8f968a766e4cf4726be17b0f879b26392f0d0de9b7e498"},"runtime":{"platform":"darwin","architecture":"arm64","node_version":"v24.0.0","node_executable_sha256":"6666666666666666666666666666666666666666666666666666666666666666","isolation_provider_id":"macos-seatbelt.v1","isolation_profile_sha256":"7777777777777777777777777777777777777777777777777777777777777777","allowlist":[{"path":"/opt/codexlooper/bin/runner","sha256":"5555555555555555555555555555555555555555555555555555555555555555","mode":493,"role":"executable"},{"path":"/opt/codexlooper/runtime","sha256":"9999999999999999999999999999999999999999999999999999999999999999","mode":493,"role":"runtime"}]},"credential_policy":{"id":"codexlooper-closerouter-env.v1","type":"closerouter_api_key","required":true,"injection_channel":"child_environment","allowed_environment_key":"CLOSEROUTER_API_KEY"},"replication":{"group":"nw-b","repetition_index":1,"repetition_count":2,"attempt_index":1,"retry_index":0},"ordering":{"seed":"fedcba9876543210fedcba9876543210","sequence_index":1,"sequence_count":2},"cache":{"state":"warm","policy_id":"cell-private-cache.v1"},"workspace":{"fresh":true,"storage_limit_bytes":10485760},"budgets":{"wall_time_ms":60000,"termination_grace_ms":2000,"model_calls":2,"retry_limit":0,"input_tokens":100000,"output_tokens":100000,"reasoning_tokens":100000,"cost_amount":1000000,"cost_currency":"USD","artifact_limit_bytes":10485760},"telemetry":{"allowed_sources":["harness_observed","tool_observed"],"pricing_snapshot_sha256":"8888888888888888888888888888888888888888888888888888888888888888"},"evidence":{"policy_id":"private-evidence.v1"},"results":{"policy_id":"public-result.v2"},"cleanup":{"policy_id":"strict-cleanup.v1"}}
~~~

`canonical_config_utf8_sha256=3cdf059666c642e0d17c75dbf28aeef1a972389ffb5b66cd6456d1af8be0fe8c`; `runtime_allowlist_sha256=411e804a7bf862e98c8f968a766e4cf4726be17b0f879b26392f0d0de9b7e498`; `adapter_configuration_sha256=f0b9db40ec8acef8a9f19bfdc9631cf423f283eb5929f79ef393ef6a7a32107f`; `variant_identity_sha256=e272c3bc244d354dbc6b661c1923f268863cc154f8477a6c8a8cd3ba6c702f65`; `configuration_sha256=cdb77efea042e43de8714c5fa6ab2cba347319df5afde5cba1d8692e912bfd9b`; `configuration_cell_sha256=7aa8f727bfd3ba33f55b17d15e2381d59e936cd38d99d6057451b81e827bc363`.

The changed track, adapter, allowlist, cache policy, replication count, and
budget cell yield different cell digests. Planning placeholders are never
accepted by a parser.

## Adapter contracts

Every adapter implements `codexlooper.real-run-adapter.v1`. Trusted input is an
ordinary object with exactly `config`, `configuration_sha256`,
`configuration_cell_sha256`, `variant_identity_sha256`, `workspace_path`,
`task_brief_path`, `task_brief_sha256`, `private_run_path`, and
`prepared_isolation`. The four digests are lower-case SHA-256; each path is a
canonical absolute 1–4096-byte host path; `prepared_isolation` is the exact
provider output; and no trusted input carries a secret. Task brief bytes are a
validated ordinary object with exactly `schema`, `fixture_id`,
`fixture_version`, `fixture_input_sha256`, `candidate_paths`, `public_check_id`,
`track`, `workflow_profile`, and `task_sha256`. Its schema is
`codexlooper.real-run-task.v1`; paths are a sorted dense array of 1–16 safe
relative paths; all IDs are 1–64-byte ASCII IDs; workflow profile is one of
`direct-codex-parity.v1`, `direct-codex-native.v1`, `ralphex-parity.v1`,
`ralphex-native.v1`, `codexlooper-parity.v1`, or `codexlooper-native.v1`; and
`task_sha256` is SHA-256 of `codexlooper.real-run-task.v1\0` plus the canonical
task object without that field.

Untrusted output is an ordered stream of `codexlooper.real-run-event.v1`
records only. The host creates the start event, captures bounded stdout/stderr,
validates every event, and creates the terminal record. Direct Codex receives
the canonical task-brief UTF-8 bytes through a dedicated pipe, 1–16384 bytes,
then the host closes that pipe. Ralphex and CodexLooper receive no stdin. No
adapter inherits host stdin. Stdout and stderr each have a 1,048,576-byte
ceiling; exceeding either ceiling is `invalid`.

Before candidate start, every adapter verifies canonical regular executable,
raw-byte SHA-256, exact version command output, adapter source digest,
adapter-config digest, runtime allowlist digest, configuration digest, and
variant identity. The version command is `[executable, "--version"]`. Its UTF-8
output is 1–128 bytes after one trailing newline removal and equals
`variant.version` exactly. A non-zero version command, unparseable output, or
identity drift is `blocked`.

| Variant / track | Exact argv and cwd | Child environment and credential | Terminal and cleanup contract |
| --- | --- | --- | --- |
| Direct Codex / controlled parity | `[executable, "exec", "--json", "--ephemeral", "--sandbox", "workspace-write"]`; cwd fresh candidate workspace; canonical task brief enters only the dedicated stdin pipe. | Empty base plus `PATH`, `LANG=C`, `LC_ALL=C`, private `HOME`, private `TMPDIR`, private `CODEX_HOME`, and `OPENAI_API_KEY` only. | JSON-line tool events accepted; host emits one terminal after exit and group proof. |
| Direct Codex / native workflow | Identical argv and stdin rule; task brief workflow profile is `direct-codex-native.v1`; cwd fresh workspace. | Identical allowlist and key. | Identical terminal and cleanup contract; never aggregate with parity. |
| Ralphex without hardening / controlled parity | `[executable, task_brief_path]`; cwd fresh workspace. Sole config is canonical private `ralphex-unhardened.ini` bound by `variant.configuration_sha256`. | Empty base plus `PATH`, `LANG=C`, `LC_ALL=C`, private `HOME`, private `TMPDIR`, `RALPHEX_CONFIG`, and `CLOSEROUTER_API_KEY` only. | Bounded stdout/stderr private evidence; declared envelopes only; host creates terminal after group proof. |
| Ralphex without hardening / native workflow | `[executable, task_brief_path]`; task brief schema `ralphex-native-task.v1`; sole config unchanged; cwd fresh workspace. | Same environment. | Same contract; native orchestration is digest-bound task-brief data. |
| CodexLooper Terra/Sol / controlled parity | `[executable, "--benchmark-task", task_brief_path, "--benchmark-track", "controlled_parity"]`; cwd fresh workspace. | Empty base plus `PATH`, `LANG=C`, `LC_ALL=C`, private `HOME`, `TMPDIR`, `CODEX_HOME`, sealed runtime variables, and `CLOSEROUTER_API_KEY` only. | One variant run ID covers all Builder/Reviewer calls; host terminal waits for runner exit and all source instances. |
| CodexLooper Terra/Sol / native workflow | `[executable, "--benchmark-task", task_brief_path, "--benchmark-track", "native_workflow"]`; cwd fresh workspace. | Same environment; Builder is `openai/gpt-5.6-terra` and Reviewer is `openai/gpt-5.6-sol`; CloseRouter endpoint/model bytes are adapter config. | Same terminal; all model calls bind to run and attempt IDs. |

A zero exit yields `candidate_exit(0)` and then one host terminal event. A
non-zero exit yields `candidate_exit(code)` and then one host terminal event.
Host-created timeout and signal events define timeout and signal semantics.
Adapters produce no public artifact.

`ralphex-unhardened.v1` explicitly excludes CodexLooper immutable runtime
manifest, `scripts/run.mjs`, `src/run-hardened.mjs`, Terra/Sol wrappers,
CodexLooper VCS guard, CodexLooper budget state, CodexLooper receipts,
`.codexlooper/**`, and parent-project configuration. It permits only its bound
executable, private config, task brief, candidate workspace, runtime allowlist,
private cache root, and bound credential. Its task brief is the sole plan input.

## IsolationProvider contract

`IsolationProvider` has exactly these host-owned methods:

| Method | Trusted input and output | Error / status | Side effects and evidence |
| --- | --- | --- | --- |
| `probeCapabilities(input)` | canonical provider executable, platform, architecture, roots, requested boundaries -> `CapabilityRecord` | missing or unsupported required capability -> `blocked` | identity read only; capability digest |
| `prepareLaunch(input)` | validated config, workspace, private roots, adapter argv/env, capability -> `PreparedIsolationLaunch` | malformed profile, root, descriptor closure, or identity -> `blocked` | private staging only; preparation evidence |
| `verifyPreparation(record)` | prepared launch plus host observations -> `IsolationPreparationEvidence` | mismatch -> `blocked` | validates profile and provider identity before launch |
| `verifyTermination(record)` | process identity and host observations -> `IsolationTerminationEvidence` | absent proof -> `invalid` | read-only process inspection |
| `verifyCleanup(record)` | roots, process proof, retention policy -> `IsolationCleanupEvidence` | failed or unverifiable cleanup -> `invalid` | deletes declared private run paths only |

`CapabilityRecord` schema is `codexlooper.isolation-capability.v1` with exactly
`provider_id`, `provider_version`, `provider_executable_sha256`, `platform`,
`architecture`, `filesystem_read_boundary`, `filesystem_write_boundary`,
`network_boundary`, `home_boundary`, `parent_repository_boundary`,
`git_history_boundary`, `hidden_verifier_boundary`, `credential_boundary`,
`environment_boundary`, `file_descriptor_boundary`,
`process_inspection_boundary`, `descendant_boundary`,
`profile_identity_sha256`, and `real_run_eligible`. All boundary fields are
exactly `proved`, `unsupported`, `unavailable`, or `test_fake_only`. Every field
is required. `real_run_eligible` is true only when every requested boundary is
`proved`.

The fake provider ID is `fake-isolation.v1`. It reports every boundary as
`test_fake_only` and always reports `real_run_eligible: false`. It cannot permit
a real run, assert leakage safety, or replace a real provider attestation.

The only planned real provider is `macos-seatbelt.v1`. Its local executable
candidate is `/usr/bin/sandbox-exec`. The host validates its canonical
regular-file identity and SHA-256. Availability alone proves nothing. The
profile is canonical UTF-8 generated from sorted read roots, write roots,
executable roots, private evidence root, candidate workspace, and private cache
root; it is SHA-256 hashed after
`codexlooper.macos-seatbelt-profile.v1\0` and equals
`runtime.isolation_profile_sha256`.

Seatbelt denies network, home access, parent repository access, Git history,
hidden verifier, reference repair, harness source, private evidence, unlisted
runtime, process inspection, and inherited descriptor access. It permits only
candidate-workspace writes, declared cache writes, and immutable read roots.
Symlinks are resolved before profile creation and after staging. macOS proof
uses adversarial fakes for each denied and allowed path. Linux and every other
platform have no real provider in this plan: missing provider is `blocked` before
candidate start.

## Credential policy contract

Credential policy schema is `codexlooper.credential-policy.v1` with exactly
`schema`, `policy_id`, `credential_type`, `bound_adapter_id`, `required`,
`injection_channel`, `allowed_environment_key`, `source_handle_type`,
`minimum_length`, `maximum_length`, `allowed_format`, `redaction_policy_id`,
`forbidden_channels`, `remove_environment_keys`, and `public_metadata_fields`.
All fields are required. IDs are 1–64-byte ASCII IDs. Type is `none`,
`openai_api_key`, or `closerouter_api_key`. Source handle is exact
`private_host_handle`. Minimum is 0–4096; maximum is 1–4096 and not below
minimum. Format is `none`, `opaque_ascii_8_4096`, or
`opaque_ascii_16_4096`. Forbidden channels are the sorted exact array
`argv`, `stdin`, `working_tree_file`, `temporary_project_file`,
`shell_expansion`, `public_evidence`, `public_result`. Removed key arrays are
sorted dense 1–32 ASCII keys. Public metadata is exactly the sorted array
`credential_policy_id`, `credential_type`, `credential_required`, and
`credential_injection_channel`.

| Policy ID | Adapter | Type, required, exact key | Source and bound |
| --- | --- | --- | --- |
| `direct-codex-openai-env.v1` | `direct-codex-cli.v1` | `openai_api_key`, true, `OPENAI_API_KEY` | private handle; 8–4096 opaque ASCII |
| `ralphex-closerouter-env.v1` | `ralphex-unhardened.v1` | `closerouter_api_key`, true, `CLOSEROUTER_API_KEY` | private handle; 8–4096 opaque ASCII |
| `codexlooper-closerouter-env.v1` | `codexlooper-terra-sol.v1` | `closerouter_api_key`, true, `CLOSEROUTER_API_KEY` | private handle; 8–4096 opaque ASCII |
| `no-credential.v1` | fake adapters only | `none`, false, `NONE` | no handle; length zero |

The child environment starts empty. It removes `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `CLOSEROUTER_API_KEY`, `CODEX_API_KEY`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`, and
every key matching `*_TOKEN`, `*_SECRET`, or `*_KEY` before adding the one
authorised key. Missing policy, policy/adapter mismatch, and missing private
handle are `blocked` before start. Redaction failure, argv exposure, temporary
file exposure, or descendant leakage is `invalid`. Gate B uses deterministic
dummy values only; it proves contract paths, never a real credential.

## Host lifecycle and deterministic process-tree proof

The host records `leader_pid`, `process_group_id`, `leader_start_identity`,
`known_descendant_identities`, `termination_requested`, `sigterm_receipt`,
`grace_deadline_monotonic_ms`, `sigkill_receipt`, `leader_reaped`,
`descendants_reaped_or_absent`, and `process_group_empty`. Process identity is
PID plus platform start identity: macOS uses proc_pidinfo start data; Linux uses
`/proc/<pid>/stat` start time. A differing start identity is PID reuse and not
the recorded process.

The host creates a new process group, samples leader and descendants at start and
after every signal, sends SIGTERM at timeout, records delivery as a signal
receipt only, and polls with a monotonic clock each 25 ms until grace expiry. It
then sends SIGKILL if a matching group member remains, polls each 25 ms for at
most 5000 ms, reaps the leader, and proves every known descendant reaped or
absent with matching identity and the process group empty. Linux uses procfs;
macOS uses a supported host process API bound in evidence. An unavailable API is
`invalid`. A zombie remains present until reaped. A successful kill call proves
delivery only. Unprovable group emptiness is `invalid`.

The earlier CI observation where a SIGTERM-ignoring child remained visible after
564 ms is a useful signal, not a Gate-B proof. Immediate `kill(pid, 0)` checks
are timing-sensitive. Fake process tests use host-only `ready`, `child_spawned`,
`sigterm_received`, `leader_exited`, and `child_exited` records to synchronise
setup. Those records never replace real host observation.

## Raw events, telemetry, and pricing provenance

Raw event schema is `codexlooper.real-run-event.v1`. Each event has exactly
`schema`, `run_id`, `attempt_index`, `source`, `source_instance_id`,
`sequence`, `event_id`, `event_type`, `monotonic_offset_ms`, and
`payload_sha256`. IDs are ASCII 1–64 bytes except `event_id`, which is
32–128 lower-case hex bytes. Attempt is 1–4096; sequence is 1–1000000; offset
is 0–3600000; source is `adapter`, `tool`, `provider`, `receipt`, or `harness`.
Event type is `candidate_started`, `model_call_started`,
`model_call_completed`, `tool_usage_observed`, `provider_usage_observed`,
`receipt_usage_observed`, `candidate_terminal`, `telemetry_terminal`,
`candidate_timeout`, `candidate_signal`, or `candidate_exit`.

Sequence starts at one and strictly increases per source instance. Event IDs are
unique per attempt. The same event ID and payload digest is counted once; the
same ID with a different digest is `invalid`. A gap, decrease, malformed payload,
multiple terminal events, or required missing terminal event is `invalid`.
Adapter, tool, provider, and receipt data is untrusted. Harness timing and
lifecycle are independent.

Each token field (`input_tokens`, `cache_tokens`, `output_tokens`,
`reasoning_tokens`) contains exactly `value`, `status`, `source`, and
`evidence_sha256`. Value is integer 0–1000000000 only for observed status and
otherwise null. Fixed precedence is `provider_observed`, `tool_observed`,
`receipt_derived`, `harness_observed`, `unavailable`, `invalid`,
`not_applicable`. Two non-null values disagreeing across sources are `invalid`;
no value silently overwrites another. Harness supplies call count and setup,
execution, verifier, and total durations only.

Pricing snapshot schema is `codexlooper.pricing-snapshot.v1` with exactly
`schema`, `provider`, `model`, `currency`, `input_price`, `cache_price`,
`output_price`, `reasoning_price`, `unit`, `valid_from`, `source_identity`,
and `snapshot_sha256`. Provider/model/source identity are 1–128-byte strings;
currency is three-byte ISO uppercase; timestamp is 20–35-byte UTC ISO; prices
are 0–1000000000 integer micro-USD per million tokens; unit is exact
`micro_usd_per_million_tokens`. Snapshot digest is SHA-256 of
`codexlooper.pricing-snapshot.v1\0` plus canonical JSON without its digest
field. Cost is `observed` only when used tokens and snapshot are observed.
Existing `MODEL_PRICING` is historical source evidence, not this snapshot.

## Result strategy and exhaustive status matrix

Phase B uses `codexlooper.benchmark-result.v2`. v1 stays unchanged; Phase-A
results stay v1; Phase-B results use v2; a reporter reads both but never equates
them; no automatic conversion or implicit default exists. v2 has test state
`not_run` with null exit code for pre-start outcomes.

| Scenario | Phase | Started | Status | Termination | Test | Usage | Required evidence | Retry |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| unknown config field | config | no | blocked | not_started | not_run | not_applicable | config rejection | no |
| config bounds error | config | no | blocked | not_started | not_run | not_applicable | config rejection | no |
| missing tool | identity | no | blocked | not_started | not_run | not_applicable | tool lookup | no |
| executable hash mismatch | identity | no | blocked | not_started | not_run | not_applicable | executable identity | no |
| version mismatch | identity | no | blocked | not_started | not_run | not_applicable | version digest | no |
| adapter identity mismatch | identity | no | blocked | not_started | not_run | not_applicable | adapter digest | no |
| missing isolation provider | preparation | no | blocked | not_started | not_run | not_applicable | capability record | no |
| unsupported isolation capability | preparation | no | blocked | not_started | not_run | not_applicable | capability record | no |
| sandbox profile mismatch | preparation | no | blocked | not_started | not_run | not_applicable | profile evidence | no |
| credential policy mismatch | credential | no | blocked | not_started | not_run | not_applicable | policy evidence | no |
| missing credential | credential | no | blocked | not_started | not_run | not_applicable | missing-handle evidence | no |
| candidate start failure | launch | no | blocked | not_started | not_run | unavailable | launch error | transient_tool_start only |
| ordinary non-zero exit | execution | yes | failed | completed | executed_nonzero | unavailable | exit plus group proof | no |
| timeout | execution | yes | failed | timed_out | not_run | unavailable | timeout plus group proof | no |
| SIGTERM ignored, then group empty | termination | yes | failed | timed_out | not_run | unavailable | signal receipts plus group proof | no |
| descendant remains | termination | yes | invalid | timed_out | not_run | invalid | failed termination proof | no |
| unauthorized file | snapshot | yes | invalid | completed | not_run | unavailable | delta | no |
| hidden-verifier access attempt | enforcement | yes | invalid | interrupted | not_run | invalid | sandbox denial | no |
| public-check modification | snapshot | yes | invalid | completed | not_run | unavailable | public-check identity plus delta | no |
| malformed telemetry | telemetry | yes | invalid | completed | not_run | invalid | event rejection | no |
| successful verifier with optional telemetry absent | telemetry | yes | passed | completed | executed_zero | unavailable | host terminal plus verifier | no |
| duplicate terminal event | telemetry | yes | invalid | completed | not_run | invalid | duplicate event | no |
| missing terminal event | telemetry | yes | invalid | completed | not_run | invalid | sequence evidence | no |
| pricing drift | telemetry | yes | invalid | completed | not_run | invalid | snapshot identity | no |
| artifact overflow | finalisation | yes | invalid | completed | executed_zero | unavailable | overflow staging | no |
| interrupted result write | finalisation | yes | invalid | completed | executed_zero | unavailable | recovery evidence | no |
| private evidence missing | finalisation | yes | invalid | completed | executed_zero | invalid | evidence manifest | no |
| cleanup failure | cleanup | yes | invalid | completed | executed_zero | unavailable | cleanup attestation | no |
| credential redaction failure | evidence | yes | invalid | completed | executed_zero | invalid | redaction scan | no |

Passed requires zero hidden verifier, identities, proved isolation, group-empty
termination, telemetry statuses allowed by the bound telemetry policy, complete evidence, and
complete cleanup. Failed is only an intact started ordinary candidate outcome.
Blocked is only a missing precondition before start. Invalid is any integrity,
isolation, evidence, telemetry, artifact, or cleanup proof failure.

## Evidence, artifacts, and cleanup attestation

The host derives absolute roots from private runtime configuration. Public data
contains only policy IDs, logical run ID, safe relative names, and digests.

~~~text
private_root/runs/<run-id>/events/
private_root/runs/<run-id>/process/
private_root/runs/<run-id>/telemetry/
private_root/runs/<run-id>/verifier/
private_root/runs/<run-id>/credential/
private_root/runs/<run-id>/cleanup/
private_root/runs/<run-id>/staging/
public_root/results/<run-id>.json
public_root/manifests/<run-id>.json
~~~

Roots are canonical, host-owned, non-symlinked, and outside candidate workspace.
Private directories/files use 0700/0600; public directories/files use 0755/0644.
Files use create-exclusive staging names
`.<logical-name>.<run-id>.<attempt-index>.tmp`, set mode before content, stay
within size limit, file-fsync, atomically rename in the same parent, then
parent-directory fsync when supported. Without parent-directory sync, the
evidence manifest records `durability=rename_only`; that result is not durable
but remains valid when all integrity checks succeed.

Symlink, hardlink, unknown name, collision, non-owner, oversize, untracked
staging path, or Git-tracked private artifact is invalid. Private roots are
Git-excluded before creation. Startup removes only stale staging paths for the
same run ID; every other stale or tampered path is invalid. Public result and
manifest are retained. Private evidence is retained until cleanup verification,
then removed; invalid-run evidence stays private for 30 days.

Evidence manifest `codexlooper.evidence-manifest.v1` has exactly `schema`,
`run_id`, `attempt_index`, `policy_id`, `entries`, `durability`, and
`manifest_sha256`. Entries have `logical_name`, `class`, `sha256`,
`size_bytes`, and `mode`. Class is `event`, `process`, `telemetry`,
`verifier`, `credential`, `cleanup`, `public_result`, or `public_manifest`.
Digest is SHA-256 of `codexlooper.evidence-manifest.v1\0` plus canonical JSON
without its digest field.

Cleanup attestation `codexlooper.cleanup-attestation.v1` has exactly `schema`,
`run_id`, `workspace_removed`, `staging_removed`, `private_retention_applied`,
`unexpected_paths`, `remaining_processes`, `remaining_process_group`,
`remaining_file_descriptors_if_observable`, `verification_time_ms`, `policy_id`,
`evidence_sha256`, and `status`. Booleans are required; arrays are sorted dense
safe IDs, 0–128; time is 0–3600000; status is `complete`, `failed`, or
`unverifiable`. Only `complete` contributes to passed.

## Repetition, retry, ordering, and cache state machine

A repetition is a planned independent scored primary attempt in one
configuration cell. A retry is an extra attempt for one allowlisted reason. An
attempt is every started or pre-start blocked execution with a unique run ID.

`replication.group` is the replication group. `repetition_index` identifies the
planned primary in 1..repetition_count. `retry_index=0` identifies the primary.
`attempt_index` is contiguous across all attempts in the group. Every retry has
a new run ID and increments attempt and retry indexes. A retry never replaces a
primary result; every outcome appears in the public manifest.

The only retry reasons are `transient_tool_start`,
`declared_provider_unavailable`, and
`operator_authorised_infrastructure_retry`. The last creates a host intervention
event and cannot change config, adapter, fixture, budget, order, or credential.
Verifier failure, unauthorized file, credential leak, isolation failure,
telemetry contradiction, cleanup failure, artifact failure, and benchmark task
failure are never retryable.

Ordering sorts fixture and variant IDs by raw UTF-8 bytes, hashes
`codexlooper.real-run-order.v1\0` plus the 32-byte seed and canonical cell IDs,
then applies cyclic Latin rotation: repetition r begins at
`(r - 1) mod variant_count` and visits each variant once; fixtures use the
digest-sorted list. Sequence index is one-based; sequence count equals fixture
count times variant count times repetition count. B1c pins two schedule vectors.

Cold exposes no cache root. Warm exposes only
`private_root/cells/<configuration-cell-sha256>/cache`, mode 0700, host owned,
hashed in runtime allowlist, named `cell-private-cache.v1`. Cache never crosses
cell or variant identity and never contains fixture source, hidden verifier,
reference repair, public result, or credential. Candidate workspace is fresh for
every scored attempt.

## Gate-B proof matrix

| ID | Scenario | Planned test / fake | Platform and proof | Expected status / termination | Required evidence | Deterministic observation and flake control | Gate-B blocking |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GB-01 | successful candidate | `test/real-run-gate-b.test.mjs`, success fake | portable CI | passed / completed | verifier, event, cleanup manifests | ready/terminal handshake | yes |
| GB-02 | ordinary candidate failure | gate-b, non-zero fake | portable CI | failed / completed | exit and group proof | fixed exit code | yes |
| GB-03 | timeout | `test/real-run-lifecycle.test.mjs`, blocking fake | portable CI | failed / timed_out | timeout and group proof | ready handshake and monotonic fake clock | yes |
| GB-04 | candidate ignores SIGTERM | lifecycle, signal fake | portable CI | failed / timed_out | SIGTERM/SIGKILL receipts | child control records; no immediate PID check | yes |
| GB-05 | descendant survives | lifecycle, child fake | portable CI | invalid / timed_out | failed termination proof | child_spawned/child_exited handshake | yes |
| GB-06 | unauthorized file | isolation, writer fake | portable CI | invalid / completed | delta | sealed snapshot | yes |
| GB-07 | symlink escape | isolation, symlink fake | portable CI | invalid / interrupted | denial and delta | fixed path probe | yes |
| GB-08 | protected-path access | isolation, reader fake | macOS local and CI | invalid / interrupted | Seatbelt denial | real Seatbelt denial | yes |
| GB-09 | forbidden environment | adapter, env-dump fake | portable CI | invalid / completed | env/redaction evidence | fixed JSON dump | yes |
| GB-10 | hidden-verifier access | isolation, reader fake | macOS local and CI | invalid / interrupted | denial | real Seatbelt denial | yes |
| GB-11 | public-check modification | evaluator, modifier fake | portable CI | invalid / completed | delta and check identity | fixed edit | yes |
| GB-12 | malformed telemetry | telemetry, malformed fake | portable CI | invalid / completed | rejection digest | fixed bytes | yes |
| GB-13 | contradictory telemetry | telemetry, two-source fake | portable CI | invalid / completed | field-conflict evidence | fixed event order | yes |
| GB-14 | duplicate terminal event | telemetry, duplicate fake | portable CI | invalid / completed | duplicate event | fixed sequence | yes |
| GB-15 | missing terminal / early exit | telemetry, early-exit fake | portable CI | invalid / completed | sequence evidence | close pipe after ready | yes |
| GB-16 | executable/config/adapter drift | identity, substituted records | portable CI | blocked / not_started | identity rejection | pinned bytes/digests | yes |
| GB-17 | pricing snapshot drift | telemetry, drift snapshot | portable CI | invalid / completed | pricing identity | fixed snapshot pair | yes |
| GB-18 | missing tool/isolation mechanism | adapter/isolation tests | portable CI | blocked / not_started | tool/capability record | assert no process start | yes |
| GB-19 | cleanup failure | evidence, retained-path fake | portable CI | invalid / completed | cleanup attestation | fixed retention mismatch | yes |
| GB-20 | artifact overflow/interrupted write | evidence, bounded writer fake | portable CI | invalid / completed | staging manifest | injected write boundary | yes |
| GB-21 | parity/native track mixing | config, mixed records | portable CI | blocked / not_started | cell validation | canonical projection vector | yes |
| GB-22 | retry omission/order seed mismatch | config, schedule fake | portable CI | invalid / completed | attempt/schedule manifest | pinned vectors | yes |
| GB-23 | credential redaction/descendant leak | credential, dummy-secret fake | portable CI | invalid / completed | private redaction evidence | exact sentinel scan | yes |

Portable CI executes schemas, fakes, lifecycle, telemetry, evidence, and fake
provider tests. macOS local proof and macOS CI execute actual Seatbelt allow/deny
tests. Missing macOS provider is a tested blocked result, never a skipped safety
success. No Gate-B proof uses a real model, provider, or credential.

## Future file-level implementation plan

### B1a — Configuration and variant identity contracts

After a future plan PASS, B1a changes only:

~~~text
benchmarks/real-run/config.v1.mjs
benchmarks/real-run/variant-identity.mjs
test/real-run-config.test.mjs
test/real-run-variant-identity.test.mjs
~~~

B1a implements strict parsers, ordinary-data validation, bounds,
canonicalisation, configuration/cell/runtime/variant digests, and pinned vectors.
It contains no adapter import, process start, runner, isolation, credential,
telemetry process, artifact write, result v2, Phase-A-v1 change, tool invocation,
or model invocation.

### B1b — Result v2 contract

B1b starts only after a separate B1a review. It implements only the result-v2
parser, status/termination matrix, and public result contract. It has no process,
adapter, provider, or credential code.

### B2 onward

B2 implements adapters and fakes after B1b; B3 isolation and lifecycle; B4
telemetry, evidence, and cleanup; B5 the complete offline Gate-B proof. Every
section needs separate authorisation and review. No section modifies Phase-A
hidden verifiers, reference repairs, v1 semantics, runtime trust root, provider
credential handling, existing receipts, branch authority, or live-smoke
authorisation.

## Second planning revision — complete proof contracts

This section is authoritative where it is more specific than an earlier
section. The plan status remains **Planning draft — not executable,
implementation not authorised**. Original review: `CHANGES_REQUIRED`, 5 P1,
5 P2. First re-review: `CHANGES_REQUIRED`, 4 P1, 6 P2.

### Adapter configuration and source identity

All adapter configuration objects are ordinary data, UTF-8 RFC 8785 JSON,
exact-key, secret-free, and reject unknown keys. Their digest is SHA-256 of
`<schema>\0` followed by their canonical JSON bytes. Each binds its `track`,
matching source manifest digest, executable identity, and credential-policy ID.
The direct schema `codexlooper.adapter-config.direct-codex.v1` has exactly
`schema,track,adapter_id,entrypoint_path,entrypoint_sha256,executable_path,
executable_sha256,version_command,expected_version,model_identity,
approval_policy,sandbox_mode,working_directory_policy,stdin_policy,
output_policy,telemetry_policy,credential_policy_id`; strings are ASCII 1–256
bytes except absolute canonical non-symlink paths (1–4096), hashes are 64 lower
hex, and `version_command` is exactly `[executable_path,"--version"]`.
`approval_policy=never`, `sandbox_mode=workspace-write`, and the policies are
the exact IDs named in the direct adapter row.

`codexlooper.adapter-config.codexlooper.v1` has exactly
`schema,track,adapter_id,builder_profile,reviewer_profile,terra_model_identity,
sol_model_identity,closerouter_endpoint_identity,closerouter_non_secret_config,
builder_budget,reviewer_budget,overall_budget,selected_task_policy,
runtime_manifest_sha256,receipt_policy_id,terminal_event_policy`. Profiles and
policy IDs are ASCII 1–128; models are exact `openai/gpt-5.6-terra` and
`openai/gpt-5.6-sol`; endpoint config is an exact-key object
`base_url,protocol` of 1–256-byte non-secret strings; each budget is exact-key
`model_calls,token_limit`, integers 0–10000 and 0–1000000000; overall limits
are at least each component limit.

`codexlooper.adapter-config.ralphex-unhardened.v1` has exactly
`schema,track,adapter_id,executable_path,executable_sha256,expected_version,
task_brief_sha256,renderer_identity_sha256,ini_sha256,credential_policy_id,
output_policy,telemetry_policy`. Its authoritative input is JSON, never an
unbound hand-written INI. The deterministic renderer emits UTF-8, LF only,
sections `[ralphex]`, `[task]`, `[output]` in that order; keys in raw-UTF-8
lexicographic order; `key=value\n`; no comments, blank lines, or other spaces;
one final LF. Its configuration digest is SHA-256 of
`codexlooper.adapter-config.ralphex-unhardened.v1\0 || canonical-json ||
renderer_identity_sha256-as-32-bytes || rendered-ini-bytes`.

`codexlooper.adapter-source-manifest.v1` has exactly `schema,adapter_id,
adapter_version,entrypoint,source_files,generated_files,renderer_identity_sha256,
manifest_sha256`; files have exactly `path,mode,sha256`, paths are safe relative
1–4096-byte paths sorted by raw UTF-8, mode is 0–511, and hashes are 64 lower
hex. `generated_files` uses the same schema and is empty except the deterministic
Ralphex INI renderer output. Symlinks and unknown, absent, or extra files are an
identity mismatch. `adapter_sha256` is SHA-256 of
`codexlooper.adapter-source-manifest.v1\0 || canonical manifest without
manifest_sha256`; configuration/source mismatch is blocked before launch.

### IsolationProvider evidence and real-run gate

All records below are exact-key ordinary-data, canonical JSON, secret-free, and
have their named SHA-256 domain prefix over the record without its final digest.
IDs are ASCII 1–64, hashes 64 lower hex, paths canonical absolute 1–4096, arrays
dense and bounded 0–128. `codexlooper.isolation-capability.v1` retains the
earlier exact fields; all mandatory requested boundaries must be `proved`.
`codexlooper.isolation-prepared-launch.v1` has exactly `schema,provider_id,
provider_version,capability_record_sha256,profile_sha256,root_binding_sha256,
run_id,configuration_cell_sha256,executable_path,argv,cwd,environment_keys,
read_roots,write_roots,network_policy,process_policy,prepared_launch_sha256`.
`argv` is 1–64 UTF-8 arguments of 0–16384 bytes, environment contains names only,
and roots are sorted canonical paths.

`codexlooper.isolation-preparation-evidence.v1` has exactly `schema,run_id,
provider_id,provider_executable_sha256,capability_record_sha256,
prepared_launch_sha256,profile_sha256,root_binding_sha256,
validated_executable_sha256,validated_runtime_paths_sha256,real_run_eligible,
checks,evidence_sha256`; each check is exact-key `id,status`, IDs are ASCII
1–64 and status is `proved,failed,unsupported,unavailable,test_fake_only`.
`codexlooper.isolation-termination-evidence.v1` has exactly `schema,run_id,
provider_id,prepared_launch_sha256,leader_identity,process_group_identity,
known_descendants,signals,polls,leader_reaped,all_known_descendants_absent,
process_group_empty,observation_complete,termination_status,evidence_sha256`.
Identities are exact-key `pid,start_tvsec,start_tvusec`; signals are exact-key
`signal,monotonic_ms,delivery_status`; polls are exact-key `monotonic_ms,
snapshot_sha256,matching_members,unknown_group_members,zombies` and max 256.
`codexlooper.isolation-cleanup-evidence.v1` has exactly `schema,run_id,
provider_id,prepared_launch_sha256,workspace_removed,staging_removed,
unexpected_paths,remaining_processes,remaining_process_group,retention_applied,
cleanup_status,evidence_sha256`.

A host starts a candidate only when capability eligibility is true; provider IDs,
capability digest, profile digest, root-binding digest, cell digest, and provider
executable identity all match; every mandatory check is `proved`; no mandatory
check is `test_fake_only`; and preparation evidence is complete. Any failure is
`outcome.status=blocked`, `candidate_started=false`. `fake-isolation.v1` always
returns `real_run_eligible=false`; the consumer cannot override it.

### Concrete macOS process observation

Local SDK headers expose `libproc`, `proc_listallpids`, `proc_listpids`,
`proc_pidinfo`, `PROC_PIDTBSDINFO`, and `proc_bsdinfo`; the chosen future host
helper therefore uses those APIs, `waitpid`, and `killpg`. A snapshot enumerates
all PIDs with `proc_listallpids`, reads `PROC_PIDTBSDINFO`, and records PID,
PPID, PGID, state, `pbi_start_tvsec`, and `pbi_start_tvusec`. Identity is
`pid,start_tvsec,start_tvusec`; same PID with another start time is new. Known
descendants remain known after PPID/PGID changes. An unknown matching-PGID member,
an escaped known descendant, unavailable snapshot, or identity mismatch is
`invalid`. `killpg` success is only signal delivery. Leader and direct host
children are reaped with `waitpid`; zombies remain present until reaped.

The monotonic poll interval is 25 ms; after SIGTERM it polls until the configured
grace deadline, then SIGKILL, then at most 5000 ms. Group emptiness requires
three consecutive complete empty snapshots, at least 25 ms apart. PGID reuse is
rejected by identity comparison. Fake `ready,child_spawned,sigterm_received,
leader_exited,child_exited` handshakes control test setup only; Gate B requires
matching independent host snapshots. If this helper is not implemented and
proven, `macos-seatbelt.v1.real_run_eligible=false`; there is no best-effort run.

### Events, usage, evidence files, and deterministic ordering

Each `codexlooper.real-run-event.v1` has exactly `schema,run_id,attempt_index,
source,source_instance_id,sequence,event_id,event_type,monotonic_offset_ms,
payload,payload_sha256,event_sha256`. Payload is a bounded ordinary-data
discriminated union: `candidate_started`=`workspace_sha256`; `model_call_started`
=`call_id,model_identity`; `model_call_completed`=`call_id,exit_kind`;
`tool_usage_observed,provider_usage_observed,receipt_usage_observed`=
`input_tokens,cache_tokens,output_tokens,reasoning_tokens`; `candidate_terminal`
=`exit_code,signal`; `telemetry_terminal`=`complete`; `candidate_timeout`=
`deadline_monotonic_ms`; `candidate_signal`=`signal`; `candidate_exit`=`exit_code`.
All identifiers are ASCII 1–64, token payloads are exact-key metrics
`value,status,source,evidence_sha256`. `payload_sha256` hashes canonical payload
bytes with `codexlooper.real-run-event-payload.v1\0`; `event_sha256` hashes the
event without itself using `codexlooper.real-run-event.v1\0`.

The only metric statuses are `observed,unavailable,invalid,not_applicable`.
Observed has a non-negative integer and evidence; unavailable/invalid/not-applicable
have null value; source is present only for observed. An observed zero is `0` plus
evidence, never a synthetic default. `codexlooper.telemetry-policy.v1` states for
each source/event/metric whether it is required or optional; every status-matrix
row references this policy and therefore uses exactly one status per metric.

Parents are component-by-component `lstat` checked: canonical, under bound root,
non-symlink, host UID owned, and not group/world writable. Private staging opens
with `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW`, mode 0600, then `fstat` requires a
regular single-link host-owned file and expected mode. Publication is exclusive
staging open → bounded write → fsync → close → fstat/lstat reconciliation →
exclusive target check → same-filesystem atomic rename → final lstat/fstat →
parent fsync. Public files stage private then receive fixed public mode. Missing
`O_NOFOLLOW`, atomic rename, or ownership proof blocks; no fallback exists.
Manifest entries are exact-key `logical_id,relative_path,kind,size_bytes,mode,
owner_policy,sha256,retention_class,created_monotonic_ms,source_evidence_sha256`:
ASCII IDs 1–64, safe paths 1–1024, kind/retention/owner policy ASCII 1–64, size
0–1073741824, mode 0–511, time 0–3600000, hashes 64 lower hex.

Ordering uses `configuration_cell_sha256`, not a cell ID. Within each track,
fixtures sort by `fixture_identity_sha256`, cells by cell digest, variants by
variant digest; ties use full digest bytes. For each fixture and N-variant block,
SHA-256 input is `codexlooper.ordering.v1\0 || seed_bytes(16) || fixture_digest
bytes(32) || block_index_u32be`; first eight bytes are unsigned big-endian,
`base_offset=value mod N`, and repetition r uses `(base_offset+r) mod N`.
One variant always has offset zero; incomplete final blocks use their existing
members only. Each position is stored. Cold/warm cache roots remain cell-bound.
Schedule vector S1: seed `00000000000000000000000000000000`, fixture `ff…ff`,
variants `11…11,22…22`, block hash
`d99da12d0920f1d0489f784a42dcf7815c1b2a45963bd5ed4c0ea99e6d1a1b3d`,
orders repetitions 1/2 as `11…11,22…22` then `22…22,11…11`. S2: seed
`0123456789abcdef0123456789abcdef`, fixture `ee…ee`, the same variants, block
hash `a905f4209b774b9683bcc99f8b22df8ef5d2e3b5c0af37541a9e616522740518`,
has the same expected two positions. (`11…11` and `ff…ff` mean 64 repetitions.)

### B1a/B1b/B1c and Gate B

B1a remains config and variant identity only. B1b remains result v2 only. B1c is
after independent B1b review and changes only `benchmarks/real-run/schedule.v1.mjs`
and `test/real-run-schedule.test.mjs`; it implements ordering parsing, seed
validation, positions, and S1/S2, with no process, adapter, credential,
telemetry, artifact, or model work. Only after independent B1c review may adapter
or runner work start.

The Gate-B matrix is expanded by this mandatory row format: `ID | Scenario |
Planned test file | Fixture/fake path | Platform | Location | Precondition |
Provider | started | status | termination | public fields | private evidence |
observation | failure assertion | flake control | blocking`. GB-01..23 use,
respectively, complete paths under `test/real-run-gate-b-{success,process,
isolation,telemetry,evidence,ordering,credential}.test.mjs` and fixtures under
`test/fixtures/real-run/`. Every row names one of: `fake-isolation.v1,
contract-only,false`; `macos-seatbelt.v1,local-Gate-B`; `none,blocked`; or
`provider-mismatch,blocked`. Every row asserts `outcome.status,
termination.kind,termination.signal,usage.input_tokens.status,cleanup.status,
configuration_cell_sha256,variant_identity_sha256`; names the applicable
preparation/termination/event/manifest/cleanup schema; uses its named handshake
plus host observation; and asserts the stated invalid/blocked/failed result.
GB-01 success, GB-02 nonzero, GB-03 timeout, GB-04 ignored SIGTERM, GB-05
descendant, GB-06 unauthorized write, GB-07 symlink, GB-08 protected path,
GB-09 environment, GB-10 hidden verifier, GB-11 public check, GB-12 malformed
telemetry, GB-13 conflict, GB-14 duplicate terminal, GB-15 missing terminal,
GB-16 identity drift, GB-17 pricing drift, GB-18 missing provider, GB-19 cleanup,
GB-20 write interruption, GB-21 track mixing, GB-22 schedule, and GB-23
credential leak are all blocking. macOS rows run local and macOS CI; missing real
provider is blocked, never skipped.

The following exact table replaces the shorthand matrix above. `PF` means the
seven public fields `outcome.status,termination.kind,termination.signal,
usage.input_tokens.status,cleanup.status,configuration_cell_sha256,
variant_identity_sha256`; each cell spells out its evidence rather than inheriting
it from another row.

| ID | Scenario | Planned test file | Fixture or fake executable | Platform | Execution location | Required precondition | Bound isolation provider | Expected candidate_started | Expected outcome.status | Expected termination | Required public result fields | Required private evidence | Deterministic observation method | Failure assertion | Flake control | Gate-B blocking |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GB-01 | success | `test/real-run-gate-b-success.test.mjs` | `test/fixtures/real-run/success.mjs` | portable | CI | valid config | fake provider, contract-only, false | true | passed | completed | PF | event.v1, cleanup-attestation.v1 | ready/terminal handshake | any mismatch fails | handshake | yes |
| GB-02 | nonzero | `test/real-run-gate-b-success.test.mjs` | `test/fixtures/real-run/nonzero.mjs` | portable | CI | valid config | fake provider, contract-only, false | true | failed | completed | PF | termination-evidence.v1 | fixed exit 7 | wrong status fails | fixed code | yes |
| GB-03 | timeout | `test/real-run-gate-b-process.test.mjs` | `test/fixtures/real-run/blocking.mjs` | portable | CI | started fake | fake provider, contract-only, false | true | failed | timed_out | PF | termination-evidence.v1 | ready plus monotonic clock | no timeout fails | bounded clock | yes |
| GB-04 | ignored TERM | `test/real-run-gate-b-process.test.mjs` | `test/fixtures/real-run/ignore-term.mjs` | portable | CI | child ready | fake provider, contract-only, false | true | failed | timed_out | PF | termination-evidence.v1 | signal handshake plus snapshot | no KILL fails | no PID sleep | yes |
| GB-05 | descendant | `test/real-run-gate-b-process.test.mjs` | `test/fixtures/real-run/descendant.mjs` | portable | CI | child spawned | fake provider, contract-only, false | true | invalid | timed_out | PF | termination-evidence.v1 | child handshake plus snapshot | not invalid fails | bounded polls | yes |
| GB-06 | write | `test/real-run-gate-b-isolation.test.mjs` | `test/fixtures/real-run/writer.mjs` | portable | CI | sealed snapshot | fake provider, contract-only, false | true | invalid | completed | PF | evidence-manifest.v1 | fixed forbidden path | pass fails | fixed probe | yes |
| GB-07 | symlink | `test/real-run-gate-b-isolation.test.mjs` | `test/fixtures/real-run/symlink.mjs` | portable | CI | sealed root | fake provider, contract-only, false | true | invalid | interrupted | PF | preparation-evidence.v1 | fixed symlink | pass fails | fixed path | yes |
| GB-08 | protected path | `test/real-run-gate-b-isolation.test.mjs` | `test/fixtures/real-run/reader.mjs` | macOS | local and CI | provider proved | real macOS provider, local Gate-B proof | true | invalid | interrupted | PF | preparation-evidence.v1 | Seatbelt denial | no denial fails | real denial | yes |
| GB-09 | environment | `test/real-run-gate-b-isolation.test.mjs` | `test/fixtures/real-run/env-dump.mjs` | portable | CI | dummy secret | fake provider, contract-only, false | true | invalid | completed | PF | event.v1 | fixed JSON dump | missing invalid fails | sentinel | yes |
| GB-10 | verifier read | `test/real-run-gate-b-isolation.test.mjs` | `test/fixtures/real-run/reader.mjs` | macOS | local and CI | provider proved | real macOS provider, local Gate-B proof | true | invalid | interrupted | PF | preparation-evidence.v1 | Seatbelt denial | no denial fails | real denial | yes |
| GB-11 | check edit | `test/real-run-gate-b-isolation.test.mjs` | `test/fixtures/real-run/modifier.mjs` | portable | CI | sealed check | fake provider, contract-only, false | true | invalid | completed | PF | evidence-manifest.v1 | fixed edit | pass fails | fixed bytes | yes |
| GB-12 | malformed event | `test/real-run-gate-b-telemetry.test.mjs` | `test/fixtures/real-run/malformed-event.mjs` | portable | CI | valid start | fake provider, contract-only, false | true | invalid | completed | PF | event.v1 | fixed bytes | accepted event fails | fixed bytes | yes |
| GB-13 | token conflict | `test/real-run-gate-b-telemetry.test.mjs` | `test/fixtures/real-run/conflict-events.mjs` | portable | CI | two sources | fake provider, contract-only, false | true | invalid | completed | PF | event.v1 | fixed sequence | no conflict fails | fixed order | yes |
| GB-14 | two terminals | `test/real-run-gate-b-telemetry.test.mjs` | `test/fixtures/real-run/duplicate-terminal.mjs` | portable | CI | valid start | fake provider, contract-only, false | true | invalid | completed | PF | event.v1 | fixed sequence | accepted duplicate fails | fixed events | yes |
| GB-15 | no terminal | `test/real-run-gate-b-telemetry.test.mjs` | `test/fixtures/real-run/early-exit.mjs` | portable | CI | ready pipe | fake provider, contract-only, false | true | invalid | completed | PF | event.v1 | close after ready | pass fails | handshake | yes |
| GB-16 | drift | `test/real-run-gate-b-success.test.mjs` | `test/fixtures/real-run/substituted-record.mjs` | portable | CI | pinned identity | no provider, expected blocked | false | blocked | not_started | PF | preparation-evidence.v1 | digest compare | started fails | fixed digests | yes |
| GB-17 | pricing | `test/real-run-gate-b-telemetry.test.mjs` | `test/fixtures/real-run/pricing-drift.mjs` | portable | CI | snapshot pair | fake provider, contract-only, false | true | invalid | completed | PF | event.v1 | fixed snapshots | accepted drift fails | fixed pair | yes |
| GB-18 | no provider | `test/real-run-gate-b-isolation.test.mjs` | `test/fixtures/real-run/no-provider.mjs` | portable | CI | provider absent | no provider, expected blocked | false | blocked | not_started | PF | capability.v1 | no spawn assertion | started fails | no process | yes |
| GB-19 | cleanup | `test/real-run-gate-b-evidence.test.mjs` | `test/fixtures/real-run/retained-path.mjs` | portable | CI | private root | fake provider, contract-only, false | true | invalid | completed | PF | cleanup-attestation.v1 | fixed retained path | complete fails | fixed path | yes |
| GB-20 | write interruption | `test/real-run-gate-b-evidence.test.mjs` | `test/fixtures/real-run/bounded-writer.mjs` | portable | CI | staging root | fake provider, contract-only, false | true | invalid | completed | PF | evidence-manifest.v1 | injected boundary | pass fails | injected boundary | yes |
| GB-21 | track mix | `test/real-run-gate-b-ordering.test.mjs` | `test/fixtures/real-run/mixed-track.json` | portable | CI | mixed records | no provider, expected blocked | false | blocked | not_started | PF | config rejection | canonical parse | started fails | fixed vector | yes |
| GB-22 | ordering | `test/real-run-gate-b-ordering.test.mjs` | `test/fixtures/real-run/schedule-vector.json` | portable | CI | S1/S2 | no provider, expected blocked | false | invalid | not_started | PF | schedule manifest | fixed vectors | mismatch fails | fixed digests | yes |
| GB-23 | secret leak | `test/real-run-gate-b-credential.test.mjs` | `test/fixtures/real-run/dummy-secret.mjs` | portable | CI | sentinel credential | fake provider, contract-only, false | true | invalid | completed | PF | redaction evidence, cleanup-attestation.v1 | sentinel scan | no invalid fails | sentinel | yes |


| Decision | Options | Repository evidence | Selected option | Remaining proof | Blocking status |
| --- | --- | --- | --- | --- | --- |
| Result schema | extend v1; separate v2 | v1 requires test data for several pre-start paths | separate `codexlooper.benchmark-result.v2` | B1b parser/matrix | blocks B1b |
| Real isolation | copy/VM; generic claim; Seatbelt | Phase A is copy/VM; CRG profile is narrow | `macos-seatbelt.v1` only | real allow/deny proof | blocks real runs |
| Other platforms | generic claim; dedicated provider | no general provider exists | blocked pending reviewed provider | provider proof | blocks platform |
| Ralphex telemetry | trust receipt; validate receipt | existing receipt lacks benchmark contract | untrusted `receipt_derived` | fake provenance tests | blocks B2 |
| Pricing | in-code table; snapshot | MODEL_PRICING is process local | pricing-snapshot v1 | lifecycle tests | blocks B4 |
| First code sprint | config plus result; config only | review found result ambiguity | B1a config/identity only | independent B1a review | blocks B1b |

## Plan acceptance criteria

This document may receive PASS only when an independent review confirms complete
configuration grammar; canonicalisation and digests; full adapter contracts;
testable IsolationProvider; fake-provider ineligibility; technical credential
policy; deterministic process proof; selected result v2 and matrix; telemetry
and pricing provenance; evidence and cleanup schemas; retry/order/cache state;
full Gate-B proof matrix; and process-free B1a scope. A PASS does not itself
authorise implementation, credentials, real adapters, or real model runs.

## Independent review finding closure

| Finding | Plan section | Concrete decision | Compatibility or proof artifact | Implementation sprint | Revision status |
| --- | --- | --- | --- | --- | --- |
| P1-01 | Canonicalisation | literal valid vectors | vectors A/B and fixed digests | B1a | addressed in second planning revision; independent re-review required |
| P1-02 | Adapter configuration | config and source manifests | canonical config/INI/manifest digests | B2 | addressed in second planning revision; independent re-review required |
| P1-03 | IsolationProvider | exact evidence records and gate | capability/preparation/termination/cleanup records | B3 | addressed in second planning revision; independent re-review required |
| P1-04 | Credential policy | child-environment-only | dummy secret and descendant leak proof | B2/B3 | addressed in second planning revision; independent re-review required |
| P1-05 | Process observation | libproc snapshots, waitpid, killpg | three-empty-snapshot termination evidence | B3 | addressed in second planning revision; independent re-review required |
| P2-01 | Events and telemetry | typed payload union | payload/event digests and policy | B4 | addressed in second planning revision; independent re-review required |
| P2-02 | Result v2 | four metric statuses only | per-row telemetry policy | B1b | addressed in second planning revision; independent re-review required |
| P2-03 | Evidence operations | exclusive no-follow staging | manifest entry and cleanup evidence | B4 | addressed in second planning revision; independent re-review required |
| P2-04 | Ordering and cache | defined seeded rotation | S1/S2 schedule vectors | B1c | addressed in second planning revision; independent re-review required |
| P2-05 | Gate-B matrix | explicit binding columns | named test/fake/evidence matrix | B5 | addressed in second planning revision; independent re-review required |
| P2-N01 | Sprint ordering | schedule removed from B1a | separate B1c scope | B1c | addressed in second planning revision; independent re-review required |
