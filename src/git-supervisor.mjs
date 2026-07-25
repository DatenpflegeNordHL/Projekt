import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertGitAuthorityFromEnvironment } from "./git-authority.mjs";
import { pathAllowed, validationInvocation } from "./run-policy.mjs";
import { assertManifestExternalTool, verifyRuntimeManifest } from "./runtime-integrity.mjs";

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
const APPLY_PATCH_MARKERS = [
  "*** Begin Patch",
  "*** Add File:",
  "*** Update File:",
  "*** Delete File:",
  "*** End Patch",
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

function authority(root, sourceEnv, label) {
  return assertGitAuthorityFromEnvironment({ projectRoot: root, sourceEnv, label });
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

function gitPaths(projectRoot, args, sourceEnv = process.env) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: projectRoot,
    env: safeEnvironment(sourceEnv),
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = Buffer.from(result.stderr || result.stdout || "").toString("utf8").trim();
    fail("CODEXLOOPER_GIT_SUPERVISOR_FAILED", `Git path inspection failed${detail ? `: ${detail}` : ""}`);
  }
  return nulPaths(Buffer.from(result.stdout || "").toString("utf8"));
}

function changedPaths(projectRoot, sourceEnv = process.env) {
  const paths = new Set([
    ...gitPaths(projectRoot, ["diff", "--name-only", "-z"], sourceEnv),
    ...gitPaths(projectRoot, ["diff", "--cached", "--name-only", "-z"], sourceEnv),
    ...gitPaths(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z"], sourceEnv),
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

function runValidationCommands(projectRoot, commands, rules, sourceEnv) {
  const results = [];
  for (const command of commands) {
    const invocation = validationInvocation(command, rules);
    authority(projectRoot, sourceEnv, `Before validation command ${JSON.stringify(command)}`);
    const started = Date.now();
    run(invocation.executable, invocation.args, {
      cwd: projectRoot,
      env: safeEnvironment(sourceEnv),
      label: `Validation command ${JSON.stringify(invocation.display)}`,
      timeout: VALIDATION_TIMEOUT_MS,
    });
    authority(projectRoot, sourceEnv, `After validation command ${JSON.stringify(command)}`);
    results.push({ command, duration_ms: Math.max(0, Date.now() - started), status: "PASS" });
  }
  return results;
}

function runtimeNpmCli(sourceEnv) {
  const manifestPath = sourceEnv.CODEXLOOPER_RUNTIME_MANIFEST;
  const manifestSha256 = sourceEnv.CODEXLOOPER_RUNTIME_MANIFEST_SHA256;
  const runtimeDirectory = sourceEnv.CODEXLOOPER_RUNTIME_DIR;
  const configured = [manifestPath, manifestSha256, runtimeDirectory].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) {
    fail("CODEXLOOPER_COMPLETION_GATE_RUNTIME_INVALID", "Completion gates require complete runtime evidence");
  }
  const npmCli = sourceEnv.CODEXLOOPER_NPM_CLI;
  if (typeof npmCli !== "string" || !isAbsolute(npmCli) || npmCli.includes("\0")) {
    fail("CODEXLOOPER_COMPLETION_GATE_NPM_INVALID", "Completion gates require a pinned npm CLI path");
  }
  const runtime = verifyRuntimeManifest({
    manifestPath,
    expectedManifestSha256: manifestSha256,
    expectedRuntimeDirectory: runtimeDirectory,
    expectedNodeExecutable: process.execPath,
  });
  return assertManifestExternalTool(runtime.manifest, "npm_cli", npmCli);
}

function completedTaskLabels(diff) {
  const unchecked = new Set();
  const checked = new Set();
  for (const line of diff.split("\n")) {
    const removed = line.match(/^-\s*-\s+\[ \]\s+(.+)$/);
    if (removed) unchecked.add(removed[1]);
    const added = line.match(/^\+\s*-\s+\[x\]\s+(.+)$/i);
    if (added) checked.add(added[1]);
  }
  return [...unchecked].filter((label) => checked.has(label));
}

function pendingTaskCompletion(projectRoot, plan, sourceEnv) {
  const diff = run("/usr/bin/git", ["diff", "--no-ext-diff", "--unified=0", "HEAD", "--", plan], {
    cwd: projectRoot,
    env: safeEnvironment(sourceEnv),
    label: "Task completion diff inspection",
  });
  return completedTaskLabels(diff);
}

function assertStagedCandidate(projectRoot, paths, sourceEnv = process.env) {
  const unstaged = gitPaths(projectRoot, ["diff", "--name-only", "-z"], sourceEnv);
  const untracked = gitPaths(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z"], sourceEnv);
  const staged = gitPaths(projectRoot, ["diff", "--cached", "--name-only", "-z"], sourceEnv);
  if (unstaged.length > 0 || untracked.length > 0 || !samePaths(staged, [...paths].sort())) {
    fail(
      "CODEXLOOPER_COMPLETION_GATE_DIRTY",
      "Completion gates require only the expected candidate changes to be staged",
    );
  }
}

function isolatedCandidateEnvironment(candidateRoot) {
  const home = resolve(candidateRoot, "home");
  mkdirSync(home, { recursive: false, mode: 0o700 });
  chmodSync(home, 0o700);
  return {
    HOME: home,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: "C",
    LC_ALL: "C",
    DO_NOT_TRACK: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function candidateRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexlooper-candidate-")));
  chmodSync(root, 0o700);
  if (lstatSync(root).isSymbolicLink()) {
    fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate root must be a canonical private directory");
  }
  return root;
}

function removeCandidateRoot(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    rmSync(path, { force: true });
    return;
  }
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) removeCandidateRoot(resolve(path, entry));
    rmSync(path, { recursive: true, force: true });
    return;
  }
  chmodSync(path, 0o600);
  rmSync(path, { force: true });
}

function candidateTree(projectRoot, sourceEnv) {
  return run("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], {
    cwd: projectRoot,
    env: sourceEnv,
    label: "Candidate tree lookup",
  });
}

function patchTaskCompletions(patch, plan) {
  const header = `diff --git a/${plan} b/${plan}`;
  const lines = patch.split("\n");
  const section = [];
  let found = false;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (found) break;
      found = line === header;
      continue;
    }
    if (found) section.push(line);
  }
  return completedTaskLabels(section.join("\n"));
}

function assertPinnedNpmContract(projectRoot, sourceEnv) {
  const baseline = run("/usr/bin/git", ["rev-parse", "HEAD:package.json"], {
    cwd: projectRoot,
    env: safeEnvironment(sourceEnv),
    label: "Completion npm contract baseline",
  });
  const current = run("/usr/bin/git", ["hash-object", "--", "package.json"], {
    cwd: projectRoot,
    env: safeEnvironment(sourceEnv),
    label: "Completion npm contract current package.json",
  });
  if (current !== baseline) {
    fail(
      "CODEXLOOPER_COMPLETION_GATE_NPM_INVALID",
      "Completion gates require package.json to remain unchanged from HEAD",
    );
  }
}

function prepareCompletionCandidate({ root, patch, declared, policy, sourceEnv }) {
  const start = run("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Completion candidate start HEAD",
  });
  const temporary = candidateRoot();
  const candidate = resolve(temporary, "repository");
  let result;
  let completed = false;
  let failure = null;
  try {
    const env = isolatedCandidateEnvironment(temporary);
    run("/usr/bin/git", ["clone", "--no-local", "--no-checkout", "--", root, candidate], {
      cwd: temporary,
      env,
      label: "Completion candidate local clone",
      timeout: VALIDATION_TIMEOUT_MS,
    });
    chmodSync(candidate, 0o700);
    if (realpathSync(candidate) !== candidate || lstatSync(candidate).isSymbolicLink()) {
      fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate repository must stay inside its private root");
    }
    run("/usr/bin/git", ["remote", "remove", "origin"], {
      cwd: candidate,
      env,
      label: "Completion candidate remote removal",
    });
    run("/usr/bin/git", ["config", "--local", "core.hooksPath", "/dev/null"], {
      cwd: candidate,
      env,
      label: "Completion candidate hook isolation",
    });
    run("/usr/bin/git", ["checkout", "--detach", start], {
      cwd: candidate,
      env,
      label: "Completion candidate checkout",
    });
    if (run("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: candidate, env, label: "Completion candidate HEAD" }) !== start) {
      fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate repository did not check out the expected HEAD");
    }
    if (run("/usr/bin/git", ["status", "--porcelain=v1"], { cwd: candidate, env, label: "Completion candidate clean checkout" })) {
      fail("CODEXLOOPER_COMPLETION_CANDIDATE_DIRTY", "Candidate repository is not clean after checkout");
    }
    run("/usr/bin/git", ["apply", "--check", "--recount", "--whitespace=error-all", "-"], {
      cwd: candidate,
      env,
      label: "Completion candidate patch check",
      input: patch,
    });
    run("/usr/bin/git", ["apply", "--recount", "--whitespace=error-all", "-"], {
      cwd: candidate,
      env,
      label: "Completion candidate patch apply",
      input: patch,
    });
    const actual = changedPaths(candidate, env);
    if (!samePaths(actual, declared)) {
      fail("CODEXLOOPER_PATCH_PATH_MISMATCH", "Candidate patch paths do not match declared diff paths");
    }
    validatePaths(actual, policy.allowed_paths);
    const tasks = pendingTaskCompletion(candidate, policy.plan, env);
    if (tasks.length === 0) {
      fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate patch did not complete the declared task checkbox");
    }
    assertPinnedNpmContract(candidate, env);
    run("/usr/bin/git", ["add", "--all", "--", ...actual], {
      cwd: candidate,
      env,
      label: "Completion candidate staging",
    });
    assertStagedCandidate(candidate, actual, env);
    run("/usr/bin/git", [
      "-c", "core.hooksPath=/dev/null",
      "-c", "user.name=CodexLooper Candidate",
      "-c", "user.email=candidate@codexlooper.invalid",
      "commit", "--no-gpg-sign", "--no-verify", "-m", "chore: validate completion candidate",
    ], {
      cwd: candidate,
      env,
      label: "Completion candidate temporary commit",
    });
    if (run("/usr/bin/git", ["status", "--porcelain=v1"], { cwd: candidate, env, label: "Completion candidate pre-check status" })) {
      fail("CODEXLOOPER_COMPLETION_CANDIDATE_DIRTY", "Candidate repository must be clean before npm run check");
    }
    const validation = runValidationCommands(candidate, policy.validation_commands, policy.allowed_paths, env);
    const checks = validation.map((entry) => ({ ...entry, gate: "focused_validation" }));
    run("/usr/bin/git", ["diff", "--check", "HEAD^", "HEAD"], {
      cwd: candidate,
      env,
      label: "Completion candidate git diff --check",
    });
    checks.push({ command: "git diff HEAD^ HEAD --check", status: "PASS", exit_code: 0 });
    const npmCli = runtimeNpmCli(sourceEnv);
    if (!npmCli) {
      fail("CODEXLOOPER_COMPLETION_GATE_NPM_INVALID", "Completion candidate requires a manifest-bound npm CLI");
    }
    run(process.execPath, [npmCli, "run", "check"], {
      cwd: candidate,
      env,
      label: "Completion candidate npm run check",
      timeout: VALIDATION_TIMEOUT_MS,
    });
    checks.push({ command: "npm run check", status: "PASS", exit_code: 0 });
    runtimeNpmCli(sourceEnv);
    checks.push({ command: "runtime-integrity verification", status: "PASS", exit_code: 0 });
    if (run("/usr/bin/git", ["status", "--porcelain=v1"], { cwd: candidate, env, label: "Completion candidate post-check status" })) {
      fail("CODEXLOOPER_COMPLETION_CANDIDATE_DIRTY", "Candidate checks modified the candidate repository");
    }
    result = {
      required: true,
      mode: "isolated_candidate_repository",
      expected_start_sha: start,
      candidate_tree: candidateTree(candidate, env),
      tasks,
      validation,
      checks,
      cleanup: "PENDING",
    };
    completed = true;
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      removeCandidateRoot(temporary);
      if (result) result.cleanup = "PASS";
    } catch (error) {
      if (!failure && completed) fail("CODEXLOOPER_COMPLETION_CANDIDATE_CLEANUP_FAILED", error.message);
    }
  }
}

function runCompletionGates({ projectRoot, paths, plan, sourceEnv, validation }) {
  const labels = pendingTaskCompletion(projectRoot, plan, sourceEnv);
  if (labels.length === 0) return { required: false, checks: [] };

  const npmCli = runtimeNpmCli(sourceEnv);
  if (!npmCli) return { required: false, legacy: true, checks: [] };

  const checks = validation.map((entry) => ({ ...entry, gate: "focused_validation" }));
  authority(projectRoot, sourceEnv, "Before completion gates");
  assertStagedCandidate(projectRoot, paths);
  assertPinnedNpmContract(projectRoot, sourceEnv);
  run("/usr/bin/git", ["diff", "--check"], {
    cwd: projectRoot,
    env: safeEnvironment(sourceEnv),
    label: "Completion gate git diff --check",
  });
  checks.push({ command: "git diff --check", status: "PASS" });
  run("/usr/bin/git", ["diff", "--cached", "--check"], {
    cwd: projectRoot,
    env: safeEnvironment(sourceEnv),
    label: "Completion gate staged git diff --check",
  });
  checks.push({ command: "git diff --cached --check", status: "PASS" });
  run(process.execPath, [npmCli, "run", "check"], {
    cwd: projectRoot,
    env: { ...safeEnvironment(sourceEnv), PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    label: "Completion gate npm run check",
    timeout: VALIDATION_TIMEOUT_MS,
  });
  checks.push({ command: "npm run check", status: "PASS" });
  runtimeNpmCli(sourceEnv);
  checks.push({ command: "runtime-integrity verification", status: "PASS" });
  authority(projectRoot, sourceEnv, "After completion gates");
  checks.push({ command: "branch-lock and ancestry verification", status: "PASS" });
  assertStagedCandidate(projectRoot, paths);
  checks.push({ command: "clean-worktree verification", status: "PASS" });
  return { required: true, tasks: labels, checks };
}

function recordEvent(policyPath, event) {
  const eventPath = resolve(dirname(policyPath), "host-commits.jsonl");
  appendFileSync(eventPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(eventPath, 0o600);
}

function commitPaths({
  root,
  paths,
  policy,
  policyPath,
  phase,
  sourceEnv,
  now,
  transport,
  completionCandidate,
}) {
  authority(root, sourceEnv, "Before host validation");
  const validation = completionCandidate?.validation || runValidationCommands(
    root,
    policy.validation_commands,
    policy.allowed_paths,
    sourceEnv,
  );
  authority(root, sourceEnv, "Before host staging");
  run("/usr/bin/git", ["add", "--all", "--", ...paths], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host git add",
  });
  const staged = gitPaths(root, ["diff", "--cached", "--name-only", "-z"]);
  if (staged.length === 0) fail("CODEXLOOPER_HOST_COMMIT_EMPTY", "Builder changes produced no staged files");
  validatePaths(staged, policy.allowed_paths);
  if (
    phase === "task" &&
    !completionCandidate &&
    pendingTaskCompletion(root, policy.plan, sourceEnv).length > 0 &&
    runtimeNpmCli(sourceEnv)
  ) {
    fail(
      "CODEXLOOPER_COMPLETION_CANDIDATE_REQUIRED",
      "Task completion with immutable runtime evidence requires an isolated structured patch candidate",
    );
  }
  const completionGates = completionCandidate || (phase === "task"
    ? runCompletionGates({
      projectRoot: root,
      paths: staged,
      plan: policy.plan,
      sourceEnv,
      validation,
    })
    : { required: false, checks: [] });
  if (completionCandidate) {
    assertStagedCandidate(root, staged, sourceEnv);
    const finalTree = run("/usr/bin/git", ["write-tree"], {
      cwd: root,
      env: safeEnvironment(sourceEnv),
      label: "Host completion candidate tree",
    });
    completionGates.final_tree = finalTree;
    completionGates.tree_identity_match = finalTree === completionCandidate.candidate_tree;
    if (!completionGates.tree_identity_match) {
      fail(
        "CODEXLOOPER_COMPLETION_CANDIDATE_TREE_MISMATCH",
        "Host candidate tree does not match the isolated validated candidate tree",
      );
    }
    authority(root, sourceEnv, "After isolated completion candidate validation");
    completionGates.checks.push({
      command: "candidate tree identity verification",
      status: "PASS",
      exit_code: 0,
    });
  }
  authority(root, sourceEnv, "Before host commit");
  const message =
    phase === "task"
      ? "feat: complete CodexLooper task iteration"
      : "fix: apply CodexLooper review findings";
  run("/usr/bin/git", ["commit", "--no-gpg-sign", "--no-verify", "-m", message], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host git commit",
  });
  authority(root, sourceEnv, "After host commit");
  const commit = run("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host commit lookup",
  });
  recordEvent(policyPath, {
    schema: "codexlooper.host-commit.v3",
    created_at: now().toISOString(),
    run_id: sourceEnv.CODEXLOOPER_RUN_ID || null,
    phase,
    transport,
    commit,
    changed_paths: staged,
    validation,
    completion_gates: completionGates,
    branch: sourceEnv.CODEXLOOPER_EXPECTED_BRANCH || null,
    run_start_sha: sourceEnv.CODEXLOOPER_RUN_START_SHA || null,
  });
  return { committed: true, commit, changed_paths: staged, validation, completion_gates: completionGates };
}

function normalizePatch(patch) {
  if (typeof patch !== "string") fail("CODEXLOOPER_PATCH_INVALID", "Builder patch must be a string");
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES || patch.includes("\0")) {
    fail("CODEXLOOPER_PATCH_INVALID", "Builder patch is invalid or too large");
  }
  const normalized = patch.replaceAll("\r\n", "\n");
  if (!normalized.trim()) return "";
  const marker = normalized.split("\n").find((line) =>
    APPLY_PATCH_MARKERS.some((value) => line === value || line.startsWith(value)),
  );
  if (marker) {
    fail(
      "CODEXLOOPER_PATCH_DIALECT_MIXED",
      "Builder patch must be a pure Git unified diff: no Apply-Patch markers; every file block needs diff --git; inspect the entire patch for these markers and rewrite the complete patch before responding.",
    );
  }
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
  authority(root, sourceEnv, "Before host patch rollback");
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
  authority(root, sourceEnv, "After host patch rollback");
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
  authority(root, sourceEnv, "Before structured patch inspection");
  if (changedPaths(root).length > 0) {
    fail("CODEXLOOPER_PATCH_DIRTY", "Host patch application requires a clean worktree");
  }
  const normalizedPatch = normalizePatch(patch);
  if (!normalizedPatch) return { committed: false, changed_paths: [], validation: [] };
  const { policy, policyPath } = loadPolicy(sourceEnv, root);
  const declared = declaredPatchPaths(normalizedPatch);
  validatePaths(declared, policy.allowed_paths);
  authority(root, sourceEnv, "Before structured patch check");
  run("/usr/bin/git", ["apply", "--check", "--recount", "--whitespace=error-all", "-"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host patch check",
    input: normalizedPatch,
  });
  const completionCandidate = phase === "task" && patchTaskCompletions(normalizedPatch, policy.plan).length > 0
    ? prepareCompletionCandidate({
      root,
      patch: normalizedPatch,
      declared,
      policy,
      sourceEnv,
    })
    : null;
  let applied = false;
  try {
    authority(root, sourceEnv, "Before structured patch apply");
    run("/usr/bin/git", ["apply", "--recount", "--whitespace=error-all", "-"], {
      cwd: root,
      env: safeEnvironment(sourceEnv),
      label: "Host patch apply",
      input: normalizedPatch,
    });
    applied = true;
    authority(root, sourceEnv, "After structured patch apply");
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
      completionCandidate,
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
  authority(root, sourceEnv, "Before legacy worktree supervision");
  const paths = changedPaths(root);
  if (paths.length === 0) return { committed: false, changed_paths: [], validation: [] };
  const { policy, policyPath } = loadPolicy(sourceEnv, root);
  validatePaths(paths, policy.allowed_paths);
  try {
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
  } catch (error) {
    if (phase === "task" && pendingTaskCompletion(root, policy.plan, sourceEnv).length > 0) {
      cleanupAppliedPatch(root, paths, sourceEnv);
    }
    throw error;
  }
}
