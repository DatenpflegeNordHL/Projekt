import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { candidateContract } from "./candidate-contract.mjs";
import { readCandidateSourceMap } from "./evaluate-result.mjs";
import { validateSourceMap } from "./candidate-source-map.mjs";

const controllerPath = fileURLToPath(new URL("./probe-controller.mjs", import.meta.url));
const harnessDirectory = fileURLToPath(new URL(".", import.meta.url));
const MAX_DIAGNOSTIC_BYTES = 8192;
const MAX_RESULT_MESSAGE_BYTES = 256 * 1024;
const TIMEOUT_MS = 3000;

function fail(message, code = "BENCHMARK_PROBE_FAILED") { const error = new Error(`${code}: ${message}`); error.code = code; throw error; }
function plain(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail("record shape");
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail("record keys");
  return value;
}
function canonical(record) { return JSON.stringify(record); }
function mac(key, record) { return createHmac("sha256", key).update(canonical(record), "utf8").digest("hex"); }
function validValues(record, request) {
  if (!Array.isArray(record.values) || record.values.length !== request.inputs.length) return false;
  if (request.fixture === "logic-bug") return record.values.every((value) => typeof value === "boolean");
  if (request.fixture === "cross-file-cause") return record.values.every((value) => typeof value === "string" && Buffer.byteLength(value, "utf8") <= 4096);
  if (request.fixture === "syntax-build") return record.values.every((value) => value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join(",") === "greeting,message" && typeof value.message === "string" && typeof value.greeting === "string");
  return false;
}
function verifyRecord(message, key, expected) {
  plain(message, ["type", "record", "mac"]);
  if (message.type !== "result" || typeof message.mac !== "string" || !/^[0-9a-f]{64}$/.test(message.mac)) fail("record envelope");
  const record = plain(message.record, ["protocol", "run_id", "fixture_id", "operation", "candidate_tree_sha256", "values"]);
  if (record.protocol !== 2 || record.run_id !== expected.runId || record.fixture_id !== expected.request.fixture || record.operation !== expected.request.operation || record.candidate_tree_sha256 !== expected.treeSha || !validValues(record, expected.request)) fail("record binding");
  const actual = Buffer.from(message.mac, "hex"); const expectedMac = Buffer.from(mac(key, record), "hex");
  if (actual.length !== expectedMac.length || !timingSafeEqual(actual, expectedMac)) fail("record authentication");
  return record.values;
}
function messageBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
  catch { return MAX_RESULT_MESSAGE_BYTES + 1; }
}

function sourceMapForProbe(workspace, paths) {
  const supplied = process.env.BENCHMARK_CANDIDATE_SOURCE_MAP;
  if (supplied === undefined) return readCandidateSourceMap(workspace, paths);
  return validateSourceMap(JSON.parse(supplied), paths);
}

function runCandidateProbeInternal(workspace, request, { controller = controllerPath, afterSourceMap } = {}) {
  if (!request || typeof request !== "object" || typeof request.fixture !== "string" || typeof request.operation !== "string" || !Array.isArray(request.inputs)) return Promise.reject(Object.assign(new Error("BENCHMARK_PROBE_FAILED: request"), { code: "BENCHMARK_PROBE_FAILED" }));
  let contract;
  try { contract = candidateContract(request.fixture); }
  catch (error) { return Promise.reject(error); }
  let source;
  try { source = sourceMapForProbe(workspace, contract.paths); }
  catch (error) { return Promise.reject(error); }
  try { afterSourceMap?.(workspace, source); }
  catch (error) { return Promise.reject(error); }
  const key = randomBytes(32); const expected = { runId: randomBytes(16).toString("hex"), request, treeSha: source.sha256 };
  return new Promise((resolve, reject) => {
    const child = fork(controller, [], { cwd: harnessDirectory, env: {}, execArgv: ["--experimental-vm-modules", "--no-warnings"], serialization: "json", stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let message = null; let messageCount = 0; let exceeded = false; let timedOut = false; let transportError = null; let settled = false;
    const cleanup = [];
    const listen = (emitter, event, handler) => { emitter.on(event, handler); cleanup.push(() => emitter.removeListener(event, handler)); };
    const terminate = () => { if (!child.killed) child.kill("SIGKILL"); };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const remove of cleanup) remove();
      if (error) reject(error); else resolve(value);
    };
    const append = (stream, chunk) => {
      const next = Buffer.concat([stream, Buffer.from(chunk)]);
      if (next.length > MAX_DIAGNOSTIC_BYTES) { exceeded = true; terminate(); return stream; }
      return next;
    };
    listen(child.stdout, "data", (chunk) => { stdout = append(stdout, chunk); });
    listen(child.stderr, "data", (chunk) => { stderr = append(stderr, chunk); });
    listen(child.stdout, "error", (error) => { transportError ??= error; terminate(); });
    listen(child.stderr, "error", (error) => { transportError ??= error; terminate(); });
    const timer = setTimeout(() => { timedOut = true; terminate(); }, TIMEOUT_MS);
    listen(child, "message", (candidateMessage) => {
      messageCount += 1;
      if (messageBytes(candidateMessage) > MAX_RESULT_MESSAGE_BYTES) { exceeded = true; terminate(); return; }
      message = candidateMessage;
    });
    listen(child, "error", (error) => { transportError ??= error; terminate(); });
    listen(child, "close", (code, signal) => {
      try {
        if (transportError) fail(`transport ${transportError.code ?? transportError.message}`);
        if (timedOut) fail("timeout", "BENCHMARK_PROBE_TIMEOUT");
        if (exceeded) fail("message or diagnostic size");
        if (signal) fail(`signal ${signal}`);
        if (code !== 0) fail(`exit ${code ?? "unknown"}`);
        if (messageCount !== 1) fail("record count");
        if (stdout.length || stderr.length) fail("controller diagnostics");
        finish(null, verifyRecord(message, key, expected));
      } catch (error) { finish(error); }
    });
    try {
      child.send({ type: "start", key: key.toString("base64"), run_id: expected.runId, fixture_id: request.fixture, candidate_tree_sha256: expected.treeSha, request, source_map: source.sourceMap }, (error) => { if (error) { transportError ??= error; terminate(); } });
    } catch (error) { transportError ??= error; terminate(); }
  });
}

export function runCandidateProbe(workspace, request) { return runCandidateProbeInternal(workspace, request); }

export function createProbeTestFactory(options = {}) {
  return Object.freeze({ runCandidateProbe(workspace, request) { return runCandidateProbeInternal(workspace, request, options); } });
}
