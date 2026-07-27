import { posix } from "node:path";

export const CRG_VERSION = "2.3.6";
export const NO_CHANGES_DETECTED = "No changes detected.";
export const MAX_ADVISORY_BYTES = 16_384;
export const MAX_PATH_BYTES = 512;
export const MAX_CHANGED_FILES = 256;
export const MAX_REVIEW_PRIORITIES = 256;
export const MAX_TEST_GAP_COUNT = 100_000;
export const MAX_LINE_NUMBER = 10_000_000;
export const MIN_RISK_SCORE = 0;
export const MAX_RISK_SCORE = 100;

const RESULT_FIELDS = [
  "status",
  "version",
  "duration_ms",
  "report_path",
  "truncated",
  "error_class",
  "advisory",
];
const RESULT_STATUSES = new Set(["disabled", "available", "failed"]);
const ERROR_CLASSES = new Set([
  "unsafe_command",
  "private_paths",
  "environment_integrity",
  "sandbox_unavailable",
  "sandbox_denied",
  "legacy_repository_state",
  "repository_mutation",
  "version_mismatch",
  "timeout",
  "non_zero_exit",
  "output_limit",
  "malformed_json",
  "projection_invalid",
  "internal_error",
]);
const ADVISORY_FIELDS = [
  "base_sha",
  "head_sha",
  "risk_score",
  "changed_files",
  "test_gap_count",
  "review_priorities",
];
const PRIORITY_FIELDS = ["file", "line", "kind"];
const PRIORITY_KINDS = new Set(["changed_function", "changed_class", "changed_module"]);
const SHA = /^[a-f0-9]{40}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", `${label} must be an object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", `${label} has unknown or missing fields`);
  }
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", `${label} must be a non-negative integer`);
  }
  return value;
}

function safeProjectRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    byteLength(value) > MAX_PATH_BYTES ||
    CONTROL.test(value) ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    posix.normalize(value) !== value
  ) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", `${label} must be a safe project-relative path`);
  }
  return value;
}

function validateReportPath(value) {
  if (value === null) return null;
  const path = safeProjectRelativePath(value, "report_path");
  if (!path.startsWith(".codexlooper/runs/")) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "report_path must stay below the private run directory");
  }
  return path;
}

function freezeAdvisory(advisory) {
  return Object.freeze({
    ...advisory,
    changed_files: Object.freeze([...advisory.changed_files]),
    review_priorities: Object.freeze(advisory.review_priorities.map((priority) => Object.freeze({ ...priority }))),
  });
}

export function projectCrgAdvisory(value) {
  const advisory = plainObject(value, "CRG advisory");
  exactKeys(advisory, ADVISORY_FIELDS, "CRG advisory");
  if (typeof advisory.base_sha !== "string" || !SHA.test(advisory.base_sha)) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "base_sha must be a lowercase 40-hex SHA");
  }
  if (typeof advisory.head_sha !== "string" || !SHA.test(advisory.head_sha)) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "head_sha must be a lowercase 40-hex SHA");
  }
  if (
    typeof advisory.risk_score !== "number" ||
    !Number.isFinite(advisory.risk_score) ||
    advisory.risk_score < MIN_RISK_SCORE ||
    advisory.risk_score > MAX_RISK_SCORE
  ) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "risk_score is outside the allowed range");
  }
  if (!Array.isArray(advisory.changed_files) || advisory.changed_files.length > MAX_CHANGED_FILES) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "changed_files exceeds the allowed count");
  }
  const changedFiles = advisory.changed_files.map((path) => safeProjectRelativePath(path, "changed_files entry"));
  if (!Number.isSafeInteger(advisory.test_gap_count) || advisory.test_gap_count < 0 || advisory.test_gap_count > MAX_TEST_GAP_COUNT) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "test_gap_count is outside the allowed range");
  }
  if (!Array.isArray(advisory.review_priorities) || advisory.review_priorities.length > MAX_REVIEW_PRIORITIES) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "review_priorities exceeds the allowed count");
  }
  const reviewPriorities = advisory.review_priorities.map((priority) => {
    const item = plainObject(priority, "review priority");
    exactKeys(item, PRIORITY_FIELDS, "review priority");
    const file = safeProjectRelativePath(item.file, "review priority file");
    if (!Number.isSafeInteger(item.line) || item.line < 0 || item.line > MAX_LINE_NUMBER) {
      fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "review priority line is outside the allowed range");
    }
    if (typeof item.kind !== "string" || !PRIORITY_KINDS.has(item.kind)) {
      fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "review priority kind is not allowlisted");
    }
    return { file, line: item.line, kind: item.kind };
  });
  const projected = {
    base_sha: advisory.base_sha,
    head_sha: advisory.head_sha,
    risk_score: advisory.risk_score,
    changed_files: changedFiles,
    test_gap_count: advisory.test_gap_count,
    review_priorities: reviewPriorities,
  };
  if (byteLength(JSON.stringify(projected)) > MAX_ADVISORY_BYTES) {
    fail("CODEXLOOPER_CRG_PROJECTION_INVALID", "CRG advisory exceeds the encoded byte limit");
  }
  return freezeAdvisory(projected);
}

export function normalizeDetectOutput(output, { baseSha, headSha } = {}) {
  if (output === NO_CHANGES_DETECTED) {
    return projectCrgAdvisory({
      base_sha: baseSha,
      head_sha: headSha,
      risk_score: 0,
      changed_files: [],
      test_gap_count: 0,
      review_priorities: [],
    });
  }
  if (typeof output !== "string") {
    fail("CODEXLOOPER_CRG_MALFORMED_JSON", "CRG detect output must be text");
  }
  let raw;
  try {
    raw = JSON.parse(output);
  } catch {
    fail("CODEXLOOPER_CRG_MALFORMED_JSON", "CRG detect output was not JSON");
  }
  return projectCrgAdvisory(raw);
}

export function createCrgResult({
  status,
  version = null,
  duration_ms = 0,
  report_path = null,
  truncated = false,
  error_class = null,
  advisory = null,
} = {}) {
  if (!RESULT_STATUSES.has(status)) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "CRG result status is invalid");
  }
  nonNegativeInteger(duration_ms, "duration_ms");
  validateReportPath(report_path);
  if (typeof truncated !== "boolean") {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "truncated must be boolean");
  }
  if (version !== null && version !== CRG_VERSION) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "CRG version must be null or the pinned version");
  }
  if (error_class !== null && !ERROR_CLASSES.has(error_class)) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "CRG error_class is invalid");
  }
  const projected = advisory === null ? null : projectCrgAdvisory(advisory);
  if (status === "disabled" && (version !== null || report_path !== null || truncated || error_class !== null || projected !== null)) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "Disabled CRG results may not contain runtime state");
  }
  if (status === "available" && (version !== CRG_VERSION || error_class !== null)) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "Available CRG results require the pinned version and no error");
  }
  if (status === "failed" && error_class === null) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "Failed CRG results require exactly one error class");
  }
  const result = { status, version, duration_ms, report_path, truncated, error_class, advisory: projected };
  exactKeys(result, RESULT_FIELDS, "CRG result");
  return Object.freeze(result);
}

export function disabledCrgResult(duration_ms = 0) {
  return createCrgResult({ status: "disabled", duration_ms });
}

export function redactCrgDiagnostic(value, secret = "", limit = 4_000) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    fail("CODEXLOOPER_CRG_RESULT_INVALID", "Diagnostic limit must be a non-negative integer");
  }
  let text = String(value || "");
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  text = text
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/giu, "[REDACTED]")
    .replace(/(?:api[_-]?key|token|password)\s*[:=]\s*[^\s,;]+/giu, "[REDACTED]");
  return text.slice(-limit);
}
