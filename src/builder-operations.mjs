import { createHash } from "node:crypto";

export const BUILDER_OPERATION_LIMITS = Object.freeze({
  max_envelope_bytes: 2_000_000,
  max_operations: 256,
  max_path_bytes: 1_024,
  max_content_bytes: 1_000_000,
  max_baseline_files: 10_000,
  max_baseline_bytes: 64_000_000,
});

const ENVELOPE_FIELDS = Object.freeze(["operations", "version"]);
const CREATE_FILE_FIELDS = Object.freeze(["content", "expected_absent", "path", "type"]);
const REPLACE_EXACT_FIELDS = Object.freeze([
  "expected_file_sha256",
  "expected_occurrences",
  "new_text",
  "old_text",
  "path",
  "type",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const PATH_CONTROL = /[\u0000-\u001f\u007f]/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, expected, label) {
  if (!isPlainObject(value)) {
    fail("CODEXLOOPER_BUILDER_OPERATIONS_INVALID", `${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} has unknown or missing fields`,
    );
  }
}

function safePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    byteLength(value) > BUILDER_OPERATION_LIMITS.max_path_bytes ||
    PATH_CONTROL.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((component) => !component || component === "." || component === "..")
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} must be a safe project-relative POSIX path`,
    );
  }
  return value;
}

function boundedContent(value, label, { nonEmpty = false } = {}) {
  if (
    typeof value !== "string" ||
    (nonEmpty && value.length === 0) ||
    value.includes("\0") ||
    byteLength(value) > BUILDER_OPERATION_LIMITS.max_content_bytes
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} must be bounded${nonEmpty ? " non-empty" : ""} text`,
    );
  }
  return value;
}

function validateOperation(value, index) {
  const label = `Builder operation ${index}`;
  if (!isPlainObject(value) || typeof value.type !== "string") {
    fail("CODEXLOOPER_BUILDER_OPERATIONS_INVALID", `${label} has an invalid type`);
  }

  if (value.type === "create_file") {
    exactFields(value, CREATE_FILE_FIELDS, label);
    if (value.expected_absent !== true) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} create_file expected_absent must be true`,
      );
    }
    return Object.freeze({
      type: "create_file",
      path: safePath(value.path, `${label} path`),
      content: boundedContent(value.content, `${label} content`),
      expected_absent: true,
    });
  }

  if (value.type === "replace_exact") {
    exactFields(value, REPLACE_EXACT_FIELDS, label);
    if (
      typeof value.expected_file_sha256 !== "string" ||
      !SHA256.test(value.expected_file_sha256)
    ) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} expected_file_sha256 must be a lowercase SHA-256 digest`,
      );
    }
    if (value.expected_occurrences !== 1) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} expected_occurrences must be exactly 1`,
      );
    }
    return Object.freeze({
      type: "replace_exact",
      path: safePath(value.path, `${label} path`),
      expected_file_sha256: value.expected_file_sha256,
      old_text: boundedContent(value.old_text, `${label} old_text`, { nonEmpty: true }),
      new_text: boundedContent(value.new_text, `${label} new_text`),
      expected_occurrences: 1,
    });
  }

  fail(
    "CODEXLOOPER_BUILDER_OPERATIONS_UNSUPPORTED",
    `${label} type is unsupported: ${value.type}`,
  );
}

function encodedEnvelopeBytes(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail("CODEXLOOPER_BUILDER_OPERATIONS_INVALID", "Builder operation envelope is not JSON-compatible");
  }
  return byteLength(encoded);
}

export function validateBuilderOperationEnvelope(value) {
  exactFields(value, ENVELOPE_FIELDS, "Builder operation envelope");
  if (value.version !== 2) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      "Builder operation envelope version must be exactly 2",
    );
  }
  if (
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    value.operations.length > BUILDER_OPERATION_LIMITS.max_operations
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      "Builder operation envelope must contain a bounded non-empty operations array",
    );
  }

  const operations = Array.from(value.operations, (operation, index) =>
    validateOperation(operation, index),
  );
  const seen = new Set();
  for (const operation of operations) {
    if (seen.has(operation.path)) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `Builder operation envelope repeats target path: ${operation.path}`,
      );
    }
    seen.add(operation.path);
  }

  const envelope = Object.freeze({
    version: 2,
    operations: Object.freeze(operations),
  });
  if (encodedEnvelopeBytes(envelope) > BUILDER_OPERATION_LIMITS.max_envelope_bytes) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_TOO_LARGE",
      "Builder operation envelope exceeds its encoded byte limit",
    );
  }
  return envelope;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateBaselineFiles(value) {
  if (!isPlainObject(value)) {
    fail(
      "CODEXLOOPER_BUILDER_BASELINE_INVALID",
      "Builder operation baseline must be a plain object",
    );
  }
  const entries = Object.entries(value).sort(([left], [right]) => compareText(left, right));
  if (entries.length > BUILDER_OPERATION_LIMITS.max_baseline_files) {
    fail(
      "CODEXLOOPER_BUILDER_BASELINE_INVALID",
      "Builder operation baseline exceeds its file-count limit",
    );
  }
  let totalBytes = 0;
  for (const [path, content] of entries) {
    safePath(path, "Builder operation baseline path");
    if (typeof content !== "string" || content.includes("\0")) {
      fail(
        "CODEXLOOPER_BUILDER_BASELINE_INVALID",
        `Builder operation baseline file must contain text: ${path}`,
      );
    }
    totalBytes += byteLength(content);
    if (totalBytes > BUILDER_OPERATION_LIMITS.max_baseline_bytes) {
      fail(
        "CODEXLOOPER_BUILDER_BASELINE_INVALID",
        "Builder operation baseline exceeds its byte limit",
      );
    }
  }
  return entries;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function occurrenceCount(haystack, needle) {
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const match = haystack.indexOf(needle, offset);
    if (match === -1) break;
    count += 1;
    if (count > 1) break;
    offset = match + 1;
  }
  return count;
}

export function materializeBuilderOperations(baselineFiles, envelopeValue) {
  const baselineEntries = validateBaselineFiles(baselineFiles);
  const envelope = validateBuilderOperationEnvelope(envelopeValue);
  const files = new Map(baselineEntries);

  for (const operation of envelope.operations) {
    if (operation.type === "create_file") {
      if (files.has(operation.path)) {
        fail(
          "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
          `create_file target already exists: ${operation.path}`,
        );
      }
      files.set(operation.path, operation.content);
      continue;
    }

    if (!files.has(operation.path)) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
        `replace_exact target is absent: ${operation.path}`,
      );
    }
    const baselineContent = files.get(operation.path);
    if (sha256(baselineContent) !== operation.expected_file_sha256) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
        `replace_exact baseline hash is stale: ${operation.path}`,
      );
    }
    if (occurrenceCount(baselineContent, operation.old_text) !== 1) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
        `replace_exact old_text must occur exactly once: ${operation.path}`,
      );
    }
    const match = baselineContent.indexOf(operation.old_text);
    files.set(
      operation.path,
      `${baselineContent.slice(0, match)}${operation.new_text}${baselineContent.slice(match + operation.old_text.length)}`,
    );
  }

  const materialized = Object.fromEntries(
    [...files.entries()].sort(([left], [right]) => compareText(left, right)),
  );
  return {
    files: materialized,
    changed_paths: envelope.operations.map((operation) => operation.path).sort(),
  };
}
