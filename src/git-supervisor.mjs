import {
  appendFileSync,
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathAllowed } from "./run-policy.mjs";

const SAFE_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "NO_COLOR",
  "CI",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];
const MAX_VALIDATION_OUTPUT = 12_000;
const VALIDATION_TIMEOUT_MS = 180_000;
const MAX_PATCH_BYTES = 2_000_000;
const PATCH_PATH = /^[A-Za-z0-9._@+\/-]+$/;
const FORBIDDEN_PATCH_MARKERS = [
  "GIT binary patch",
  "Binary files ",
  "rename from ",
  "rename to ",
  "copy from ",
  "copy to ",
  "Subproject commit ",
  "new file mode 120000",
  "deleted file mode 120000",
  "new file mode 160000",
  "deleted file mode 160000",
];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function safeEnvironment(sourceEnv = process.env) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }
  env.DO_NOT_TRACK = "1";
  return env;
}

function run(command, args, { cwd, env, label, timeout, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env || safeEnvironment(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout,
    input,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error")
      .trim()
      .slice(-MAX_VALIDATION_OUTPUT);
    fail(
      "CODEXLOOPER_HOST_COMMAND_FAILED",
      `${label || command} failed${result.status !== null ? ` with status ${result.status}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  return String(result.stdout || "").trim();
}

function nulPaths(value) {
  return String(value || "")
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
}

function gitPaths(projectRoot, args) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: projectRoot,
    env: safeEnvironment(),
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = Buffer.from(result.stderr || result.stdout || "").toString("utf8").trim();
    fail("CODEXLOOPER_GIT_SUPERVISOR_FAILED", `Git path inspection failed${detail ? `: ${detail}` : ""}`);
  }
  return nulPaths(Buffer.from(result.stdout || "").toString("utf8"));
}

function changedPaths(projectRoot) {
  const paths = new Set([
    ...gitPaths(projectRoot, ["diff", "--name-only", "-z"]),
    ...gitPaths(projectRoot, ["diff", "--cached", "--name-only", "-z"]),
    ...gitPaths(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...paths].sort();
}

function loadPolicy(sourceEnv, projectRoot) {
  const configured = sourceEnv.CODEXLOOPER_RUN_POLICY;
  if (typeof configured !== "string" || !isAbsolute(configured) || configured.includes("\0")) {
    fail("CODEXLOOPER_RUN_POLICY_INVALID", "CODEXLOOPER_RUN_POLICY must be an absolute path");
  }
  const root = realpathSync(projectRoot);
  const policyPath = realpathSync(configured);
  const runRoot = resolve(root, ".codexlooper", "runs");
  const rel = relative(runRoot, policyPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail("CODEXLOOPER_RUN_POLICY_INVALID", "Run policy must stay inside .codexlooper/runs");
  }
  const stat = lstatSync(policyPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 1_000_000) {
    fail("CODEXLOOPER_RUN_POLICY_INVALID", "Run policy must be a bounded regular file");
  }
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    fail("CODEXLOOPER_RUN_POLICY_INVALID", "Run policy is invalid JSON");
  }
  if (
    policy?.schema !== "codexlooper.run-policy.v1" ||
    !Array.isArray(policy.allowed_paths) ||
    !Array.isArray(policy.validation_commands)
  ) {
    fail("CODEXLOOPER_RUN_POLICY_INVALID", "Run policy schema is invalid");
  }
  return { policy, policyPath };
}

function validatePaths(paths, rules) {
  const rejected = paths.filter((path) => !pathAllowed(path, rules));
  if (rejected.length > 0) {
    fail(
      "CODEXLOOPER_PATH_POLICY_VIOLATION",
      `Builder changed paths outside the plan policy: ${rejected.join(", ")}`,
    );
  }
}

function runValidationCommands(projectRoot, commands, sourceEnv) {
  const results = [];
  for (const command of commands) {
    const started = Date.now();
    run("/bin/sh", ["-lc", command], {
      cwd: projectRoot,
      env: safeEnvironment(sourceEnv),
      label: `Validation command ${JSON.stringify(command)}`,
      timeout: VALIDATION_TIMEOUT_MS,
    });
    results.push({ command, duration_ms: Math.max(0, Date.now() - started), status: "PASS" });
  }
  return results;
}

function recordEvent(policyPath, event) {
  const eventPath = resolve(dirname(policyPath), "host-commits.jsonl");
  appendFileSync(eventPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(eventPath, 0o600);
}

function commitPaths({ root, paths, policy, policyPath, phase, sourceEnv, now, transport }) {
  const validation = runValidationCommands(root, policy.validation_commands, sourceEnv);
  run("/usr/bin/git", ["add", "--all", "--", ...paths], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host git add",
  });
  const staged = gitPaths(root, ["diff", "--cached", "--name-only", "-z"]);
  if (staged.length === 0) {
    fail("CODEXLOOPER_HOST_COMMIT_EMPTY", "Builder changes produced no staged files");
  }
  validatePaths(staged, policy.allowed_paths);
  const message =
    phase === "task"
      ? "feat: complete CodexLooper task iteration"
      : "fix: apply CodexLooper review findings";
  run("/usr/bin/git", ["commit", "--no-gpg-sign", "-m", message], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host git commit",
  });
  const commit = run("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host commit lookup",
  });
  recordEvent(policyPath, {
    schema: "codexlooper.host-commit.v2",
    created_at: now().toISOString(),
    run_id: sourceEnv.CODEXLOOPER_RUN_ID || null,
    phase,
    transport,
    commit,
    changed_paths: staged,
    validation,
  });
  return { committed: true, commit, changed_paths: staged, validation };
}

function normalizePatch(patch) {
  if (typeof patch !== "string") {
    fail("CODEXLOOPER_PATCH_INVALID", "Builder patch must be a string");
  }
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES || patch.includes("\0")) {
    fail("CODEXLOOPER_PATCH_INVALID", "Builder patch is invalid or too large");
  }
  const normalized = patch.replaceAll("\r\n", "\n");
  if (!normalized.trim()) return "";
  if (!normalized.startsWith("diff --git ")) {
    fail("CODEXLOOPER_PATCH_INVALID", "Builder patch must begin with a git diff header");
  }
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function declaredPatchPaths(patch) {
  if (!patch) return [];
  const lines = patch.split("\n");
  for (const marker of FORBIDDEN_PATCH_MARKERS) {
    if (lines.some((line) => line.startsWith(marker))) {
      fail("CODEXLOOPER_PATCH_UNSUPPORTED", `Builder patch uses unsupported content: ${marker.trim()}`);
    }
  }
  const paths = [];
  for (const line of lines) {
    if (!line.startsWith("diff --git ")) continue;
    const match = line.match(/^diff --git a\/([^\s]+) b\/([^\s]+)$/);
    if (!match || match[1] !== match[2]) {
      fail("CODEXLOOPER_PATCH_UNSUPPORTED", "Builder patch must use same-path non-renaming git diffs");
    }
    const path = match[1];
    if (!PATCH_PATH.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
      fail("CODEXLOOPER_PATCH_PATH_INVALID", `Builder patch contains an unsafe path: ${path}`);
    }
    paths.push(path);
  }
  if (paths.length === 0) {
    fail("CODEXLOOPER_PATCH_INVALID", "Non-empty builder patch contains no git diff headers");
  }
  if (new Set(paths).size !== paths.length) {
    fail("CODEXLOOPER_PATCH_INVALID", "Builder patch repeats a file diff");
  }
  return paths.sort();
}

function samePaths(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cleanupAppliedPatch(root, paths, sourceEnv) {
  run("/usr/bin/git", ["reset", "--hard", "HEAD"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host patch rollback",
  });
  if (paths.length > 0) {
    run("/usr/bin/git", ["clean", "-fd", "--", ...paths], {
      cwd: root,
      env: safeEnvironment(sourceEnv),
      label: "Host untracked patch rollback",
    });
  }
}

export function applyBuilderPatch({
  patch,
  phase,
  sourceEnv = process.env,
  projectRoot = process.cwd(),
  now = () => new Date(),
} = {}) {
  if (phase !== "task" && phase !== "review") {
    fail("CODEXLOOPER_SUPERVISOR_PHASE_INVALID", "Supervisor phase must be task or review");
  }
  const root = realpathSync(projectRoot);
  if (changedPaths(root).length > 0) {
    fail("CODEXLOOPER_PATCH_DIRTY", "Host patch application requires a clean worktree");
  }
  const normalizedPatch = normalizePatch(patch);
  if (!normalizedPatch) {
    return { committed: false, changed_paths: [], validation: [] };
  }
  const { policy, policyPath } = loadPolicy(sourceEnv, root);
  const declared = declaredPatchPaths(normalizedPatch);
  validatePaths(declared, policy.allowed_paths);
  run("/usr/bin/git", ["apply", "--check", "--recount", "--whitespace=error-all", "-"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host patch check",
    input: normalizedPatch,
  });
  let applied = false;
  try {
    run("/usr/bin/git", ["apply", "--recount", "--whitespace=error-all", "-"], {
      cwd: root,
      env: safeEnvironment(sourceEnv),
      label: "Host patch apply",
      input: normalizedPatch,
    });
    applied = true;
    const actual = changedPaths(root);
    if (!samePaths(actual, declared)) {
      fail(
        "CODEXLOOPER_PATCH_PATH_MISMATCH",
        `Applied patch paths do not match declared diff paths: ${actual.join(", ")}`,
      );
    }
    validatePaths(actual, policy.allowed_paths);
    return commitPaths({
      root,
      paths: actual,
      policy,
      policyPath,
      phase,
      sourceEnv,
      now,
      transport: "structured_patch",
    });
  } catch (error) {
    if (applied && changedPaths(root).length > 0) cleanupAppliedPatch(root, declared, sourceEnv);
    throw error;
  }
}

export function superviseBuilderChanges({
  phase,
  sourceEnv = process.env,
  projectRoot = process.cwd(),
  now = () => new Date(),
} = {}) {
  if (phase !== "task" && phase !== "review") {
    fail("CODEXLOOPER_SUPERVISOR_PHASE_INVALID", "Supervisor phase must be task or review");
  }
  const root = realpathSync(projectRoot);
  const paths = changedPaths(root);
  if (paths.length === 0) {
    return { committed: false, changed_paths: [], validation: [] };
  }
  const { policy, policyPath } = loadPolicy(sourceEnv, root);
  validatePaths(paths, policy.allowed_paths);
  return commitPaths({
    root,
    paths,
    policy,
    policyPath,
    phase,
    sourceEnv,
    now,
    transport: "worktree",
  });
}
