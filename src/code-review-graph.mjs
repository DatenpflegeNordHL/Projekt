import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";

export const CRG_VERSION = "2.3.6";
export const ERROR_CLASSES = Object.freeze([
  "unsafe_command", "private_paths", "environment_integrity", "sandbox_unavailable",
  "sandbox_denied", "legacy_repository_state", "repository_mutation", "version_mismatch",
  "timeout", "non_zero_exit", "output_limit", "malformed_json", "projection_invalid",
  "internal_error",
]);
const PRIORITY_KINDS = new Set(["changed_function", "security_sensitive", "test_gap", "high_risk"]);
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const LEGACY_NAMES = [
  ".code-review-graph.db", ".code-review-graph.db-wal",
  ".code-review-graph.db-shm", ".code-review-graph.db-journal",
];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedResult(status, started, values = {}) {
  return {
    status,
    version: values.version ?? null,
    duration_ms: Math.max(0, Date.now() - started),
    report_path: values.report_path ?? null,
    truncated: values.truncated ?? false,
    error_class: values.error_class ?? null,
    advisory: values.advisory ?? null,
  };
}

function safeProjectPath(value, projectRoot) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    value.includes("\0") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    isAbsolute(value)
  ) {
    fail("projection_invalid", "Unsafe project-relative path");
  }
  const normalized = value.replaceAll("\\", "/");
  const target = resolve(projectRoot, normalized);
  const project = resolve(projectRoot);
  const rel = relative(project, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail("projection_invalid", "Project path escapes repository");
  }
  return normalized;
}

export function projectAdvisory(raw, { projectRoot = process.cwd(), baseSha, headSha } = {}) {
  if (raw === "No changes detected.") {
    return {
      base_sha: baseSha,
      head_sha: headSha,
      risk_score: 0,
      changed_files: [],
      test_gap_count: 0,
      review_priorities: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("malformed_json", "CRG detect output is not JSON");
  }
  const source = parsed?.advisory && typeof parsed.advisory === "object" ? parsed.advisory : parsed;
  const base = typeof source?.base_sha === "string" ? source.base_sha : baseSha;
  const head = typeof source?.head_sha === "string" ? source.head_sha : headSha;
  if (!/^[0-9a-f]{40}$/.test(base || "") || !/^[0-9a-f]{40}$/.test(head || "")) {
    fail("projection_invalid", "Invalid graph SHA");
  }
  const risk = Number(source?.risk_score ?? 0);
  const testGapCount = Number(source?.test_gap_count ?? 0);
  if (!Number.isFinite(risk) || risk < 0 || risk > 100 ||
      !Number.isSafeInteger(testGapCount) || testGapCount < 0 || testGapCount > 100000) {
    fail("projection_invalid", "Invalid advisory bounds");
  }
  const files = Array.isArray(source?.changed_files) ? source.changed_files : [];
  const priorities = Array.isArray(source?.review_priorities) ? source.review_priorities : [];
  if (files.length > 1000 || priorities.length > 1000) fail("projection_invalid", "Advisory list is too large");
  const changedFiles = files.map((file) => safeProjectPath(file, projectRoot));
  const reviewPriorities = priorities.map((item) => {
    if (!item || typeof item !== "object" || !PRIORITY_KINDS.has(item.kind) ||
        !Number.isSafeInteger(item.line) || item.line < 0 || item.line > 10_000_000) {
      fail("projection_invalid", "Invalid review priority");
    }
    return { file: safeProjectPath(item.file, projectRoot), line: item.line, kind: item.kind };
  });
  const projection = {
    base_sha: base,
    head_sha: head,
    risk_score: risk,
    changed_files: changedFiles,
    test_gap_count: testGapCount,
    review_priorities: reviewPriorities,
  };
  if (Buffer.byteLength(JSON.stringify(projection)) > 64 * 1024) {
    fail("projection_invalid", "Advisory projection is too large");
  }
  return projection;
}

export function verifyEnvironmentManifest({ environmentRoot, manifest, interpreter, command } = {}) {
  if (typeof environmentRoot !== "string" || !isAbsolute(environmentRoot) ||
      !manifest || !Array.isArray(manifest.entries)) {
    fail("environment_integrity", "CRG manifest is invalid");
  }
  const root = resolve(environmentRoot);
  const seen = new Set();
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.path !== "string" || isAbsolute(entry.path) ||
        entry.path.includes("\0") || entry.path.split(/[\\/]/).includes("..")) {
      fail("environment_integrity", "Unsafe manifest path");
    }
    if (seen.has(entry.path)) fail("environment_integrity", "Duplicate manifest entry");
    seen.add(entry.path);
    const target = resolve(root, entry.path);
    if (!relative(root, target) || relative(root, target).startsWith("..")) {
      fail("environment_integrity", "Manifest escapes environment");
    }
    const stat = lstatSync(target);
    if (entry.type === "symlink") {
      if (!stat.isSymbolicLink() || readlinkSync(target) !== entry.target) {
        fail("environment_integrity", "Symlink identity mismatch");
      }
    } else if (!stat.isFile() || (stat.mode & 0o777) !== Number(entry.mode) ||
      stat.size !== entry.size || sha256(readFileSync(target)) !== entry.sha256) {
      fail("environment_integrity", "Environment entry mismatch");
    }
  }
  for (const path of [interpreter, command]) {
    if (typeof path !== "string" || !isAbsolute(path) || !existsSync(path)) {
      fail("environment_integrity", "CRG executable identity missing");
    }
  }
  return true;
}

function privateChild(path, runDirectory, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    fail("private_paths", `${label} must be absolute`);
  }
  const root = resolve(runDirectory);
  const target = resolve(path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail("private_paths", `${label} must stay inside the run`);
  return target;
}

export function runCodeReviewGraph({
  command,
  projectRoot = process.cwd(),
  runDirectory,
  dataDirectory,
  environmentRoot,
  manifest,
  interpreter,
  sandboxCommand,
  sandboxProfile,
  baseSha,
  headSha,
  sourceEnv = process.env,
  timeoutMs = 30_000,
} = {}) {
  const started = Date.now();
  if (!command) return normalizedResult("disabled", started);
  try {
    if (typeof command !== "string" || !isAbsolute(command) || !isAbsolute(projectRoot) ||
        !/^[0-9a-f]{40}$/.test(baseSha || "") || !/^[0-9a-f]{40}$/.test(headSha || "")) {
      fail("unsafe_command", "Invalid CRG inputs");
    }
    if (typeof runDirectory !== "string" || !isAbsolute(runDirectory)) {
      fail("private_paths", "Run directory must be absolute");
    }
    const data = privateChild(dataDirectory, runDirectory, "CRG data directory");
    privateChild(resolve(runDirectory, "crg-report.json"), runDirectory, "CRG report");
    if (LEGACY_NAMES.some((name) => existsSync(resolve(projectRoot, name)))) {
      fail("legacy_repository_state", "Legacy CRG state exists");
    }
    verifyEnvironmentManifest({ environmentRoot, manifest, interpreter, command });
    if (process.platform === "darwin" && (!sandboxCommand || !sandboxProfile)) {
      fail("sandbox_unavailable", "macOS sandbox identity is required");
    }
    mkdirSync(data, { recursive: true, mode: 0o700 });
    const env = {
      HOME: resolve(runDirectory, "crg-home"),
      CRG_DATA_DIR: data,
      CRG_REPO_ROOT: resolve(projectRoot),
      CRG_PARSE_EXECUTOR: "thread",
      CRG_PARSE_WORKERS: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONSAFEPATH: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      DO_NOT_TRACK: "1",
      NO_COLOR: "1",
      PATH: "/usr/bin:/bin",
    };
    const childEnv = {
      ...env,
      ...Object.fromEntries(Object.entries(sourceEnv).filter(([key]) => key === "TMPDIR" || key === "SSL_CERT_FILE")),
    };
    const invoke = (args) => spawnSync(command, args, {
      cwd: resolve(projectRoot),
      env: childEnv,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const version = invoke(["--version"]);
    if (version.error?.code === "ETIMEDOUT") fail("timeout", "CRG version timed out");
    if (version.status !== 0) fail("non_zero_exit", "CRG version failed");
    if (String(version.stdout).trim() !== `code-review-graph ${CRG_VERSION}`) {
      fail("version_mismatch", "Unexpected CRG version");
    }
    const build = invoke(["build", "--repo", resolve(projectRoot), "--skip-flows", "--data-dir", data]);
    if (build.error?.code === "ETIMEDOUT") fail("timeout", "CRG build timed out");
    if (build.status !== 0) fail("non_zero_exit", "CRG build failed");
    const detect = invoke(["detect-changes", "--repo", resolve(projectRoot), "--base", baseSha]);
    if (detect.error?.code === "ETIMEDOUT") fail("timeout", "CRG detect timed out");
    if (detect.status !== 0) fail("non_zero_exit", "CRG detect failed");
    const raw = String(detect.stdout || "").trim();
    if (Buffer.byteLength(raw) > MAX_REPORT_BYTES) fail("output_limit", "CRG report is too large");
    const advisory = projectAdvisory(raw, { projectRoot, baseSha, headSha });
    const reportPath = resolve(runDirectory, "crg-report.json");
    writeFileSync(reportPath, raw, { mode: 0o600 });
    return normalizedResult("available", started, {
      version: CRG_VERSION,
      report_path: relative(resolve(projectRoot), reportPath),
      advisory,
    });
  } catch (caught) {
    const code = ERROR_CLASSES.includes(caught.code) ? caught.code : "internal_error";
    return normalizedResult("failed", started, { error_class: code });
  }
}
