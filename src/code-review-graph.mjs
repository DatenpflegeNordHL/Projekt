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

const { createHash } = await import("node:crypto");
const {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} = await import("node:fs");
const { basename, isAbsolute, relative, resolve, sep } = await import("node:path");

export const CRG_ENVIRONMENT_MANIFEST_SCHEMA = "codexlooper.crg-environment.v1";
export const CRG_LEGACY_REPOSITORY_PATHS = Object.freeze([
  ".code-review-graph.db",
  ".code-review-graph.db-wal",
  ".code-review-graph.db-shm",
  ".code-review-graph.db-journal",
]);

const PYTHON_LAUNCHER = /^python(?:3(?:\.\d+)?)?$/u;

function foundationFail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function foundationSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalDirectory(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", `${label} must be an absolute path`);
  }
  let stat;
  let canonical;
  try {
    stat = lstatSync(path);
    canonical = realpathSync(path);
  } catch {
    foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", `${label} does not exist: ${path}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", `${label} must be a non-symlink directory: ${path}`);
  }
  return canonical;
}

function canonicalRegularFile(path, label, code = "CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY") {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    foundationFail(code, `${label} must be an absolute path`);
  }
  let stat;
  let canonical;
  try {
    stat = lstatSync(path);
    canonical = realpathSync(path);
    accessSync(canonical, constants.X_OK);
  } catch {
    foundationFail(code, `${label} must be an executable regular file: ${path}`);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || canonical !== path) {
    foundationFail(code, `${label} must be a canonical non-symlink regular file: ${path}`);
  }
  return {
    path: canonical,
    mode: stat.mode & 0o777,
    size: stat.size,
    sha256: foundationSha256(readFileSync(canonical)),
  };
}

function relativeInside(root, path) {
  const value = relative(root, path);
  return Boolean(value) && !value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value);
}

function assertBelow(root, path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0") || !relativeInside(root, resolve(path))) {
    foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", `${label} must stay below the private run directory`);
  }
  if (existsSync(path) && !relativeInside(root, realpathSync(path))) {
    foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", `${label} traverses a symlink outside the private run directory`);
  }
  return resolve(path);
}

function manifestEntryPath(root, path) {
  return relative(root, path).split(sep).join("/");
}

function inspectEnvironmentEntries(root, interpreterPath) {
  const entries = [];
  const visit = (directory) => {
    const names = readdirSync(directory).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      const entryPath = manifestEntryPath(root, path);
      if (stat.isDirectory()) {
        entries.push({ path: entryPath, type: "directory", mode: stat.mode & 0o777 });
        visit(path);
        continue;
      }
      if (stat.isFile()) {
        entries.push({
          path: entryPath,
          type: "file",
          mode: stat.mode & 0o777,
          size: stat.size,
          sha256: foundationSha256(readFileSync(path)),
        });
        continue;
      }
      if (!stat.isSymbolicLink()) {
        foundationFail("CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY", `CRG environment contains an unsupported entry: ${entryPath}`);
      }
      let resolved;
      try {
        resolved = realpathSync(path);
      } catch {
        foundationFail("CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY", `CRG environment contains a dangling symlink: ${entryPath}`);
      }
      const targetInsideEnvironment = resolved === root || relativeInside(root, resolved);
      if (!targetInsideEnvironment) {
        const parent = manifestEntryPath(root, directory);
        if (parent !== "bin" || !PYTHON_LAUNCHER.test(name) || resolved !== interpreterPath) {
          foundationFail("CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY", `CRG environment has an unexpected external symlink: ${entryPath}`);
        }
      }
      entries.push({
        path: entryPath,
        type: "symlink",
        mode: stat.mode & 0o777,
        link_target: readlinkSync(path),
        resolved_target: resolved,
        target_inside_environment: targetInsideEnvironment,
      });
    }
  };
  visit(root);
  return entries;
}

export function captureCrgEnvironmentIdentity({ environmentRoot, interpreterPath, commandPath } = {}) {
  const root = canonicalDirectory(environmentRoot, "CRG environment root");
  const interpreter = canonicalRegularFile(interpreterPath, "CRG interpreter");
  const command = canonicalRegularFile(commandPath, "CRG console command", "CODEXLOOPER_CRG_UNSAFE_COMMAND");
  if (!relativeInside(root, command.path)) {
    foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG console command must stay inside the sealed environment");
  }
  return Object.freeze({
    schema: CRG_ENVIRONMENT_MANIFEST_SCHEMA,
    environment_root: root,
    entries: Object.freeze(inspectEnvironmentEntries(root, interpreter.path).map((entry) => Object.freeze(entry))),
    interpreter: Object.freeze(interpreter),
    command: Object.freeze(command),
  });
}

export function verifyCrgEnvironmentIdentity({ environmentRoot, interpreterPath, commandPath, manifest } = {}) {
  if (!manifest || typeof manifest !== "object" || manifest.schema !== CRG_ENVIRONMENT_MANIFEST_SCHEMA) {
    foundationFail("CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY", "CRG environment manifest schema is invalid");
  }
  const actual = captureCrgEnvironmentIdentity({ environmentRoot, interpreterPath, commandPath });
  if (JSON.stringify(actual) !== JSON.stringify(manifest)) {
    foundationFail("CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY", "CRG environment does not match its sealed manifest");
  }
  return actual;
}

export function validateCrgPrivatePaths({ projectRoot, runDir, homeDir, dataDir } = {}) {
  const project = canonicalDirectory(projectRoot, "Project root");
  const run = canonicalDirectory(runDir, "CRG private run directory");
  const home = assertBelow(run, homeDir ?? resolve(run, "crg-home"), "CRG home directory");
  const data = assertBelow(run, dataDir ?? resolve(run, "crg-data"), "CRG data directory");
  return Object.freeze({ project_root: project, run_dir: run, home_dir: home, data_dir: data });
}

export function createCrgChildEnvironment(options = {}) {
  const paths = validateCrgPrivatePaths(options);
  return Object.freeze({
    HOME: paths.home_dir,
    CRG_DATA_DIR: paths.data_dir,
    CRG_REPO_ROOT: paths.project_root,
    CRG_PARSE_EXECUTOR: "thread",
    CRG_PARSE_WORKERS: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONSAFEPATH: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
    PATH: "/usr/bin:/bin",
  });
}

export function assertNoLegacyCrgRepositoryState(projectRoot) {
  const root = canonicalDirectory(projectRoot, "Project root");
  const present = CRG_LEGACY_REPOSITORY_PATHS.filter((name) => existsSync(resolve(root, name)));
  if (present.length > 0) {
    foundationFail("CODEXLOOPER_CRG_LEGACY_REPOSITORY_STATE", `Legacy CRG repository state is present: ${present.join(", ")}`);
  }
  return Object.freeze({ project_root: root, legacy_paths: Object.freeze([]) });
}

export function verifyLegacyCrgRepositoryState(snapshot, projectRoot = snapshot?.project_root) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.legacy_paths) || snapshot.legacy_paths.length !== 0) {
    foundationFail("CODEXLOOPER_CRG_LEGACY_REPOSITORY_STATE", "Legacy CRG repository snapshot is invalid");
  }
  const actual = assertNoLegacyCrgRepositoryState(projectRoot);
  if (actual.project_root !== snapshot.project_root) {
    foundationFail("CODEXLOOPER_CRG_LEGACY_REPOSITORY_STATE", "Project root changed after CRG legacy-state capture");
  }
  return actual;
}
