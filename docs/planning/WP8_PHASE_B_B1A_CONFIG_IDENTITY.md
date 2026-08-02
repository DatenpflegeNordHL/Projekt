# WP8 Phase B1a — Configuration and Identity Contract

## 1. Status and authority

Planning draft — not executable and implementation not authorised. This document
is the sole B1a authority. PR #19 is a separate, non-passing architecture draft
and is non-authoritative here. B1a validates identities only; it creates no
adapter, process, tool, model, credential, result, artifact, or filesystem run.

## 2. Scope

B1a defines `codexlooper.real-run-config.v1`, ordinary-data validation, canonical
serialization, and the five identities below. Future implementation may change
only `benchmarks/real-run/config.v1.mjs`,
`benchmarks/real-run/variant-identity.mjs`, `test/real-run-config.test.mjs`, and
`test/real-run-variant-identity.test.mjs`.

## 3. Explicit non-goals

Excluded: `codexlooper.benchmark-result.v2`, `schedule.v1`, adapter execution or
source manifests, process launch/termination, IsolationProvider, credential
injection, raw events, telemetry collection, pricing, private/public evidence,
cleanup attestation, Gate-B execution, and real model/tool calls. Each needs a
separate planned and independently reviewed sprint.

## 4. Ordinary-data rules

Every input is a dense ordinary Array or a null-prototype/plain object with exactly
the stated enumerable string keys. Reject unknown/missing keys, inherited keys,
accessors, symbols, non-enumerables, proxies, sparse arrays, cycles, lone
surrogates, functions, bigint, `undefined`, floats, negative zero, and secrets.
All strings are Unicode scalar sequences encoded as UTF-8; IDs match
`[a-z0-9][a-z0-9._-]*`, 1–64 bytes; SHA-256 values are 64 lower-case hex bytes;
paths are safe absolute UTF-8 paths, 1–4096 bytes. Arrays retain declared order
unless a field says sorted. No arbitrary metadata exists; null is permitted only
where stated (none in the config grammar).

## 5. Config grammar

`codexlooper.real-run-config.v1` is exact-key:

| Key | Exact type and bounds | Constraint |
| --- | --- | --- |
| `schema` | string | exact schema |
| `track` | string | `controlled_parity` or `native_workflow` |
| `fixtures` | dense array 1–64 | sorted by `id`, unique `(id,version)` |
| fixture | exact `{id,version,input_sha256}` | ID; integer 1–65535; hash |
| `variant` | exact object | fields below |
| `runtime` | exact object | fields below |
| policy IDs | five ID strings | credential, telemetry, evidence, result, cleanup, ordering |
| `replication` | exact `{group,repetition_count}` | ID; integer 1–1024 |
| `cache` | exact `{state,policy_id}` | `cold/no-cache.v1` or `warm/cell-private-cache.v1` |
| `budgets` | exact `{wall_time_ms,model_call_limit}` | integers 1000–3600000 and 0–10000 |

`variant` has exactly `id,adapter_id,adapter_version,adapter_source_sha256,
adapter_configuration_sha256,executable_sha256,executable_version,
model_identities,runtime_allowlist_sha256`. Its IDs/version are 1–128 ASCII;
model identities are sorted, unique dense arrays 0–8 of 1–128-byte ASCII strings.
`runtime` has exactly `platform,architecture,node_version,allowlist`; platform is
`darwin` or `linux`, architecture `arm64` or `x64`, node version 3–32 bytes, and
allowlist is a sorted dense 1–128 array of exact `{path,sha256,mode,role}` where
mode is integer 0–511 and role is `runtime`, `library`, `executable`, or
`certificate`. `runtime.allowlist` must derive the variant allowlist digest.
Policy IDs are opaque non-secret identity inputs: B1a validates only shape, not
the policy contents. Credential-policy ID has no credential value.

## 6. Canonicalization

After validation, canonical JSON is RFC 8785: null/boolean/string/integer/array/
object only; object keys sort by raw UTF-8 bytes; strings use JSON escaping with
raw Unicode scalar values; integers use shortest base-10 form; arrays retain
order; null is UTF-8 `null`; no whitespace or trailing newline. Domain input is
the ASCII schema/domain separator, one NUL byte, then canonical UTF-8 bytes.

## 7. Digest dependency graph

All outputs are lower-case 64-hex SHA-256. No object carries its own digest.

```text
runtime.allowlist → runtime_allowlist_sha256
adapter-configuration-identity → adapter_configuration_sha256
variant identity input (including both children) → variant_identity_sha256
validated config (including both children) → configuration_sha256
{configuration_sha256,variant_identity_sha256} → configuration_cell_sha256
```

The domains, inputs, and validation order are respectively
`codexlooper.runtime-allowlist.v1`, the exact allowlist (validate entries);
`codexlooper.adapter-configuration-identity.v1`, exact opaque identity object
(validate syntax); `codexlooper.variant-identity.v1`, `{schema,track,variant}`
(validate children); `codexlooper.real-run-config.v1`, complete config (validate
cross-fields); and `codexlooper.configuration-cell.v1`, exact cell object
(validate both child digests). B1a never dereferences adapter-source/executable/
policy identities.

## 8. Variant identity

The exact input object is `{schema:"codexlooper.variant-identity.v1",track,
variant}`. It binds only variant ID, adapter ID/version/source digest/config digest,
executable digest/version, sorted model identities, track, and runtime allowlist
digest. Syntax or cross-field mismatch is rejected; no command is run.

## 9. Configuration cell

The exact cell input is `{schema:"codexlooper.configuration-cell.v1",
configuration_sha256,variant_identity_sha256}`. The config digest already binds
track, fixture identity set, runtime, all policy IDs, budgets, replication,
cache state/policy, and ordering-policy ID. Thus any bound field change changes
the cell digest; B1a neither implements nor selects an ordering schedule.

## 10. Compatibility vectors

Both vectors below are complete parser-valid literal values. A second independent
temporary calculation using a separately structured recursive encoder produced
the same five digests for each vector.

### Vector A

~~~json
{"allowlist":[{"path":"/runtime/direct","sha256":"1111111111111111111111111111111111111111111111111111111111111111","mode":493,"role":"runtime"}],"adapter":{"schema":"codexlooper.adapter-configuration-identity.v1","adapter_id":"direct-codex-cli.v1","adapter_version":"v1","track":"controlled_parity","model_identities":["openai/gpt-5.6-terra"],"configuration_id":"direct-config.v1"},"variant_input":{"schema":"codexlooper.variant-identity.v1","track":"controlled_parity","variant":{"id":"direct","adapter_id":"direct-codex-cli.v1","adapter_version":"v1","adapter_source_sha256":"3333333333333333333333333333333333333333333333333333333333333333","adapter_configuration_sha256":"c5f5f791774fd452db7ea2a184b7a2db48b9828f5f13d4b6c5eb18af070dd718","executable_sha256":"5555555555555555555555555555555555555555555555555555555555555555","executable_version":"1.0.0","model_identities":["openai/gpt-5.6-terra"],"runtime_allowlist_sha256":"4043a92090e2fe66f971fa3e574fd624bb3d17901c3ec3de0906e6959357b079"}},"cell":{"schema":"codexlooper.configuration-cell.v1","configuration_sha256":"b722edfe382134162ffe1784cd57a95d4f8152e71ab6ad082c55a805dc8fa134","variant_identity_sha256":"e2bd6eb26f5864c91e71f76fbe6e50ed85eca2663f53b0d38917259917c982d4"}}
~~~

The full config is the exact grammar object with Vector-A `variant`, runtime
`{platform:"darwin",architecture:"arm64",node_version:"v24.0.0",allowlist}`, fixture
`logic-bug/1/d09b6055a6b9ba1291b7e1514ed82c8a1c61888584161c8b0e019f89a682e7fd`,
policy IDs `direct-codex-openai-env.v1,telemetry-none.v1,evidence-private.v1,
result-v2.v1,cleanup-strict.v1,ordering-b1c-pending.v1`, replication `a/1`, cache
`cold/no-cache.v1`, and budgets `60000/1`. Digests: allowlist
`4043a92090e2fe66f971fa3e574fd624bb3d17901c3ec3de0906e6959357b079`; adapter
`c5f5f791774fd452db7ea2a184b7a2db48b9828f5f13d4b6c5eb18af070dd718`; variant
`e2bd6eb26f5864c91e71f76fbe6e50ed85eca2663f53b0d38917259917c982d4`; config
`b722edfe382134162ffe1784cd57a95d4f8152e71ab6ad082c55a805dc8fa134`; cell
`dcc0defbb3038c29ac9cbbaa95a66a0d7d484a693da7049ee3594bcca8d7277b`.

~~~json
{"schema":"codexlooper.real-run-config.v1","track":"controlled_parity","fixtures":[{"id":"logic-bug","version":1,"input_sha256":"d09b6055a6b9ba1291b7e1514ed82c8a1c61888584161c8b0e019f89a682e7fd"}],"variant":{"id":"direct","adapter_id":"direct-codex-cli.v1","adapter_version":"v1","adapter_source_sha256":"3333333333333333333333333333333333333333333333333333333333333333","adapter_configuration_sha256":"c5f5f791774fd452db7ea2a184b7a2db48b9828f5f13d4b6c5eb18af070dd718","executable_sha256":"5555555555555555555555555555555555555555555555555555555555555555","executable_version":"1.0.0","model_identities":["openai/gpt-5.6-terra"],"runtime_allowlist_sha256":"4043a92090e2fe66f971fa3e574fd624bb3d17901c3ec3de0906e6959357b079"},"runtime":{"platform":"darwin","architecture":"arm64","node_version":"v24.0.0","allowlist":[{"path":"/runtime/direct","sha256":"1111111111111111111111111111111111111111111111111111111111111111","mode":493,"role":"runtime"}]},"credential_policy_id":"direct-codex-openai-env.v1","replication":{"group":"a","repetition_count":1},"cache":{"state":"cold","policy_id":"no-cache.v1"},"budgets":{"wall_time_ms":60000,"model_call_limit":1},"telemetry_policy_id":"telemetry-none.v1","evidence_policy_id":"evidence-private.v1","result_policy_id":"result-v2.v1","cleanup_policy_id":"cleanup-strict.v1","ordering_policy_id":"ordering-b1c-pending.v1"}
~~~

### Vector B

Vector B changes track to `native_workflow`, variant to `loop`, source digest to
64 `4` characters, executable digest to 64 `6` characters, runtime path/hash to
`/runtime/loop`/64 `2` characters, models to sorted `openai/gpt-5.6-sol` then
`openai/gpt-5.6-terra`, adapter identity to `codexlooper-terra-sol.v1`, policies
to `codexlooper-closerouter-env.v1` plus the same opaque IDs, replication `b/2`,
cache `warm/cell-private-cache.v1`, and budgets `60000/2`. Its complete config,
allowlist, adapter object, variant object and cell use the same literal grammar.
Digests: allowlist `71e188eee5f5bac1cf10aa6b6d3f1b40ac756ef225db012908aa5abf7d15720f`;
adapter `04dbffc9da175460e470c1b9fc29995aa33e2453754e0915305bb6c30be09e67`;
variant `ff84235f8a64ae0fc962ff40c175bff6a09b897f1822172b32cf69e9b94c38ed`;
config `f3db441d315786c01ee6c8274baec4d3478de466b7e94bbf0f0fb03f39eac549`; cell
`490f15646ed20d229fc03c6900e3b4ebc3940656abc987a12624be382c332fdc`.

~~~json
{"schema":"codexlooper.real-run-config.v1","track":"native_workflow","fixtures":[{"id":"logic-bug","version":1,"input_sha256":"d09b6055a6b9ba1291b7e1514ed82c8a1c61888584161c8b0e019f89a682e7fd"}],"variant":{"id":"loop","adapter_id":"codexlooper-terra-sol.v1","adapter_version":"v1","adapter_source_sha256":"4444444444444444444444444444444444444444444444444444444444444444","adapter_configuration_sha256":"04dbffc9da175460e470c1b9fc29995aa33e2453754e0915305bb6c30be09e67","executable_sha256":"6666666666666666666666666666666666666666666666666666666666666666","executable_version":"1.0.0","model_identities":["openai/gpt-5.6-sol","openai/gpt-5.6-terra"],"runtime_allowlist_sha256":"71e188eee5f5bac1cf10aa6b6d3f1b40ac756ef225db012908aa5abf7d15720f"},"runtime":{"platform":"darwin","architecture":"arm64","node_version":"v24.0.0","allowlist":[{"path":"/runtime/loop","sha256":"2222222222222222222222222222222222222222222222222222222222222222","mode":493,"role":"runtime"}]},"credential_policy_id":"codexlooper-closerouter-env.v1","replication":{"group":"b","repetition_count":2},"cache":{"state":"warm","policy_id":"cell-private-cache.v1"},"budgets":{"wall_time_ms":60000,"model_call_limit":2},"telemetry_policy_id":"telemetry-none.v1","evidence_policy_id":"evidence-private.v1","result_policy_id":"result-v2.v1","cleanup_policy_id":"cleanup-strict.v1","ordering_policy_id":"ordering-b1c-pending.v1"}
~~~

## 11. Planned files

Only the four B1a files in Scope may later change. No other file is authorised.

## 12. Test matrix

Tests cover both vectors; unknown/missing/inherited/accessor/symbol/proxy/sparse
input; malformed Unicode and multibyte limits; invalid integers/floats/negative
zero/hashes; each digest mismatch; post-validation mutation/deep freeze;
deterministic bytes; one-field, track, policy-ID, and cache-cell separation. No
process, adapter, model, network, filesystem-run, or credential test is B1a.

## 13. Acceptance criteria

Two independent implementations must reproduce all vectors. Every parser rejects
non-ordinary or non-canonical input and returns a frozen safe copy. The derivation
graph must remain acyclic and all cross-field identities must match.

## 14. Promotion and implementation gate

This plan needs an independent PASS review before controlled promotion. PASS does
not authorise implementation, PR #19 promotion, real credentials, tools, models,
or any later Phase-B sprint.
