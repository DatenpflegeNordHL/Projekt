import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { sha256 } from "../schema/benchmark-result.v1.mjs";
import { assertSafePosixPath } from "./candidate-source-map.mjs";
import { candidateContract } from "./candidate-contract.mjs";
import { applyLogicBugRepair } from "../reference-repairs/logic-bug.mjs";
import { applySyntaxBuildRepair } from "../reference-repairs/syntax-build.mjs";
import { applyCrossFileCauseRepair } from "../reference-repairs/cross-file-cause.mjs";

const fixturesRoot = fileURLToPath(new URL("../fixtures/", import.meta.url));
const publicChecksRoot = fileURLToPath(new URL("../public-checks/", import.meta.url));
const verifiersRoot = fileURLToPath(new URL("../verifiers/", import.meta.url));
const COMMAND_IDS = Object.freeze({ publicCheck: "public-check", hiddenVerifier: "hidden-success-verifier" });

function safePath(path) {
  try { return assertSafePosixPath(path, "fixture"); }
  catch { throw new Error(`BENCHMARK_FIXTURE_PATH_INVALID: ${path}`); }
}

function plain(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) throw new Error(`BENCHMARK_MANIFEST_INVALID: ${name}`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`BENCHMARK_MANIFEST_INVALID: ${name}`);
  }
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`BENCHMARK_MANIFEST_INVALID: ${name}`);
  return value;
}

function files(root, current = root, result = {}) {
  for (const name of readdirSync(current).sort()) {
    const file = join(current, name); const relativePath = safePath(relative(root, file)); const stat = lstatSync(file);
    if (stat.isDirectory()) files(root, file, result);
    else if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) !== 0) throw new Error(`BENCHMARK_FIXTURE_INPUT_UNSAFE: ${relativePath}`);
    else {
      if (Object.hasOwn(result, relativePath)) throw new Error(`BENCHMARK_FIXTURE_INPUT_DUPLICATE: ${relativePath}`);
      result[relativePath] = sha256(readFileSync(file));
    }
  }
  return result;
}

function inputSha256(initialFiles) {
  const hash = createHash("sha256").update("codexlooper.fixture-input.v1\0", "utf8");
  for (const path of Object.keys(initialFiles).sort()) hash.update(path, "utf8").update("\0").update(initialFiles[path], "hex");
  return hash.digest("hex");
}

function command(id, scriptPath) {
  return Object.freeze({ id, executable: process.execPath, args: Object.freeze([]), scriptPath });
}

function manifest({ id, allowedPaths, candidateInputPaths, repair }) {
  const initialRoot = join(fixturesRoot, id, "initial"); const initialFiles = files(initialRoot);
  return Object.freeze({
    id,
    version: 1,
    initialRoot,
    initialFiles: Object.freeze(initialFiles),
    inputSha256: inputSha256(initialFiles),
    allowedPaths: Object.freeze([...allowedPaths].sort()),
    candidateInputPaths: Object.freeze([...candidateInputPaths].sort()),
    commands: Object.freeze({
      public_check: command(COMMAND_IDS.publicCheck, join(publicChecksRoot, id, "public-check.mjs")),
      hidden_verifier: command(COMMAND_IDS.hiddenVerifier, join(verifiersRoot, id, "success-verifier.mjs")),
    }),
    referenceRepair: Object.freeze({ id: `reference-repair:${id}`, apply: repair }),
  });
}

export const FIXTURES = Object.freeze([
  manifest({ id: "logic-bug", allowedPaths: candidateContract("logic-bug").paths, candidateInputPaths: candidateContract("logic-bug").paths, repair: applyLogicBugRepair }),
  manifest({ id: "syntax-build", allowedPaths: candidateContract("syntax-build").paths, candidateInputPaths: candidateContract("syntax-build").paths, repair: applySyntaxBuildRepair }),
  manifest({ id: "cross-file-cause", allowedPaths: candidateContract("cross-file-cause").paths, candidateInputPaths: candidateContract("cross-file-cause").paths, repair: applyCrossFileCauseRepair }),
]);

export function validateManifestContract(entry) {
  plain(entry, "manifest", ["id", "version", "initialRoot", "initialFiles", "inputSha256", "allowedPaths", "candidateInputPaths", "commands", "referenceRepair"]);
  if (typeof entry.id !== "string" || !entry.id || entry.version !== 1 || typeof entry.initialRoot !== "string" || typeof entry.inputSha256 !== "string") throw new Error("BENCHMARK_MANIFEST_INVALID: identity");
  for (const listName of ["allowedPaths", "candidateInputPaths"]) {
    if (!Array.isArray(entry[listName]) || entry[listName].some((path) => typeof path !== "string" || safePath(path) !== path) || new Set(entry[listName]).size !== entry[listName].length) throw new Error(`BENCHMARK_MANIFEST_INVALID: ${listName}`);
  }
  plain(entry.commands, "commands", ["public_check", "hidden_verifier"]);
  for (const [name, expectedId, expectedPath] of [["public_check", COMMAND_IDS.publicCheck, join(publicChecksRoot, entry.id, "public-check.mjs")], ["hidden_verifier", COMMAND_IDS.hiddenVerifier, join(verifiersRoot, entry.id, "success-verifier.mjs")]]) {
    const definition = plain(entry.commands[name], `commands.${name}`, ["id", "executable", "args", "scriptPath"]);
    if (definition.id !== expectedId || definition.executable !== process.execPath || !Array.isArray(definition.args) || definition.args.length !== 0 || definition.scriptPath !== expectedPath || !lstatSync(definition.scriptPath).isFile()) throw new Error(`BENCHMARK_MANIFEST_INVALID: commands.${name}`);
  }
  const repair = plain(entry.referenceRepair, "referenceRepair", ["id", "apply"]);
  if (repair.id !== `reference-repair:${entry.id}` || typeof repair.apply !== "function") throw new Error("BENCHMARK_MANIFEST_INVALID: referenceRepair");
  return true;
}

export function validateInitialFixture(entry) {
  validateManifestContract(entry);
  const actual = files(entry.initialRoot);
  if (Object.keys(actual).some((path) => !entry.candidateInputPaths.includes(path))) throw new Error(`BENCHMARK_CANDIDATE_INPUT_FORBIDDEN: ${entry.id}`);
  if (Object.keys(actual).length !== entry.candidateInputPaths.length) throw new Error(`BENCHMARK_CANDIDATE_INPUT_INVALID: ${entry.id}`);
  if (JSON.stringify(actual) !== JSON.stringify(entry.initialFiles)) throw new Error(`BENCHMARK_FIXTURE_TAMPERED: ${entry.id}`);
  if (inputSha256(actual) !== entry.inputSha256) throw new Error(`BENCHMARK_FIXTURE_INPUT_INVALID: ${entry.id}`);
  return true;
}

export function validateFixtureSet(entries = FIXTURES) {
  if (!Array.isArray(entries) || new Set(entries.map((entry) => entry?.id)).size !== entries.length) throw new Error("BENCHMARK_MANIFEST_DUPLICATE_ID");
  for (const entry of entries) validateInitialFixture(entry);
  return true;
}

export function getFixture(id) { const fixture = FIXTURES.find((entry) => entry.id === id); if (!fixture) throw new Error(`BENCHMARK_FIXTURE_UNKNOWN: ${id}`); return fixture; }
