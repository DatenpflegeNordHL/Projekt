import { createHmac } from "node:crypto";
import { posix } from "node:path";
import vm from "node:vm";
import { candidateContract } from "./candidate-contract.mjs";
import { assertSafePosixPath, validateSourceMap } from "./candidate-source-map.mjs";

const safeSend = process.send?.bind(process);
const safeDisconnect = process.disconnect?.bind(process);
const safeExit = process.exit.bind(process);
const safeJsonStringify = JSON.stringify;
const safeCreateHmac = createHmac;
const MAX_VALUE_BYTES = 4096;

function fail(message) { throw new Error(`BENCHMARK_CONTROLLER_INVALID: ${message}`); }
function plain(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail("message shape");
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail("message keys");
  return value;
}
function boundedString(value) { return typeof value === "string" && Buffer.byteLength(value, "utf8") <= MAX_VALUE_BYTES; }
function modulePath(fixture) { return candidateContract(fixture).entry; }
function resolveImport(referencingPath, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) fail("candidate import");
  const path = posix.normalize(posix.join(posix.dirname(referencingPath), specifier));
  try { return assertSafePosixPath(path, "candidate import"); }
  catch { fail("candidate import"); }
}
async function loadNamespace(sourceMap, fixture) {
  const context = vm.createContext(Object.create(null), { name: "codexlooper-candidate", codeGeneration: { strings: false, wasm: false } });
  const sourceByPath = new Map(sourceMap.map((entry) => [entry.path, entry.source]));
  const modules = new Map();
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    const source = sourceByPath.get(path);
    if (typeof source !== "string") fail("candidate module path");
    const module = new vm.SourceTextModule(source, { context, identifier: path });
    modules.set(path, module);
    await module.link(async (specifier, referencingModule) => {
      return load(resolveImport(referencingModule.identifier, specifier));
    });
    return module;
  }
  const entry = modulePath(fixture);
  const module = await load(entry);
  await module.evaluate();
  return module.namespace;
}
function valuesFor(namespace, request) {
  if (request.fixture === "logic-bug" && request.operation === "isNonEmpty") {
    if (typeof namespace.isNonEmpty !== "function") fail("logic API");
    return request.inputs.map((input) => {
      const value = namespace.isNonEmpty(input);
      if (typeof value !== "boolean") fail("logic result");
      return value;
    });
  }
  if (request.fixture === "cross-file-cause" && request.operation === "displayName") {
    if (typeof namespace.displayName !== "function") fail("consumer API");
    return request.inputs.map((input) => {
      const value = namespace.displayName(input);
      if (!boundedString(value)) fail("consumer result");
      return value;
    });
  }
  if (request.fixture === "syntax-build" && request.operation === "greeting") {
    if (typeof namespace.message !== "string" || typeof namespace.greeting !== "function" || !boundedString(namespace.message)) fail("entry API");
    return request.inputs.map((input) => {
      const greeting = namespace.greeting(input);
      if (!boundedString(greeting)) fail("entry result");
      return { message: String(namespace.message), greeting: String(greeting) };
    });
  }
  fail("operation");
}
function mac(key, record) { return safeCreateHmac("sha256", key).update(safeJsonStringify(record), "utf8").digest("hex"); }

process.once("message", async (message) => {
  try {
    plain(message, ["type", "key", "run_id", "fixture_id", "candidate_tree_sha256", "request", "source_map"]);
    if (message.type !== "start" || !/^[0-9a-f]{32}$/.test(message.run_id) || !/^[0-9a-f]{64}$/.test(message.candidate_tree_sha256) || typeof message.fixture_id !== "string" || typeof message.key !== "string") fail("start identity");
    const request = plain(message.request, ["fixture", "operation", "inputs"]);
    if (request.fixture !== message.fixture_id || !Array.isArray(request.inputs) || request.inputs.length > 16 || request.inputs.some((input) => !boundedString(input))) fail("request");
    const key = Buffer.from(message.key, "base64"); if (key.length !== 32) fail("key");
    const source = validateSourceMap(message.source_map, candidateContract(request.fixture).paths);
    if (source.sha256 !== message.candidate_tree_sha256) fail("source digest");
    const namespace = await loadNamespace(source.sourceMap, request.fixture);
    const values = valuesFor(namespace, request);
    const record = { protocol: 2, run_id: message.run_id, fixture_id: message.fixture_id, operation: request.operation, candidate_tree_sha256: message.candidate_tree_sha256, values };
    const result = { type: "result", record, mac: mac(key, record) };
    if (!safeSend) fail("IPC unavailable");
    safeSend(result, undefined, undefined, () => { if (safeDisconnect) safeDisconnect(); safeExit(0); });
  } catch {
    safeExit(1);
  }
});
