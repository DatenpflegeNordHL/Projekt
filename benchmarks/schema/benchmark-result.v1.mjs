import { createHash } from "node:crypto";

export const RESULT_SCHEMA = "codexlooper.benchmark-result.v1";
export const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_STRING_BYTES = 4096;

function fail(message) {
  const error = new Error(`BENCHMARK_RESULT_INVALID: ${message}`);
  error.code = "BENCHMARK_RESULT_INVALID";
  throw error;
}

function plainObject(value, name, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${name} must be an ordinary object`);
  if (Object.getOwnPropertySymbols(value).length) fail(`${name} must not contain symbols`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(`${name}.${String(key)} must be an enumerable data property`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${name} has unknown or missing fields`);
  return value;
}

function string(value, name, { nullable = false, max = MAX_STRING_BYTES } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || /[\uD800-\uDFFF]/.test(value) || Buffer.byteLength(value, "utf8") > max) fail(`${name} must be a bounded string`);
  return value;
}

function digest(value, name, nullable = false) {
  value = string(value, name, { nullable, max: 64 });
  if (value !== null && !SHA256_RE.test(value)) fail(`${name} must be lowercase SHA-256`);
  return value;
}

function nonNegative(value, name, nullable = false) {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative safe integer`);
  return value;
}

function safePath(value, name) {
  string(value, name, { max: 1024 });
  if (!value || value.startsWith("/") || /[\\\0-\x1F\x7F-\x9F]/.test(value) || value.split("/").some((part) => !part || part === "." || part === "..")) fail(`${name} must be a safe POSIX relative path`);
  return value;
}

function oneOf(value, name, values) {
  if (!values.includes(value)) fail(`${name} is invalid`);
  return value;
}

function array(value, name, validator) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) fail(`${name} must be an ordinary array`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(`${name} must be dense`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!/^(0|[1-9]\d*)$/.test(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(`${name} must contain only enumerable data entries`);
  }
  return Array.from({ length: value.length }, (_, index) => validator(value[index], `${name}[${index}]`));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildHarnessIdentity(components) {
  const names = ["schema", "fixture_manifest", "baseline_verifier", "success_verifier", "evaluator", "command_allowlist", "fixture_version"];
  plainObject(components, "components", names);
  const records = names.map((name) => {
    const raw = name === "fixture_version" ? Buffer.from(String(components[name]), "utf8") : Buffer.isBuffer(components[name]) ? components[name] : Buffer.from(components[name]);
    const componentDigest = createHash("sha256").update(raw).digest();
    return Buffer.concat([Buffer.from(name, "utf8"), Buffer.from([0]), componentDigest]);
  });
  return createHash("sha256").update("codexlooper.benchmark-harness.v1\0", "utf8").update(Buffer.concat(records)).digest("hex");
}

export function parseUntrustedBenchmarkResult(input) {
  const value = plainObject(input, "result", ["schema", "harness", "fixture", "track", "variant", "run", "environment", "source", "outcome", "timing", "usage", "human_interventions", "changes", "evidence"]);
  if (value.schema !== RESULT_SCHEMA) fail("schema is invalid");
  const harness = plainObject(value.harness, "harness", ["identity_sha256", "fixture_version"]);
  digest(harness.identity_sha256, "harness.identity_sha256"); nonNegative(harness.fixture_version, "harness.fixture_version");
  const fixture = plainObject(value.fixture, "fixture", ["id", "version", "input_sha256"]);
  string(fixture.id, "fixture.id"); nonNegative(fixture.version, "fixture.version"); digest(fixture.input_sha256, "fixture.input_sha256");
  oneOf(value.track, "track", ["controlled_parity", "native_workflow", "offline_validation"]);
  const variant = plainObject(value.variant, "variant", ["id", "version"]); string(variant.id, "variant.id"); string(variant.version, "variant.version");
  const run = plainObject(value.run, "run", ["id", "replication_group", "attempt_index", "order", "cache_state", "fresh_workspace"]);
  string(run.id, "run.id"); string(run.replication_group, "run.replication_group"); nonNegative(run.attempt_index, "run.attempt_index"); if (run.attempt_index < 1) fail("run.attempt_index must be one-based");
  const order = plainObject(run.order, "run.order", ["randomization_seed", "sequence_index"]); string(order.randomization_seed, "run.order.randomization_seed"); nonNegative(order.sequence_index, "run.order.sequence_index"); oneOf(run.cache_state, "run.cache_state", ["cold", "warm"]); if (run.fresh_workspace !== true) fail("run.fresh_workspace must be true");
  const environment = plainObject(value.environment, "environment", ["platform", "architecture", "shared", "variant_runtime"]); string(environment.platform, "environment.platform"); string(environment.architecture, "environment.architecture");
  const shared = plainObject(environment.shared, "environment.shared", ["node_version", "node_executable_sha256", "resource_limits_sha256", "timeout_retry_policy_sha256"]); string(shared.node_version, "environment.shared.node_version"); digest(shared.node_executable_sha256, "environment.shared.node_executable_sha256"); digest(shared.resource_limits_sha256, "environment.shared.resource_limits_sha256"); digest(shared.timeout_retry_policy_sha256, "environment.shared.timeout_retry_policy_sha256");
  const runtime = plainObject(environment.variant_runtime, "environment.variant_runtime", ["executable_sha256", "version", "configuration_sha256", "adapter_identity_sha256", "runtime_allowlist_sha256"]); digest(runtime.executable_sha256, "environment.variant_runtime.executable_sha256"); string(runtime.version, "environment.variant_runtime.version"); digest(runtime.configuration_sha256, "environment.variant_runtime.configuration_sha256"); digest(runtime.adapter_identity_sha256, "environment.variant_runtime.adapter_identity_sha256"); digest(runtime.runtime_allowlist_sha256, "environment.variant_runtime.runtime_allowlist_sha256");
  const source = plainObject(value.source, "source", ["commit", "initial_tree_sha256"]); if (source.commit !== null && !/^[0-9a-f]{40}$/.test(string(source.commit, "source.commit"))) fail("source.commit must be a full lowercase Git SHA or null"); digest(source.initial_tree_sha256, "source.initial_tree_sha256");
  const outcome = plainObject(value.outcome, "outcome", ["status", "termination", "test"]); oneOf(outcome.status, "outcome.status", ["passed", "failed", "blocked", "invalid"]); oneOf(outcome.termination, "outcome.termination", ["completed", "timed_out", "interrupted", "not_started"]); const test = plainObject(outcome.test, "outcome.test", ["command_id", "exit_code", "sha256"]); string(test.command_id, "outcome.test.command_id"); nonNegative(test.exit_code, "outcome.test.exit_code"); digest(test.sha256, "outcome.test.sha256");
  if (outcome.status === "passed" && (outcome.termination !== "completed" || test.exit_code !== 0)) fail("passed requires a completed zero-exit test");
  if (outcome.status === "failed" && (outcome.termination === "not_started" || test.exit_code === 0)) fail("failed requires an executed non-zero test");
  if (outcome.status === "blocked" && (outcome.termination !== "not_started" || test.exit_code === 0)) fail("blocked requires a not-started non-zero test");
  if (outcome.status === "invalid" && test.exit_code === 0) fail("invalid requires a non-zero test");
  const timing = plainObject(value.timing, "timing", ["setup_ms", "execution_ms", "verifier_ms", "total_ms"]); for (const key of Object.keys(timing)) nonNegative(timing[key], `timing.${key}`); if (timing.total_ms < timing.setup_ms + timing.execution_ms + timing.verifier_ms) fail("timing.total_ms is too small");
  const usage = plainObject(value.usage, "usage", ["status", "source", "model_calls", "input_tokens", "cache_tokens", "output_tokens", "reasoning_tokens", "cost"]); oneOf(usage.status, "usage.status", ["observed", "unavailable", "not_applicable", "invalid"]); oneOf(usage.source, "usage.source", ["offline_harness", "codex_turn_completed", "ralphex_receipt", "provider_receipt"]); nonNegative(usage.model_calls, "usage.model_calls"); for (const key of ["input_tokens", "cache_tokens", "output_tokens", "reasoning_tokens"]) nonNegative(usage[key], `usage.${key}`, true);
  const cost = plainObject(usage.cost, "usage.cost", ["status", "amount", "currency", "pricing_snapshot_sha256"]); oneOf(cost.status, "usage.cost.status", ["observed", "unavailable", "not_applicable", "invalid"]); if (cost.status === "observed") { if (typeof cost.amount !== "number" || cost.amount < 0 || !Number.isFinite(cost.amount) || !/^[A-Z]{3}$/.test(cost.currency) || !SHA256_RE.test(cost.pricing_snapshot_sha256)) fail("observed cost is invalid"); } else if (cost.amount !== null || cost.currency !== null || cost.pricing_snapshot_sha256 !== null) fail("unobserved cost must be null");
  if (usage.status === "observed" && usage.source === "offline_harness") fail("observed usage requires a non-offline source");
  if (usage.status !== "observed" && [usage.input_tokens, usage.cache_tokens, usage.output_tokens, usage.reasoning_tokens].some((value) => value !== null)) fail("unobserved usage values must be null");
  if (usage.status === "not_applicable" && (usage.source !== "offline_harness" || usage.model_calls !== 0 || usage.input_tokens !== null || usage.cache_tokens !== null || usage.output_tokens !== null || usage.reasoning_tokens !== null || usage.cost.status !== "not_applicable")) fail("offline usage must be not applicable");
  if (value.track === "offline_validation" && (usage.status !== "not_applicable" || usage.source !== "offline_harness" || usage.model_calls !== 0 || usage.input_tokens !== null || usage.cache_tokens !== null || usage.output_tokens !== null || usage.reasoning_tokens !== null || usage.cost.status !== "not_applicable" || usage.cost.amount !== null || usage.cost.currency !== null || usage.cost.pricing_snapshot_sha256 !== null)) fail("offline validation usage must be strictly not applicable");
  const interventions = plainObject(value.human_interventions, "human_interventions", ["event_count", "events_sha256"]); nonNegative(interventions.event_count, "human_interventions.event_count"); digest(interventions.events_sha256, "human_interventions.events_sha256");
  const changes = plainObject(value.changes, "changes", ["entries", "unauthorized_files", "final_tree_sha256", "delta_sha256"]); const entries = array(changes.entries, "changes.entries", (entry, name) => { plainObject(entry, name, ["path", "kind"]); safePath(entry.path, `${name}.path`); oneOf(entry.kind, `${name}.kind`, ["add", "modify", "delete", "mode_change", "symlink_change"]); return { path: entry.path, kind: entry.kind }; }); if (entries.some((entry, index) => index && Buffer.compare(Buffer.from(entries[index - 1].path), Buffer.from(entry.path)) >= 0)) fail("changes.entries must be sorted and unique"); array(changes.unauthorized_files, "changes.unauthorized_files", safePath); digest(changes.final_tree_sha256, "changes.final_tree_sha256"); digest(changes.delta_sha256, "changes.delta_sha256");
  const evidence = plainObject(value.evidence, "evidence", ["baseline_failure_sha256", "reference_validation_sha256"]); digest(evidence.baseline_failure_sha256, "evidence.baseline_failure_sha256"); digest(evidence.reference_validation_sha256, "evidence.reference_validation_sha256");
  return Object.freeze({ kind: "untrusted_benchmark_result", data: deepFreeze(JSON.parse(JSON.stringify(value))) });
}
