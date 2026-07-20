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

const MAX_PATCH_BYTES = 2_000_000;
const MAX_SUMMARY_BYTES = 8_000;
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

export function builderOutputSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["version", "patch", "signal", "summary"],
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
    value = JSON.parse(text.trim());
  } catch {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder response was not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder response must be a JSON object");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "patch,signal,summary,version") {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder response contains unexpected fields");
  }
  if (
    value.version !== 1 ||
    typeof value.patch !== "string" ||
    typeof value.signal !== "string" ||
    typeof value.summary !== "string"
  ) {
    fail("CODEXLOOPER_ENVELOPE_INVALID", "Builder response fields have invalid types");
  }
  if (byteLength(value.patch) > MAX_PATCH_BYTES) {
    fail("CODEXLOOPER_ENVELOPE_TOO_LARGE", "Builder patch exceeds the bounded size");
  }
  if (byteLength(value.summary) > MAX_SUMMARY_BYTES || value.summary.includes("\0")) {
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
    summary: value.summary.trim(),
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
  const root = realpathSync(projectRoot);
  const runId = basename(configuredRunDirectory);
  const expected = resolve(root, ".codexlooper", "runs", runId);
  if (configuredRunDirectory !== expected) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "Builder run directory must stay inside .codexlooper/runs");
  }
  const runDirectory = ensurePrivateDirectoryChain(root, [".codexlooper", "runs", runId]);
  const stat = lstatSync(runDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "Builder run directory must be a regular directory");
  }
  const path = resolve(runDirectory, "builder-output-schema.json");
  writeAtomic(path, `${JSON.stringify(builderOutputSchema(), null, 2)}\n`, 0o600);
  return path;
}
