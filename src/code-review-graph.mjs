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
export const CRG_EXECUTION_LIMITS = Object.freeze({
  version_timeout_ms: 10_000,
  build_timeout_ms: 120_000,
  detect_changes_timeout_ms: 30_000,
  output_bytes: 1_048_576,
  report_bytes: 65_536,
});

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
  writeFileSync,
} = await import("node:fs");
const { basename, isAbsolute, relative, resolve, sep } = await import("node:path");
const { spawnSync } = await import("node:child_process");

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
  const candidateData = dataDir ?? resolve(run, "crg-data");
  const cacheRoot = resolve(project, ".codexlooper", "crg-cache");
  let data;
  if (relativeInside(run, candidateData)) {
    data = assertBelow(run, candidateData, "CRG data directory");
  } else {
    const canonicalCacheRoot = canonicalDirectory(cacheRoot, "CRG cache root");
    const canonicalData = canonicalDirectory(candidateData, "CRG cache data directory");
    if (canonicalCacheRoot !== cacheRoot || !relativeInside(canonicalCacheRoot, canonicalData)) {
      foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", "CRG cache data directory must stay below the sealed cache root");
    }
    if ((lstatSync(canonicalData).mode & 0o077) !== 0) {
      foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", "CRG cache data directory must be private");
    }
    data = canonicalData;
  }
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

export const CRG_MACOS_SANDBOX_COMMAND = "/usr/bin/sandbox-exec";

function sandboxLiteral(path) {
  return `"${path.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function validateSandboxCommand(path) {
  return canonicalRegularFile(
    path,
    "macOS sandbox command",
    "CODEXLOOPER_CRG_SANDBOX_UNAVAILABLE",
  ).path;
}

function createCrgMacosSandboxProfile({ paths, environmentRoot, interpreterPath, commandPath, pythonRuntimeRoot }) {
  const environment = canonicalDirectory(environmentRoot, "CRG environment root");
  const interpreter = canonicalRegularFile(interpreterPath, "CRG interpreter").path;
  const command = canonicalRegularFile(commandPath, "CRG console command", "CODEXLOOPER_CRG_UNSAFE_COMMAND").path;
  const pythonRuntime = canonicalDirectory(pythonRuntimeRoot, "CRG Python runtime root");
  if (!relativeInside(pythonRuntime, interpreter)) {
    foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG interpreter must stay below the sealed Python runtime root");
  }
  if (!relativeInside(environment, command)) {
    foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG console command must stay inside the sealed environment");
  }
  const readable = [
    paths.project_root,
    environment,
    interpreter,
    pythonRuntime,
    "/System",
    "/usr/lib",
    "/usr/share",
    "/usr/bin",
    "/bin",
    "/dev",
  ];
  return {
    command,
    profile: [
      "(version 1)",
      "(deny default)",
      "(deny network*)",
      "(allow process*)",
      ...readable.map((path) => `(allow file-read* (subpath ${sandboxLiteral(path)}))`),
      `(allow file-write* (subpath ${sandboxLiteral(paths.run_dir)}))`,
      ...(paths.data_dir === paths.run_dir ? [] : [`(allow file-write* (subpath ${sandboxLiteral(paths.data_dir)}))`]),
    ].join("\n"),
  };
}

function createPinnedCrgArguments({ commandPath, operation, projectRoot, dataDir, baseSha }) {
  if (operation === "version") return [commandPath, "--version"];
  if (operation === "build") {
    return [commandPath, "build", "--repo", projectRoot, "--skip-flows", "--data-dir", dataDir];
  }
  if (operation === "detect-changes") {
    if (typeof baseSha !== "string" || !SHA.test(baseSha)) {
      foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG detect-changes requires a lowercase 40-hex base SHA");
    }
    return [commandPath, "detect-changes", "--repo", projectRoot, "--base", baseSha];
  }
  foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG operation is not allowlisted");
}

export function createCrgMacosSandboxLaunch({
  projectRoot,
  runDir,
  homeDir,
  dataDir,
  environmentRoot,
  interpreterPath,
  commandPath,
  pythonRuntimeRoot,
  sandboxCommand = CRG_MACOS_SANDBOX_COMMAND,
  operation = "version",
  baseSha,
  expectedProfileSha256,
} = {}) {
  const paths = validateCrgPrivatePaths({ projectRoot, runDir, homeDir, dataDir });
  const sandbox = validateSandboxCommand(sandboxCommand);
  const sandboxProfile = createCrgMacosSandboxProfile({
    paths,
    environmentRoot,
    interpreterPath,
    commandPath,
    pythonRuntimeRoot,
  });
  const profileSha256 = foundationSha256(sandboxProfile.profile);
  if (
    expectedProfileSha256 !== undefined &&
    (typeof expectedProfileSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedProfileSha256) || expectedProfileSha256 !== profileSha256)
  ) {
    foundationFail("CODEXLOOPER_CRG_SANDBOX_DENIED", "macOS sandbox profile identity does not match");
  }
  const crgArgs = createPinnedCrgArguments({
    commandPath: sandboxProfile.command,
    operation,
    projectRoot: paths.project_root,
    dataDir: paths.data_dir,
    baseSha,
  });
  return Object.freeze({
    executable: sandbox,
    args: Object.freeze(["-p", sandboxProfile.profile, ...crgArgs]),
    shell: false,
    env: createCrgChildEnvironment({ projectRoot, runDir, homeDir, dataDir }),
    profile: sandboxProfile.profile,
    profile_sha256: profileSha256,
  });
}

function boundedExecutionLimit(value, fallback, label) {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3_600_000) {
    foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", `${label} must be a bounded positive integer`);
  }
  return limit;
}

function operationTimeout(operation) {
  if (operation === "version") return CRG_EXECUTION_LIMITS.version_timeout_ms;
  if (operation === "build") return CRG_EXECUTION_LIMITS.build_timeout_ms;
  if (operation === "detect-changes") return CRG_EXECUTION_LIMITS.detect_changes_timeout_ms;
  foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG operation is not allowlisted");
}

function validateStandaloneLaunch(launch) {
  if (
    !launch ||
    typeof launch !== "object" ||
    typeof launch.executable !== "string" ||
    !isAbsolute(launch.executable) ||
    launch.executable.includes("\0") ||
    !Array.isArray(launch.args) ||
    launch.args.some((argument) => typeof argument !== "string" || argument.includes("\0")) ||
    launch.shell !== false ||
    !launch.env ||
    typeof launch.env !== "object" ||
    Array.isArray(launch.env)
  ) {
    foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG standalone launch must use the verified shell-free contract");
  }
  return launch;
}

function executionBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.alloc(0);
}

function failedExecution(errorClass, duration, { reportPath = null, truncated = false } = {}) {
  return createCrgResult({
    status: "failed",
    duration_ms: duration,
    report_path: reportPath,
    truncated,
    error_class: errorClass,
  });
}

function writePrivateCrgReport({ projectRoot, runDir, operation, stdout, stderr, outcome, maxBytes }) {
  const report = assertBelow(runDir, resolve(runDir, `crg-${operation}-report.json`), "CRG report path");
  const reportPath = relative(projectRoot, report).split(sep).join("/");
  validateReportPath(reportPath);
  const payload = Buffer.from(JSON.stringify({
    operation,
    stdout: redactCrgDiagnostic(stdout),
    stderr: redactCrgDiagnostic(stderr),
    outcome,
  }), "utf8");
  if (payload.length > maxBytes) return { report_path: null, truncated: true };
  try {
    writeFileSync(report, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch {
    return null;
  }
  return { report_path: reportPath, truncated: false };
}

function repositoryEntries(root, { mutableDirectories = [] } = {}) {
  const entries = new Map();
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
      const path = resolve(directory, name);
      if (mutableDirectories.some((mutable) => path === mutable || relativeInside(mutable, path))) continue;
      const relativePath = relative(root, path).split(sep).join("/");
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        entries.set(relativePath, Object.freeze({ type: "directory", mode: stat.mode & 0o777 }));
        visit(path);
      } else if (stat.isFile()) {
        entries.set(relativePath, Object.freeze({
          type: "file",
          mode: stat.mode & 0o777,
          size: stat.size,
          sha256: foundationSha256(readFileSync(path)),
        }));
      } else if (stat.isSymbolicLink()) {
        entries.set(relativePath, Object.freeze({ type: "symlink", mode: stat.mode & 0o777, link_target: readlinkSync(path) }));
      } else {
        foundationFail("CODEXLOOPER_CRG_REPOSITORY_MUTATION", `Repository contains an unsupported entry: ${relativePath}`);
      }
    }
  };
  visit(root);
  return entries;
}

export function captureCrgRepositoryState({ projectRoot, runDir, dataDir } = {}) {
  const paths = validateCrgPrivatePaths({ projectRoot, runDir, dataDir });
  const project = paths.project_root;
  const run = paths.run_dir;
  if (!relativeInside(project, run) || !relative(project, run).split(sep).join("/").startsWith(".codexlooper/runs/")) {
    foundationFail("CODEXLOOPER_CRG_PRIVATE_PATH_INVALID", "CRG private run directory must stay below .codexlooper/runs");
  }
  const mutableDirectories = [paths.data_dir];
  return Object.freeze({
    project_root: project,
    run_dir: run,
    mutable_directories: Object.freeze(mutableDirectories),
    entries: repositoryEntries(project, { mutableDirectories }),
  });
}

export function verifyCrgRepositoryState(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !(snapshot.entries instanceof Map)) {
    foundationFail("CODEXLOOPER_CRG_REPOSITORY_MUTATION", "CRG repository snapshot is invalid");
  }
  const project = canonicalDirectory(snapshot.project_root, "Project root");
  const run = canonicalDirectory(snapshot.run_dir, "CRG private run directory");
  if (project !== snapshot.project_root || run !== snapshot.run_dir) {
    foundationFail("CODEXLOOPER_CRG_REPOSITORY_MUTATION", "CRG repository paths changed after state capture");
  }
  if (!Array.isArray(snapshot.mutable_directories) || snapshot.mutable_directories.some((path) => typeof path !== "string" || !relativeInside(project, path))) {
    foundationFail("CODEXLOOPER_CRG_REPOSITORY_MUTATION", "CRG repository snapshot mutable directories are invalid");
  }
  const actual = repositoryEntries(project, { mutableDirectories: snapshot.mutable_directories });
  for (const operation of ["version", "build", "detect-changes"]) {
    const reportPath = relative(project, resolve(run, `crg-${operation}-report.json`)).split(sep).join("/");
    if (!snapshot.entries.has(reportPath)) {
      const report = actual.get(reportPath);
      if (report?.type === "file" && report.mode === 0o600) actual.delete(reportPath);
    }
  }
  if (actual.size !== snapshot.entries.size) {
    foundationFail("CODEXLOOPER_CRG_REPOSITORY_MUTATION", "CRG changed repository entries outside private report storage");
  }
  for (const [path, expected] of snapshot.entries) {
    if (JSON.stringify(actual.get(path)) !== JSON.stringify(expected)) {
      foundationFail("CODEXLOOPER_CRG_REPOSITORY_MUTATION", `CRG changed repository entry: ${path}`);
    }
  }
  return snapshot;
}

function executeCrgStandaloneUnchecked({
  launch,
  operation,
  projectRoot,
  runDir,
  baseSha,
  headSha,
  timeoutMs,
  maxOutputBytes,
  maxReportBytes,
  spawnSyncImpl = spawnSync,
} = {}) {
  const configuredLaunch = validateStandaloneLaunch(launch);
  const paths = validateCrgPrivatePaths({ projectRoot, runDir });
  const timeout = boundedExecutionLimit(timeoutMs, operationTimeout(operation), "CRG timeout");
  const outputLimit = boundedExecutionLimit(maxOutputBytes, CRG_EXECUTION_LIMITS.output_bytes, "CRG output limit");
  const reportLimit = boundedExecutionLimit(maxReportBytes, CRG_EXECUTION_LIMITS.report_bytes, "CRG report limit");
  if (typeof spawnSyncImpl !== "function") {
    foundationFail("CODEXLOOPER_CRG_UNSAFE_COMMAND", "CRG process executor must be a function");
  }
  const started = Date.now();
  let execution;
  try {
    execution = spawnSyncImpl(configuredLaunch.executable, configuredLaunch.args, {
      cwd: paths.project_root,
      env: configuredLaunch.env,
      shell: false,
      encoding: "buffer",
      timeout,
      maxBuffer: outputLimit,
      windowsHide: true,
    });
  } catch {
    return failedExecution("internal_error", Math.max(0, Date.now() - started));
  }
  const duration = Math.max(0, Date.now() - started);
  if (!execution || typeof execution !== "object") return failedExecution("internal_error", duration);
  const stdoutBytes = executionBytes(execution.stdout);
  const stderrBytes = executionBytes(execution.stderr);
  const stdout = stdoutBytes.toString("utf8");
  const stderr = stderrBytes.toString("utf8");
  const timedOut = execution.error?.code === "ETIMEDOUT" || execution.signal === "SIGTERM" || execution.signal === "SIGKILL";
  const outputLimited = execution.error?.code === "ENOBUFS" || stdoutBytes.length > outputLimit || stderrBytes.length > outputLimit;
  let outcome = "available";
  if (timedOut) outcome = "timeout";
  else if (outputLimited) outcome = "output_limit";
  else if (execution.error || execution.status !== 0) outcome = "non_zero_exit";
  const report = writePrivateCrgReport({
    projectRoot: paths.project_root,
    runDir: paths.run_dir,
    operation,
    stdout,
    stderr,
    outcome,
    maxBytes: reportLimit,
  });
  if (report === null) return failedExecution("private_paths", duration, { truncated: outputLimited });
  if (timedOut) return failedExecution("timeout", duration, { reportPath: report.report_path, truncated: report.truncated });
  if (outputLimited || report.truncated) return failedExecution("output_limit", duration, { reportPath: report.report_path, truncated: true });
  if (execution.error || execution.status !== 0) return failedExecution("non_zero_exit", duration, { reportPath: report.report_path });
  if (operation === "version") {
    if (stdout.trim() !== `code-review-graph ${CRG_VERSION}`) {
      return failedExecution("version_mismatch", duration, { reportPath: report.report_path });
    }
    return createCrgResult({ status: "available", version: CRG_VERSION, duration_ms: duration, report_path: report.report_path });
  }
  if (operation === "build") {
    return createCrgResult({ status: "available", version: CRG_VERSION, duration_ms: duration, report_path: report.report_path });
  }
  try {
    return createCrgResult({
      status: "available",
      version: CRG_VERSION,
      duration_ms: duration,
      report_path: report.report_path,
      advisory: normalizeDetectOutput(stdout, { baseSha, headSha }),
    });
  } catch (error) {
    const errorClass = error?.code === "CODEXLOOPER_CRG_PROJECTION_INVALID" ? "projection_invalid" : "malformed_json";
    return failedExecution(errorClass, duration, { reportPath: report.report_path });
  }
}

export function executeCrgStandalone(options = {}) {
  const snapshot = captureCrgRepositoryState(options);
  let result;
  try {
    result = executeCrgStandaloneUnchecked(options);
  } finally {
    try {
      verifyCrgRepositoryState(snapshot);
    } catch (error) {
      if (error?.code === "CODEXLOOPER_CRG_REPOSITORY_MUTATION") {
        result = failedExecution("repository_mutation", result?.duration_ms ?? 0, {
          reportPath: result?.report_path ?? null,
          truncated: result?.truncated ?? false,
        });
      } else {
        throw error;
      }
    }
  }
  return result;
}
