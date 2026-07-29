import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { ensurePrivateDirectoryChain } from "./runtime-paths.mjs";
import { validateBuilderOperationEnvelope } from "./builder-operations.mjs";

const MAX_PATCH_BYTES = 2_000_000;
const MAX_SUMMARY_BYTES = 8_000;
const ALLOWED_FIELDS = ["overview", "patch", "signal", "summary", "version"];
const REQUIRED_FIELDS = ["patch", "signal"];
const TASK_SIGNALS = new Set(["", "<<<RALPHEX:ALL_TASKS_DONE>>>", "<<<RALPHEX:TASK_FAILED>>>"]);
const REVIEW_SIGNALS = new Set(["", "<<<RALPHEX:REVIEW_DONE>>>", "<<<RALPHEX:TASK_FAILED>>>"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function assertPhase(phase) {
  if (phase !== "task" && phase !== "review") {
    fail("CODEXLOOPER_ENVELOPE_PHASE_INVALID", "Builder envelope phase must be task or review");
  }
}

function jsonCandidate(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/iu);
  if (fenced) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function jsonWhitespace(character) {
  return character === " " || character === "\n" || character === "\r" || character === "\t";
}

function isHex(character) {
  return (
    (character >= "0" && character <= "9") ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
}

function parseStrictJsonObject(text) {
  let index = 0;

  function invalid() {
    fail("CODEXLOOPER_BUILDER_V2_JSON_INVALID", "Builder Envelope v2 must be one strict JSON object");
  }

  function skipWhitespace() {
    while (index < text.length && jsonWhitespace(text[index])) index += 1;
  }

  function consume(character) {
    if (text[index] !== character) invalid();
    index += 1;
  }

  function parseString() {
    const start = index;
    consume('"');
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          invalid();
        }
      }
      if (character < " ") invalid();
      if (character !== "\\") {
        index += 1;
        continue;
      }
      index += 1;
      const escape = text[index];
      if ('"\\/bfnrt'.includes(escape)) {
        index += 1;
        continue;
      }
      if (escape !== "u") invalid();
      index += 1;
      for (let offset = 0; offset < 4; offset += 1) {
        if (!isHex(text[index + offset])) invalid();
      }
      index += 4;
    }
    invalid();
  }

  function parseNumber() {
    if (text[index] === "-") index += 1;
    if (text[index] === "0") {
      index += 1;
    } else {
      if (!(text[index] >= "1" && text[index] <= "9")) invalid();
      while (text[index] >= "0" && text[index] <= "9") index += 1;
    }
    if (text[index] === ".") {
      index += 1;
      if (!(text[index] >= "0" && text[index] <= "9")) invalid();
      while (text[index] >= "0" && text[index] <= "9") index += 1;
    }
    if (text[index] === "e" || text[index] === "E") {
      index += 1;
      if (text[index] === "+" || text[index] === "-") index += 1;
      if (!(text[index] >= "0" && text[index] <= "9")) invalid();
      while (text[index] >= "0" && text[index] <= "9") index += 1;
    }
  }

  function parseLiteral(literal) {
    if (text.slice(index, index + literal.length) !== literal) invalid();
    index += literal.length;
  }

  function parseArray() {
    consume("[");
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (true) {
      parseValue();
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      consume(",");
      skipWhitespace();
    }
  }

  function parseObject() {
    consume("{");
    const keys = new Set();
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (true) {
      if (text[index] !== '"') invalid();
      const key = parseString();
      if (keys.has(key)) {
        fail("CODEXLOOPER_BUILDER_V2_JSON_DUPLICATE_KEY", "Builder Envelope v2 contains a duplicate JSON object key");
      }
      keys.add(key);
      skipWhitespace();
      consume(":");
      skipWhitespace();
      parseValue();
      skipWhitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      consume(",");
      skipWhitespace();
    }
  }

  function parseValue() {
    skipWhitespace();
    if (text[index] === "{") return parseObject();
    if (text[index] === "[") return parseArray();
    if (text[index] === '"') return parseString();
    if (text[index] === "t") return parseLiteral("true");
    if (text[index] === "f") return parseLiteral("false");
    if (text[index] === "n") return parseLiteral("null");
    return parseNumber();
  }

  skipWhitespace();
  if (text[index] !== "{") invalid();
  parseObject();
  skipWhitespace();
  if (index !== text.length) invalid();
  try {
    return JSON.parse(text);
  } catch {
    invalid();
  }
}

export function parseBuilderOperationEnvelopeV2(text) {
  if (typeof text !== "string" || !text.trim()) {
    fail("CODEXLOOPER_BUILDER_V2_JSON_INVALID", "Builder Envelope v2 must not be empty");
  }
  if (byteLength(text) > MAX_PATCH_BYTES) {
    fail("CODEXLOOPER_BUILDER_V2_JSON_TOO_LARGE", "Builder Envelope v2 exceeds the bounded size");
  }
  return validateBuilderOperationEnvelope(parseStrictJsonObject(text));
}

export function builderOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["patch", "signal"],
    properties: {
      version: { const: 1 },
      patch: { type: "string", maxLength: MAX_PATCH_BYTES },
      signal: {
        type: "string",
        enum: [
          "",
          "<<<RALPHEX:ALL_TASKS_DONE>>>",
          "<<<RALPHEX:REVIEW_DONE>>>",
          "<<<RALPHEX:TASK_FAILED>>>",
        ],
      },
      summary: { type: "string", maxLength: MAX_SUMMARY_BYTES },
      overview: { type: "string", maxLength: MAX_SUMMARY_BYTES },
    },
  };
}

export function parseBuilderEnvelope(text, phase) {
  assertPhase(phase);
  if (typeof text !== "string" || !text.trim()) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder returned an empty structured response");
  }
  let value;
  try {
    value = JSON.parse(jsonCandidate(text));
  } catch {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder response was not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder response must be a JSON object");
  }
  const keys = Object.keys(value).sort();
  const missing = REQUIRED_FIELDS.filter((key) => !keys.includes(key));
  const unexpected = keys.filter((key) => !ALLOWED_FIELDS.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      "CODEXLOOPER_ENVELOPE_INVALID",
      `Builder response field mismatch; missing=${missing.join("|") || "none"}; unexpected=${unexpected.join("|") || "none"}`,
    );
  }
  if (
    (value.version !== undefined && value.version !== 1) ||
    typeof value.patch !== "string" ||
    typeof value.signal !== "string" ||
    (value.summary !== undefined && typeof value.summary !== "string") ||
    (value.overview !== undefined && typeof value.overview !== "string")
  ) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder response fields have invalid types");
  }
  if (byteLength(value.patch) > MAX_PATCH_BYTES) {
    fail("CODEXLOOPER_ENVELOPE_TOO_LARGE", "Builder patch exceeds the bounded size");
  }
  const summary = value.summary ?? value.overview ?? "";
  if (byteLength(summary) > MAX_SUMMARY_BYTES || summary.includes("\0")) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder summary is invalid or too large");
  }
  const allowedSignals = phase === "task" ? TASK_SIGNALS : REVIEW_SIGNALS;
  if (!allowedSignals.has(value.signal)) {
    fail("CODEXLOOPER_ENVELOPE_SIGNAL_INVALID", `Builder signal is invalid for ${phase} phase`);
  }
  if (value.signal === "<<<RALPHEX:TASK_FAILED>>>" && value.patch.trim()) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Failed builder responses must not include a patch");
  }
  if (value.signal === "<<<RALPHEX:REVIEW_DONE>>>" && value.patch.trim()) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "REVIEW_DONE requires an empty patch");
  }
  return {
    version: 1,
    patch: value.patch,
    signal: value.signal,
    summary: summary.trim(),
  };
}

function writeAtomic(path, content, mode = 0o600) {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function createBuilderOutputSchemaFile({ sourceEnv = process.env, projectRoot = process.cwd() } = {}) {
  const configuredRunDirectory = sourceEnv.CODEXLOOPER_RUN_DIR;
  if (
    typeof configuredRunDirectory !== "string" ||
    !isAbsolute(configuredRunDirectory) ||
    configuredRunDirectory.includes("\0")
  ) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "CODEXLOOPER_RUN_DIR must be an absolute path");
  }
  const requestedRoot = resolve(projectRoot);
  const runId = basename(configuredRunDirectory);
  const requestedExpected = resolve(requestedRoot, ".codexlooper", "runs", runId);
  if (resolve(configuredRunDirectory) !== requestedExpected) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "Builder run directory must stay inside .codexlooper/runs");
  }
  const root = realpathSync(requestedRoot);
  const runDirectory = ensurePrivateDirectoryChain(root, [".codexlooper", "runs", runId]);
  const stat = lstatSync(runDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "Builder run directory must be a regular directory");
  }
  const path = resolve(runDirectory, "builder-output-schema.json");
  writeAtomic(path, `${JSON.stringify(builderOutputSchema(), null, 2)}\n`, 0o600);
  return path;
}
