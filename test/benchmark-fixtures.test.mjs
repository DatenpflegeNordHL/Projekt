import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, getFixture, validateFixtureSet, validateInitialFixture, validateManifestContract } from "../benchmarks/harness/fixture-manifest.mjs";
import { createCandidateWorkspace, createFixtureValidatorForTests, validateAllFixtures, validateCandidateFixture, validateFixture } from "../benchmarks/harness/validate-fixtures.mjs";

function files(root, current = root, output = []) {
  for (const name of readdirSync(current).sort()) {
    const path = join(current, name);
    if (statSync(path).isDirectory()) files(root, path, output); else output.push(path.slice(root.length + 1));
  }
  return output.sort();
}

test("every deterministic fixture fails at baseline and passes its reference repair", () => {
  const results = validateAllFixtures();
  assert.deepEqual(results.map((result) => result.fixture.id), FIXTURES.map((fixture) => fixture.id));
  assert.deepEqual(results.map((result) => result.outcome.status), ["passed", "passed", "passed"]);
  assert.deepEqual(results.map((result) => result.usage.status), ["not_applicable", "not_applicable", "not_applicable"]);
  assert.equal(new Set(results.map((result) => result.run.id)).size, results.length);
  assert.deepEqual(results.map((result) => result.human_interventions.event_count), [0, 0, 0]);
  const first = validateFixture(getFixture("logic-bug")); const second = validateFixture(getFixture("logic-bug"));
  assert.notEqual(first.run.id, second.run.id);
  assert.ok(first.timing.total_ms >= first.timing.setup_ms + first.timing.execution_ms + first.timing.verifier_ms);
});

test("candidate workspaces contain only declared source inputs; checks are harness-controlled", () => {
  for (const fixture of FIXTURES) {
    const workspace = createCandidateWorkspace(fixture);
    try {
      assert.deepEqual(files(workspace), fixture.candidateInputPaths);
      const contents = files(workspace).map((path) => readFileSync(join(workspace, path), "utf8")).join("\n");
      assert.doesNotMatch(contents, /success-verifier|reference-repair|fixture-manifest|evaluate-result|benchmark-result|public-check/);
      assert.equal(fixture.commands.public_check.scriptPath.startsWith(workspace), false);
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  }
});

test("candidate-controlled output, process controls, replay-shaped IPC, and monkeypatches cannot produce a passed result", () => {
  const fixture = getFixture("logic-bug");
  const cases = [
    "process.stdout.write('{\\\"version\\\":1,\\\"values\\\":[false,true,true]}\\n'); process.exit(0); export function isNonEmpty() { return false; }",
    "process.stdout.write('prefix\\n{\\\"version\\\":1,\\\"values\\\":[false,true,true]}\\nsuffix\\n'); process.exit(0); export function isNonEmpty() { return false; }",
    "process.stderr.write('{\\\"version\\\":1,\\\"values\\\":[false,true,true]}\\n'); process.exit(0); export function isNonEmpty() { return false; }",
    "process.stdout.write('{\\\"version\\\":1,\\\"values\\\":[false'); process.exit(0); export function isNonEmpty() { return false; }",
    "process.stdout.write('x'.repeat(20000)); process.exit(0); export function isNonEmpty() { return false; }",
    "process.exit(0); export function isNonEmpty() { return false; }",
    "process.exit(1); export function isNonEmpty() { return false; }",
    "process.abort(); export function isNonEmpty() { return false; }",
    "process.kill(process.pid, 'SIGKILL'); export function isNonEmpty() { return false; }",
    "for (;;) {} export function isNonEmpty() { return false; }",
    "throw new Error('candidate failure');",
    "await Promise.reject(new Error('candidate rejection'));",
    "process.send({ type: 'result', record: { protocol: 2 }, mac: '0'.repeat(64) }); export function isNonEmpty() { return false; }",
    "JSON.stringify = () => '{\\\"version\\\":1,\\\"values\\\":[false,true,true]}'; globalThis.setTimeout = () => 0; export function isNonEmpty() { return false; }",
    "const escaped = globalThis.constructor.constructor('return typeof process')(); if (escaped === 'object') process.exit(0); export function isNonEmpty() { return false; }",
    "import 'node:child_process'; export function isNonEmpty() { return false; }",
  ];
  for (const source of cases) {
    const result = validateCandidateFixture(fixture, { applyCandidate(workspace) { writeFileSync(join(workspace, "src/logic.mjs"), `${source}\n`); } });
    assert.notEqual(result.outcome.status, "passed", source);
  }
});

test("manifest contract rejects substituted executables, extra arguments, and duplicate IDs", () => {
  const fixture = getFixture("logic-bug");
  assert.throws(() => validateManifestContract({ ...fixture, commands: { ...fixture.commands, public_check: { ...fixture.commands.public_check, executable: "/bin/sh" } } }), /MANIFEST_INVALID/);
  assert.throws(() => validateManifestContract({ ...fixture, commands: { ...fixture.commands, hidden_verifier: { ...fixture.commands.hidden_verifier, args: ["--eval"] } } }), /MANIFEST_INVALID/);
  assert.throws(() => validateFixtureSet([fixture, { ...fixture }]), /DUPLICATE_ID/);
});

test("initial fixture hashes reject tampering and unsafe hidden paths", () => {
  const fixture = getFixture("logic-bug"); const root = mkdtempSync(join(tmpdir(), "benchmark-tamper-"));
  try {
    cpSync(fixture.initialRoot, root, { recursive: true }); writeFileSync(join(root, "src/logic.mjs"), "export const forged = true;\n");
    assert.throws(() => validateInitialFixture({ ...fixture, initialRoot: root }), /TAMPERED/);
    symlinkSync("src/logic.mjs", join(root, "hidden-success-verifier.mjs"));
    assert.throws(() => validateInitialFixture({ ...fixture, initialRoot: root }), /INPUT_UNSAFE|CANDIDATE_INPUT_FORBIDDEN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workspace cleanup covers copy failures and validation failures", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "benchmark-cleanup-"));
  try {
    assert.throws(() => createCandidateWorkspace(getFixture("logic-bug"), temporaryRoot, { copyImpl() { throw new Error("copy failure"); } }), /copy failure/);
    assert.deepEqual(readdirSync(temporaryRoot), []);
    assert.throws(() => validateFixture(getFixture("logic-bug"), { temporaryRoot, beforeReferenceRepair() { throw new Error("injected failure"); } }), /injected failure/);
    assert.deepEqual(readdirSync(temporaryRoot), []);
  } finally { rmSync(temporaryRoot, { recursive: true, force: true }); }
});

test("production IDs are random while test injection is isolated from the production API", () => {
  let clock = 0;
  const testValidator = createFixtureValidatorForTests({ now() { clock += 7; return clock; }, randomBytesImpl() { return Buffer.alloc(12, 7); } });
  const result = testValidator.validateFixture(getFixture("logic-bug"));
  assert.equal(result.timing.setup_ms > 0, true);
  assert.equal(result.timing.execution_ms > 0, true);
  assert.equal(result.timing.verifier_ms > 0, true);
  assert.equal(result.timing.total_ms >= result.timing.setup_ms + result.timing.execution_ms + result.timing.verifier_ms, true);
  assert.equal(result.human_interventions.event_count, 0);
  assert.equal(result.run.id.endsWith("07".repeat(12)), true);
  const first = validateFixture(getFixture("logic-bug"), { randomBytesImpl() { return Buffer.alloc(12, 7); } });
  const second = validateFixture(getFixture("logic-bug"), { randomBytesImpl() { return Buffer.alloc(12, 7); } });
  assert.notEqual(first.run.id, second.run.id);
});

test("termination reflects completed, timeout, signal, and controller failures", () => {
  const fixture = getFixture("logic-bug");
  const output = (status, { signal = null, timedOut = false } = {}) => ({ status, signal, timedOut, stdout: "", stderr: "", error: null });
  for (const [successOutput, expectedTermination] of [[output(1), "completed"], [output(3, { timedOut: true }), "timed_out"], [output(1, { signal: "SIGKILL" }), "interrupted"], [output(2), "interrupted"]]) {
    const validator = createFixtureValidatorForTests({ commandOutputImpl(command) { return command.id === "public-check" ? output(1) : successOutput; } });
    const result = validator.validateFixture(fixture);
    assert.equal(result.outcome.status, "failed");
    assert.equal(result.outcome.termination, expectedTermination);
  }
});

test("a workspace change after the sealed source map cannot produce a pass", () => {
  const fixture = getFixture("logic-bug");
  const output = (status) => ({ status, signal: null, timedOut: false, stdout: "", stderr: "", error: null });
  const validator = createFixtureValidatorForTests({
    commandOutputImpl(command, workspace) {
      if (command.id === "public-check") return output(1);
      writeFileSync(join(workspace, "src/logic.mjs"), "export function isNonEmpty() { return false; }\n");
      return output(0);
    },
  });
  const result = validator.validateFixture(fixture);
  assert.equal(result.outcome.status, "invalid");
  assert.notEqual(result.outcome.status, "passed");
});
