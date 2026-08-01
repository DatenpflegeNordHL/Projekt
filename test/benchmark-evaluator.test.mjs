import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as evaluator from "../benchmarks/harness/evaluate-result.mjs";
import { executableSha256, deriveChanges, readCandidateSourceMap, snapshotTree } from "../benchmarks/harness/evaluate-result.mjs";
import { validateSourceMap } from "../benchmarks/harness/candidate-source-map.mjs";
import { candidateContract } from "../benchmarks/harness/candidate-contract.mjs";
import { getFixture } from "../benchmarks/harness/fixture-manifest.mjs";
import { createCandidateWorkspace, validateCandidateFixture } from "../benchmarks/harness/validate-fixtures.mjs";
import { createProbeTestFactory, runCandidateProbe } from "../benchmarks/harness/verifier-protocol.mjs";
import { sha256 } from "../benchmarks/schema/benchmark-result.v1.mjs";

function root(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }
function logicRequest() { return { fixture: "logic-bug", operation: "isNonEmpty", inputs: ["a"] }; }
function validRecord(start) {
  return { protocol: 2, run_id: start.run_id, fixture_id: start.fixture_id, operation: start.request.operation, candidate_tree_sha256: start.candidate_tree_sha256, values: [true] };
}
function writeFakeController(directory, mutation = "") {
  const path = join(directory, `controller-${Math.random().toString(16).slice(2)}.mjs`);
  writeFileSync(path, `import { createHmac } from 'node:crypto';
process.once('message', (start) => {
  const record = ${validRecord.toString()}(start);
  ${mutation}
  const signature = createHmac('sha256', Buffer.from(start.key, 'base64')).update(JSON.stringify(record), 'utf8').digest('hex');
  const mac = globalThis.__invalidMac ? '0'.repeat(64) : signature;
  const envelope = { type: 'result', record, mac };
  const done = () => { process.disconnect(); process.exit(0); };
  if (globalThis.__two) process.send(envelope, () => process.send(envelope, done));
  else if (globalThis.__none) done();
  else process.send(envelope, done);
});
`);
  return path;
}

test("tree identities separate initial, final, and baseline-bound delta", () => {
  const a = root("benchmark-tree-a-"); const b = root("benchmark-tree-b-"); const finalA = root("benchmark-tree-final-a-"); const finalB = root("benchmark-tree-final-b-");
  try {
    writeFileSync(join(a, "state.txt"), "baseline-a\n"); writeFileSync(join(b, "state.txt"), "baseline-b\n");
    writeFileSync(join(finalA, "state.txt"), "same-final\n"); writeFileSync(join(finalB, "state.txt"), "same-final\n");
    const initialA = snapshotTree(a, "initial"); const initialB = snapshotTree(b, "initial"); const finalOne = snapshotTree(finalA, "final"); const finalTwo = snapshotTree(finalB, "final");
    assert.equal(finalOne.sha256, finalTwo.sha256);
    assert.notEqual(initialA.sha256, finalOne.sha256);
    assert.notEqual(deriveChanges(initialA, finalOne).sha256, deriveChanges(initialB, finalOne).sha256);
  } finally { for (const path of [a, b, finalA, finalB]) rmSync(path, { recursive: true, force: true }); }
});

test("change derivation records add, modify, delete, mode and symlink changes", () => {
  const before = root("benchmark-before-"); const after = root("benchmark-after-");
  try {
    writeFileSync(join(before, "modify.txt"), "old"); writeFileSync(join(before, "delete.txt"), "gone"); writeFileSync(join(before, "mode.txt"), "same"); chmodSync(join(before, "mode.txt"), 0o644); writeFileSync(join(before, "target-a"), "a"); writeFileSync(join(before, "target-b"), "b"); symlinkSync("target-a", join(before, "link"));
    cpSync(before, after, { recursive: true }); writeFileSync(join(after, "modify.txt"), "new"); unlinkSync(join(after, "delete.txt")); writeFileSync(join(after, "add.txt"), "add"); chmodSync(join(after, "mode.txt"), 0o755); unlinkSync(join(after, "link")); symlinkSync("target-b", join(after, "link"));
    const kinds = deriveChanges(snapshotTree(before, "initial"), snapshotTree(after, "final")).entries.map((entry) => entry.kind).sort();
    assert.deepEqual(kinds, ["add", "delete", "mode_change", "modify", "symlink_change"]);
  } finally { rmSync(before, { recursive: true, force: true }); rmSync(after, { recursive: true, force: true }); }
});

test("delta encoding has an independently fixed compatibility vector", () => {
  const before = root("benchmark-vector-before-"); const after = root("benchmark-vector-after-");
  try {
    writeFileSync(join(before, "a.txt"), "old\n"); cpSync(before, after, { recursive: true }); writeFileSync(join(after, "a.txt"), "new\n");
    const delta = deriveChanges(snapshotTree(before, "initial"), snapshotTree(after, "final"));
    assert.equal(delta.sha256, "6fea31ba33517db088f33f9917ad6f9caa8e992d95aa5d2d2c6f2a35a1ca7ede");
  } finally { rmSync(before, { recursive: true, force: true }); rmSync(after, { recursive: true, force: true }); }
});

test("source maps preserve the exact bytes hashed before controller startup", async () => {
  const fixture = getFixture("logic-bug"); const workspace = createCandidateWorkspace(fixture);
  try {
    writeFileSync(join(workspace, "src/logic.mjs"), "export function isNonEmpty(value) { return value.length > 0; }\n");
    const sourceMap = readCandidateSourceMap(workspace, candidateContract("logic-bug").paths);
    assert.equal(sourceMap.sha256, snapshotTree(workspace, "final").sha256);
    const probe = createProbeTestFactory({ afterSourceMap(rootPath) { writeFileSync(join(rootPath, "src/logic.mjs"), "export function isNonEmpty() { return false; }\n"); } });
    assert.deepEqual(await probe.runCandidateProbe(workspace, logicRequest()), [true]);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("source and snapshot paths reject backslashes, duplicates, and unsafe alternatives", () => {
  const directory = root("benchmark-paths-");
  try {
    writeFileSync(join(directory, "src\\logic.mjs"), "x");
    assert.throws(() => snapshotTree(directory, "final"), /path/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const bytes = Buffer.from("export {};\n");
  const entry = (path) => ({ path, mode: 0o644, size: bytes.length, sha256: sha256(bytes), source: bytes.toString("utf8") });
  assert.throws(() => validateSourceMap([entry("src/logic.mjs"), entry("src/logic.mjs")], ["src/logic.mjs"]), /paths/);
  const accessorMap = [entry("src/logic.mjs")]; Object.defineProperty(accessorMap, "0", { enumerable: true, get: () => entry("src/logic.mjs") });
  assert.throws(() => validateSourceMap(accessorMap, ["src/logic.mjs"]), /property/);
  for (const path of ["src\\logic.mjs", "../logic.mjs", "src/../logic.mjs", "/src/logic.mjs", "src//logic.mjs"]) assert.throws(() => validateSourceMap([entry(path)], [path]), /path/);
  const valid = validateSourceMap([entry("src/nested/logic.mjs")], ["src/nested/logic.mjs"]);
  assert.equal(valid.sourceMap[0].path, "src/nested/logic.mjs");
  const duplicateSnapshot = { entries: [{ path: "src/logic.mjs", type: "file", mode: 0o644, size: 1, sha256: "a".repeat(64) }, { path: "src/logic.mjs", type: "file", mode: 0o644, size: 1, sha256: "a".repeat(64) }] };
  assert.throws(() => deriveChanges(duplicateSnapshot, { entries: [] }), /paths/);
  assert.throws(() => deriveChanges({ entries: [] }, duplicateSnapshot), /paths/);
});

test("source maps reject missing, additional, and import-outside-source files", async () => {
  const fixture = getFixture("logic-bug"); const workspace = createCandidateWorkspace(fixture);
  try {
    writeFileSync(join(workspace, "extra.mjs"), "export {};\n");
    assert.throws(() => readCandidateSourceMap(workspace, candidateContract("logic-bug").paths), /paths/);
    unlinkSync(join(workspace, "extra.mjs")); unlinkSync(join(workspace, "src/logic.mjs"));
    assert.throws(() => readCandidateSourceMap(workspace, candidateContract("logic-bug").paths), /paths/);
    writeFileSync(join(workspace, "src/logic.mjs"), "import './missing.mjs'; export function isNonEmpty() { return true; }\n");
    await assert.rejects(runCandidateProbe(workspace, logicRequest()), /exit 1/);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("VM string and WebAssembly code generation are unavailable on the production probe path", async () => {
  const fixture = getFixture("logic-bug"); const workspace = createCandidateWorkspace(fixture);
  try {
    writeFileSync(join(workspace, "src/logic.mjs"), "export function isNonEmpty() { return Function('return true')(); }\n");
    await assert.rejects(runCandidateProbe(workspace, logicRequest()));
    writeFileSync(join(workspace, "src/logic.mjs"), "export function isNonEmpty() { return new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0])) instanceof WebAssembly.Module; }\n");
    await assert.rejects(runCandidateProbe(workspace, logicRequest()));
    const result = validateCandidateFixture(fixture, { applyCandidate(rootPath) { writeFileSync(join(rootPath, "src/logic.mjs"), "export function isNonEmpty() { return eval('true'); }\n"); } });
    assert.notEqual(result.outcome.status, "passed");
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("transport validation targets every record binding and stream completion rule", async () => {
  const fixture = getFixture("logic-bug"); const workspace = createCandidateWorkspace(fixture); const directory = root("benchmark-controller-");
  try {
    const cases = [
      ["record.run_id = '0'.repeat(32);", /record binding/],
      ["record.fixture_id = 'syntax-build';", /record binding/],
      ["record.operation = 'wrong';", /record binding/],
      ["record.candidate_tree_sha256 = '0'.repeat(64);", /record binding/],
      ["record.extra = true;", /record keys/],
      ["delete record.operation;", /record keys/],
      ["globalThis.__two = true;", /record count/],
      ["globalThis.__none = true;", /record count/],
      ["process.stdout.write('late diagnostic');", /controller diagnostics/],
      ["globalThis.__invalidMac = true;", /record authentication/],
    ];
    for (const [mutation, expected] of cases) {
      const controller = writeFakeController(directory, mutation);
      const probe = createProbeTestFactory({ controller });
      await assert.rejects(probe.runCandidateProbe(workspace, logicRequest()), expected);
    }
  } finally { rmSync(workspace, { recursive: true, force: true }); rmSync(directory, { recursive: true, force: true }); }
});

test("raw evaluator evidence API is intentionally absent and runtime hash reads executable bytes", () => {
  assert.equal(Object.hasOwn(evaluator, "evaluateOfflineRun"), false);
  const executable = join(root("benchmark-executable-"), "runtime");
  try {
    writeFileSync(executable, "first"); const first = executableSha256(executable); writeFileSync(executable, "second");
    assert.notEqual(executableSha256(executable), first);
  } finally { rmSync(executable.slice(0, executable.lastIndexOf("/")), { recursive: true, force: true }); }
});
