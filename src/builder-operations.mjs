import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const BUILDER_OPERATION_LIMITS = Object.freeze({
  max_envelope_bytes: 2_000_000,
  max_operations: 256,
  max_path_bytes: 1_024,
  max_content_bytes: 1_000_000,
  max_baseline_files: 10_000,
  max_baseline_bytes: 16_000_000,
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
const PROTOTYPE_SENSITIVE_COMPONENTS = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "prototype",
  "toLocaleString",
  "toString",
  "valueOf",
]);
const ENVELOPE_PREFIX_BYTES = Buffer.byteLength('{"version":2,"operations":[', "utf8");
const ENVELOPE_SUFFIX_BYTES = Buffer.byteLength("]}", "utf8");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function isPlainObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotDataObject(value, label) {
  if (!isPlainObject(value)) {
    fail("CODEXLOOPER_BUILDER_OPERATIONS_INVALID", `${label} must be a plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} must contain only ordinary string-keyed data fields`,
    );
  }
  const snapshot = Object.create(null);
  for (const field of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} fields must be enumerable own data properties`,
      );
    }
    snapshot[field] = descriptor.value;
  }
  return { fields: snapshot, keys: [...ownKeys].sort() };
}

function assertExactSnapshot(snapshot, expected, label) {
  if (
    snapshot.keys.length !== expected.length ||
    snapshot.keys.some((field, index) => field !== expected[index])
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} has unknown or missing fields`,
    );
  }
  return snapshot.fields;
}

function snapshotExactDataObject(value, expected, label) {
  return assertExactSnapshot(snapshotDataObject(value, label), expected, label);
}

function snapshotDenseOrdinaryArray(value, label) {
  if (
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} must be an ordinary Array`,
    );
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value <= 0 ||
    lengthDescriptor.value > BUILDER_OPERATION_LIMITS.max_operations
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} must contain a bounded non-empty operation list`,
    );
  }
  const length = lengthDescriptor.value;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== length + 1 ||
    ownKeys.some(
      (key) =>
        typeof key !== "string" ||
        (key !== "length" && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length)),
    )
  ) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      `${label} must be dense and contain no extra own properties`,
    );
  }
  const snapshot = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} elements must be enumerable own data properties`,
      );
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}

function safePath(
  value,
  label,
  code = "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
) {
  if (
    typeof value !== "string" ||
    !value ||
    byteLength(value) > BUILDER_OPERATION_LIMITS.max_path_bytes ||
    PATH_CONTROL.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (component) =>
          !component ||
          component === "." ||
          component === ".." ||
          PROTOTYPE_SENSITIVE_COMPONENTS.has(component),
      )
  ) {
    fail(
      code,
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
  const snapshot = snapshotDataObject(value, label);
  if (typeof snapshot.fields.type !== "string") {
    fail("CODEXLOOPER_BUILDER_OPERATIONS_INVALID", `${label} has an invalid type`);
  }
  const type = snapshot.fields.type;

  if (type === "create_file") {
    const fields = assertExactSnapshot(snapshot, CREATE_FILE_FIELDS, label);
    if (fields.expected_absent !== true) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} create_file expected_absent must be true`,
      );
    }
    return Object.freeze({
      type: "create_file",
      path: safePath(fields.path, `${label} path`),
      content: boundedContent(fields.content, `${label} content`),
      expected_absent: true,
    });
  }

  if (type === "replace_exact") {
    const fields = assertExactSnapshot(snapshot, REPLACE_EXACT_FIELDS, label);
    if (
      typeof fields.expected_file_sha256 !== "string" ||
      !SHA256.test(fields.expected_file_sha256)
    ) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} expected_file_sha256 must be a lowercase SHA-256 digest`,
      );
    }
    if (fields.expected_occurrences !== 1) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} expected_occurrences must be exactly 1`,
      );
    }
    const oldText = boundedContent(fields.old_text, `${label} old_text`, { nonEmpty: true });
    const newText = boundedContent(fields.new_text, `${label} new_text`);
    if (oldText === newText) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `${label} replace_exact must change the matched text`,
      );
    }
    return Object.freeze({
      type: "replace_exact",
      path: safePath(fields.path, `${label} path`),
      expected_file_sha256: fields.expected_file_sha256,
      old_text: oldText,
      new_text: newText,
      expected_occurrences: 1,
    });
  }

  fail(
    "CODEXLOOPER_BUILDER_OPERATIONS_UNSUPPORTED",
    `${label} type is unsupported: ${type}`,
  );
}

export function validateBuilderOperationEnvelope(value) {
  const fields = snapshotExactDataObject(
    value,
    ENVELOPE_FIELDS,
    "Builder operation envelope",
  );
  if (fields.version !== 2) {
    fail(
      "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      "Builder operation envelope version must be exactly 2",
    );
  }
  const operationValues = snapshotDenseOrdinaryArray(
    fields.operations,
    "Builder operation envelope operations",
  );
  const operations = [];
  const seen = new Set();
  let envelopeBytes = ENVELOPE_PREFIX_BYTES + ENVELOPE_SUFFIX_BYTES;
  for (let index = 0; index < operationValues.length; index += 1) {
    const operation = validateOperation(operationValues[index], index);
    if (seen.has(operation.path)) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
        `Builder operation envelope repeats target path: ${operation.path}`,
      );
    }
    seen.add(operation.path);
    envelopeBytes += (index === 0 ? 0 : 1) + byteLength(JSON.stringify(operation));
    if (envelopeBytes > BUILDER_OPERATION_LIMITS.max_envelope_bytes) {
      fail(
        "CODEXLOOPER_BUILDER_OPERATIONS_TOO_LARGE",
        "Builder operation envelope exceeds its encoded byte limit",
      );
    }
    operations.push(operation);
  }

  return Object.freeze({
    version: 2,
    operations: Object.freeze(operations),
  });
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
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > BUILDER_OPERATION_LIMITS.max_baseline_files) {
    fail(
      "CODEXLOOPER_BUILDER_BASELINE_INVALID",
      "Builder operation baseline exceeds its file-count limit",
    );
  }
  const entries = [];
  let totalBytes = 0;
  for (const path of ownKeys) {
    if (typeof path !== "string") {
      fail(
        "CODEXLOOPER_BUILDER_BASELINE_INVALID",
        "Builder operation baseline paths must be ordinary string keys",
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, path);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(
        "CODEXLOOPER_BUILDER_BASELINE_INVALID",
        `Builder operation baseline files must be enumerable own data properties: ${path}`,
      );
    }
    const content = descriptor.value;
    safePath(
      path,
      "Builder operation baseline path",
      "CODEXLOOPER_BUILDER_BASELINE_INVALID",
    );
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
    entries.push([path, content]);
  }
  return entries.sort(([left], [right]) => compareText(left, right));
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
  const envelope = validateBuilderOperationEnvelope(envelopeValue);
  const baselineEntries = validateBaselineFiles(baselineFiles);
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

  const materialized = new Map(
    [...files.entries()].sort(([left], [right]) => compareText(left, right)),
  );
  return {
    files: materialized,
    changed_paths: envelope.operations.map((operation) => operation.path).sort(),
  };
}
