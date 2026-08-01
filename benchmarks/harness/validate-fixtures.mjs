import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES, validateFixtureSet, validateInitialFixture } from "./fixture-manifest.mjs";
import { deriveChanges, executableSha256, readCandidateSourceMap, snapshotTree } from "./evaluate-result.mjs";
import { buildHarnessIdentity, parseUntrustedBenchmarkResult, sha256 } from "../schema/benchmark-result.v1.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const EVENT_KINDS = new Set(["baseline_started", "candidate_started", "hidden_verifier_started", "validation_finished"]);
const EMPTY_HUMAN_EVENTS_SHA256 = sha256("[]");

function outputDigest(output) {
  return sha256(JSON.stringify({ status: output?.status ?? null, signal: output?.signal ?? null, stdout: output?.stdout ?? "", stderr: output?.stderr ?? "", error: output?.error?.code ?? null }));
}

function commandOutput(command, workspace, sourceMap) {
  const environment = sourceMap ? { BENCHMARK_CANDIDATE_SOURCE_MAP: JSON.stringify(sourceMap) } : {};
  const result = spawnSync(command.executable, [...command.args, command.scriptPath, workspace], { cwd: here, env: environment, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 16384, windowsHide: true });
  return { status: Number.isSafeInteger(result.status) && result.status >= 0 ? result.status : 1, signal: result.signal ?? null, timedOut: result.error?.code === "ETIMEDOUT", stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error ?? null };
}

function harnessComponents(manifest) {
  const read = (path) => readFileSync(join(here, path));
  return {
    schema: read("../schema/benchmark-result.v1.mjs"),
    fixture_manifest: read("fixture-manifest.mjs"),
    baseline_verifier: readFileSync(manifest.commands.public_check.scriptPath),
    success_verifier: readFileSync(manifest.commands.hidden_verifier.scriptPath),
    evaluator: Buffer.concat([read("candidate-contract.mjs"), read("candidate-source-map.mjs"), read("evaluate-result.mjs"), read("verifier-protocol.mjs"), read("probe-controller.mjs")]),
    command_allowlist: Buffer.from("node-fixed-public-check-hidden-verifier-vm-controller-ipc-hmac-v4"),
    fixture_version: 1,
  };
}

function clockDuration(start, now) { return Math.max(0, Math.round(now() - start)); }
function privateEventLog(now, startedAt) {
  const events = [];
  return Object.freeze({
    add(kind) {
      if (!EVENT_KINDS.has(kind) || events.length >= 8) throw new Error("BENCHMARK_EVENT_LOG_INVALID");
      events.push(Object.freeze({ sequence: events.length + 1, kind, offset_ms: clockDuration(startedAt, now) }));
    },
    digest() { return sha256(JSON.stringify(events)); },
  });
}
function terminationFor(output) {
  if (output.timedOut || output.status === 3) return "timed_out";
  if (output.signal || output.status === 2) return "interrupted";
  return "completed";
}
function finalMeasuredResult(input) { return parseUntrustedBenchmarkResult(input).data; }

function buildResult({ manifest, initial, final, baselineOutput, successOutput, timing, runNonce, sourceStable }) {
  const delta = deriveChanges(initial, final);
  const unauthorized = delta.entries.filter((entry) => !manifest.allowedPaths.includes(entry.path)).map((entry) => entry.path);
  const termination = terminationFor(successOutput);
  const hiddenPassed = successOutput.status === 0 && successOutput.signal === null && !successOutput.timedOut && termination === "completed";
  const status = unauthorized.length || !sourceStable ? "invalid" : hiddenPassed ? "passed" : "failed";
  const effectiveTest = status === "invalid" ? { ...successOutput, status: 1, stderr: `${successOutput.stderr}\nunauthorized workspace change` } : successOutput;
  const nodeHash = executableSha256();
  return finalMeasuredResult({
    schema: "codexlooper.benchmark-result.v1",
    harness: { identity_sha256: buildHarnessIdentity(harnessComponents(manifest)), fixture_version: manifest.version },
    fixture: { id: manifest.id, version: manifest.version, input_sha256: manifest.inputSha256 },
    track: "offline_validation",
    variant: { id: "reference-repair", version: "1" },
    run: { id: `offline-${manifest.id}-${runNonce.toString("hex")}`, replication_group: `offline-${manifest.id}`, attempt_index: 1, order: { randomization_seed: "offline", sequence_index: 0 }, cache_state: "cold", fresh_workspace: true },
    environment: { platform: process.platform, architecture: process.arch, shared: { node_version: process.version, node_executable_sha256: nodeHash, resource_limits_sha256: sha256("offline-fixed-resource-limits-v1"), timeout_retry_policy_sha256: sha256("offline-fixed-timeout-policy-v1") }, variant_runtime: { executable_sha256: nodeHash, version: process.version, configuration_sha256: sha256("offline-reference-repair-v1"), adapter_identity_sha256: sha256("reference-repair"), runtime_allowlist_sha256: sha256("node-fixed-public-check-hidden-verifier-vm-controller-ipc-hmac-v4") } },
    source: { commit: null, initial_tree_sha256: initial.sha256 },
    outcome: { status, termination, test: { command_id: manifest.commands.hidden_verifier.id, exit_code: effectiveTest.status, sha256: outputDigest(effectiveTest) } },
    timing,
    usage: { status: "not_applicable", source: "offline_harness", model_calls: 0, input_tokens: null, cache_tokens: null, output_tokens: null, reasoning_tokens: null, cost: { status: "not_applicable", amount: null, currency: null, pricing_snapshot_sha256: null } },
    human_interventions: { event_count: 0, events_sha256: EMPTY_HUMAN_EVENTS_SHA256 },
    changes: { entries: delta.entries.map(({ path, kind }) => ({ path, kind })), unauthorized_files: unauthorized, final_tree_sha256: final.sha256, delta_sha256: delta.sha256 },
    evidence: { baseline_failure_sha256: outputDigest(baselineOutput), reference_validation_sha256: outputDigest(successOutput) },
  });
}

export function createCandidateWorkspace(manifest, temporaryRoot = tmpdir(), { copyImpl = cpSync } = {}) {
  validateInitialFixture(manifest);
  const workspace = mkdtempSync(join(temporaryRoot, `codexlooper-${manifest.id}-candidate-`));
  try { copyImpl(manifest.initialRoot, workspace, { recursive: true }); return workspace; }
  catch (error) { rmSync(workspace, { recursive: true, force: true }); throw error; }
}

function createValidator({ now = () => performance.now(), commandOutputImpl = commandOutput, randomBytesImpl = randomBytes } = {}) {
  if (typeof now !== "function" || typeof commandOutputImpl !== "function" || typeof randomBytesImpl !== "function") throw new Error("BENCHMARK_TEST_FACTORY_INVALID");
  function finalize({ manifest, initial, final, baselineOutput, successOutput, sourceStable, timing }) {
    const nonce = randomBytesImpl(12);
    if (!Buffer.isBuffer(nonce) || nonce.length !== 12) throw new Error("BENCHMARK_RUN_ID_INVALID");
    return buildResult({ manifest, initial, final, baselineOutput, successOutput, sourceStable, timing, runNonce: nonce });
  }
  function validateRun(manifest, { temporaryRoot = tmpdir(), applyCandidate, beforeCandidate } = {}) {
    if (!FIXTURES.includes(manifest)) throw new Error(`BENCHMARK_MANIFEST_UNTRUSTED: ${manifest?.id ?? "unknown"}`);
    if (typeof applyCandidate !== "function") throw new Error("BENCHMARK_CANDIDATE_APPLY_REQUIRED");
    const startedAt = now(); const events = privateEventLog(now, startedAt); let baselineWorkspace; let candidateWorkspace;
    try {
      const setupStarted = now(); events.add("baseline_started");
      baselineWorkspace = createCandidateWorkspace(manifest, temporaryRoot);
      const baselineSource = readCandidateSourceMap(baselineWorkspace, manifest.candidateInputPaths);
      const baselineOutput = commandOutputImpl(manifest.commands.public_check, baselineWorkspace, baselineSource.sourceMap);
      if (baselineOutput.status === 0) throw new Error(`BENCHMARK_BASELINE_PASSED: ${manifest.id}`);
      candidateWorkspace = createCandidateWorkspace(manifest, temporaryRoot);
      const initial = snapshotTree(candidateWorkspace, "initial");
      const setupMs = clockDuration(setupStarted, now);
      const executionStarted = now(); events.add("candidate_started");
      if (beforeCandidate) beforeCandidate(candidateWorkspace);
      applyCandidate(candidateWorkspace);
      const executionMs = clockDuration(executionStarted, now);
      const verifierStarted = now(); events.add("hidden_verifier_started");
      let verifiedSource; let sourceFailure = null;
      try { verifiedSource = readCandidateSourceMap(candidateWorkspace, manifest.candidateInputPaths); }
      catch (error) { sourceFailure = error; }
      const successOutput = sourceFailure ? { status: 2, signal: null, timedOut: false, stdout: "", stderr: "", error: sourceFailure } : commandOutputImpl(manifest.commands.hidden_verifier, candidateWorkspace, verifiedSource.sourceMap);
      const final = snapshotTree(candidateWorkspace, "final");
      let sourceStable = false;
      try {
        const finalSource = readCandidateSourceMap(candidateWorkspace, manifest.candidateInputPaths);
        sourceStable = !sourceFailure && verifiedSource.sha256 === finalSource.sha256 && final.sha256 === verifiedSource.sha256;
      } catch { sourceStable = false; }
      const verifierMs = clockDuration(verifierStarted, now);
      events.add("validation_finished");
      const totalMs = clockDuration(startedAt, now);
      events.digest();
      return finalize({ manifest, initial, final, baselineOutput, successOutput, sourceStable, timing: { setup_ms: setupMs, execution_ms: executionMs, verifier_ms: verifierMs, total_ms: Math.max(totalMs, setupMs + executionMs + verifierMs) } });
    } finally {
      if (baselineWorkspace) rmSync(baselineWorkspace, { recursive: true, force: true });
      if (candidateWorkspace) rmSync(candidateWorkspace, { recursive: true, force: true });
    }
  }
  return Object.freeze({
    validateFixture(manifest, { temporaryRoot, beforeReferenceRepair } = {}) { return validateRun(manifest, { temporaryRoot, beforeCandidate: beforeReferenceRepair, applyCandidate: manifest?.referenceRepair?.apply }); },
    validateCandidateFixture(manifest, { applyCandidate, temporaryRoot } = {}) { return validateRun(manifest, { temporaryRoot, applyCandidate }); },
  });
}

const productionValidator = createValidator();
export function createFixtureValidatorForTests(options = {}) { return createValidator(options); }
export function validateFixture(manifest, options = {}) { return productionValidator.validateFixture(manifest, options); }
export function validateCandidateFixture(manifest, options = {}) { return productionValidator.validateCandidateFixture(manifest, options); }
export function validateAllFixtures() { validateFixtureSet(FIXTURES); return FIXTURES.map((fixture) => validateFixture(fixture)); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = validateAllFixtures();
  process.stdout.write(`${JSON.stringify({ fixtures: results.map((result) => ({ id: result.fixture.id, status: result.outcome.status })) })}\n`);
}
