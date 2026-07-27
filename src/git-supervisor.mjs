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
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertGitAuthorityFromEnvironment } from "./git-authority.mjs";
import { pathAllowed, validationInvocation } from "./run-policy.mjs";
import { assertManifestExternalTool, verifyRuntimeManifest } from "./runtime-integrity.mjs";
import {
  materializeBuilderOperations,
  validateBuilderOperationEnvelope,
} from "./builder-operations.mjs";

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
const MAX_CANDIDATE_CHECK_STREAM_BYTES = 8_000;
const MAX_CANDIDATE_CHECK_TAIL_BYTES = 8_000;
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

function redactCandidateDiagnostic(value, sourceEnv = process.env, candidatePath = null) {
  let text = String(value || "");
  const secret = sourceEnv.CLOSEROUTER_API_KEY;
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  if (candidatePath) {
    text = text.replaceAll(candidatePath, "<candidate>");
    text = text.replaceAll(dirname(candidatePath), "<candidate>");
  }
  return text.replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]");
}

function utf8Tail(bytes, maximumBytes) {
  let tail = bytes.subarray(Math.max(0, bytes.length - maximumBytes));
  while (tail.length > 0 && (tail[0] & 0xc0) === 0x80) tail = tail.subarray(1);
  return tail;
}

function boundedCandidateDiagnostic(value, sourceEnv, candidatePath) {
  const bytes = Buffer.from(redactCandidateDiagnostic(value, sourceEnv, candidatePath), "utf8");
  return {
    value: utf8Tail(bytes, MAX_CANDIDATE_CHECK_STREAM_BYTES).toString("utf8"),
    truncated: bytes.length > MAX_CANDIDATE_CHECK_STREAM_BYTES,
  };
}

function candidateFailureTail(stdout, stderr) {
  const relevant = /(?:assertionerror|\berror:|\bfail(?:ed|ure)?\b|not ok|[✖×])/iu;
  const streams = [stdout, stderr];
  const selected = streams.find((stream) => relevant.test(stream)) || stderr || stdout;
  const bytes = Buffer.from(selected, "utf8");
  return {
    value: utf8Tail(bytes, MAX_CANDIDATE_CHECK_TAIL_BYTES).toString("utf8").trim(),
    truncated: bytes.length > MAX_CANDIDATE_CHECK_TAIL_BYTES,
  };
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

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertSingleTaskPlanState(root, policy) {
  if (policy.single_task === undefined) return;
  if (
    policy.single_task !== true ||
    !Number.isSafeInteger(policy.selected_task) ||
    policy.selected_task < 1 ||
    policy.original_plan !== policy.plan ||
    !/^[a-f0-9]{64}$/.test(policy.original_plan_sha256 || "") ||
    !/^[a-f0-9]{64}$/.test(policy.selected_task_completed_plan_sha256 || "") ||
    !/^[a-f0-9]{64}$/.test(policy.derived_plan_sha256 || "")
  ) {
    fail("CODEXLOOPER_SINGLE_TASK_POLICY_INVALID", "Single-task policy metadata is invalid");
  }
  const content = readFileSync(resolve(root, policy.plan), "utf8");
  const actual = sha256(content);
  if (actual !== policy.original_plan_sha256 && actual !== policy.selected_task_completed_plan_sha256) {
    fail(
      "CODEXLOOPER_SINGLE_TASK_PLAN_MUTATION",
      "Single-task execution may only complete the selected task checkbox in the original plan",
    );
  }
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

function pinnedProjectCheck(policy) {
  const check = policy.full_project_check;
  if (
    !check ||
    typeof check !== "object" ||
    Array.isArray(check) ||
    !/^[a-f0-9]{64}$/.test(check.package_json_sha256 || "") ||
    typeof check.check_script !== "string" ||
    !check.check_script ||
    check.check_script.includes("\0")
  ) {
    fail("CODEXLOOPER_PROJECT_CHECK_INVALID", "Run policy is missing an immutable package scripts.check binding");
  }
  return check;
}

function runFullProjectCandidateCheck(projectRoot, policy, sourceEnv, environment) {
  const npmCli = runtimeNpmCli(sourceEnv);
  if (!npmCli) return null;
  const pinned = pinnedProjectCheck(policy);
  const packagePath = resolve(projectRoot, "package.json");
  const stat = lstatSync(packagePath);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(packagePath) !== packagePath) {
    fail("CODEXLOOPER_PROJECT_CHECK_INVALID", "Candidate package.json must be a canonical regular file");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    fail("CODEXLOOPER_PROJECT_CHECK_INVALID", "Candidate package.json must be valid JSON");
  }
  if (manifest?.scripts?.check !== pinned.check_script) {
    fail("CODEXLOOPER_PROJECT_CHECK_CHANGED", "Candidate changed the run-start package scripts.check command");
  }
  const started = Date.now();
  const execution = spawnSync(process.execPath, [npmCli, "run", "check"], {
    cwd: projectRoot,
    env: environment,
    timeout: VALIDATION_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (execution.error || execution.status === null) {
    const detail = boundedCandidateDiagnostic(
      execution.stderr || execution.stdout || execution.error?.message || "unknown error",
      sourceEnv,
      projectRoot,
    ).value.trim();
    fail(
      "CODEXLOOPER_HOST_COMMAND_FAILED",
      `Candidate full-project npm run check failed${detail ? `: ${detail}` : ""}`,
    );
  }
  if (execution.status !== 0) {
    const stdout = boundedCandidateDiagnostic(execution.stdout, sourceEnv, projectRoot);
    const stderr = boundedCandidateDiagnostic(execution.stderr, sourceEnv, projectRoot);
    const failureTail = candidateFailureTail(stdout.value, stderr.value);
    const error = new Error(
      `Candidate full-project npm run check failed with status ${execution.status}${failureTail.value ? `: ${failureTail.value}` : ""}`,
    );
    error.code = "CODEXLOOPER_CANDIDATE_FULL_PROJECT_CHECK_FAILED";
    error.candidateValidationContext = Object.freeze({
      failure_code: error.code,
      category: "candidate_full_project_validation",
      command: "npm run check",
      exit_status: execution.status,
      failure_tail: failureTail.value,
      truncated: failureTail.truncated || stdout.truncated || stderr.truncated,
    });
    error.candidateValidationDiagnostic = Object.freeze({
      failure_code: error.code,
      command: "npm run check",
      exit_status: execution.status,
      stdout: stdout.value,
      stderr: stderr.value,
      stdout_truncated: stdout.truncated,
      stderr_truncated: stderr.truncated,
    });
    throw error;
  }
  return {
    command: "npm run check",
    executable: npmCli,
    package_json_sha256: pinned.package_json_sha256,
    duration_ms: Math.max(0, Date.now() - started),
    status: "PASS",
  };
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

function assertCandidateClean(projectRoot, sourceEnv, label) {
  const status = run("/usr/bin/git", ["status", "--porcelain=v1", "--ignored"], {
    cwd: projectRoot,
    env: sourceEnv,
    label,
  });
  if (status) {
    fail("CODEXLOOPER_COMPLETION_CANDIDATE_DIRTY", "Candidate repository must be clean with no ignored artifacts");
  }
}

function candidateCommitEnvironment(environment) {
  return {
    ...environment,
    GIT_AUTHOR_NAME: "CodexLooper Candidate",
    GIT_AUTHOR_EMAIL: "candidate@codexlooper.invalid",
    GIT_COMMITTER_NAME: "CodexLooper Candidate",
    GIT_COMMITTER_EMAIL: "candidate@codexlooper.invalid",
  };
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

function candidateIndexTree(projectRoot, sourceEnv) {
  return run("/usr/bin/git", ["write-tree"], {
    cwd: projectRoot,
    env: sourceEnv,
    label: "Candidate index tree lookup",
  });
}

function assertCandidateCommit(projectRoot, sourceEnv, start, expectedTree) {
  if (run("/usr/bin/git", ["remote"], { cwd: projectRoot, env: sourceEnv, label: "Candidate remote verification" })) {
    fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate temporary commit must not retain a remote");
  }
  const parents = run("/usr/bin/git", ["rev-list", "--parents", "-n", "1", "HEAD"], {
    cwd: projectRoot,
    env: sourceEnv,
    label: "Candidate parent verification",
  }).split(" ");
  if (parents.length !== 2 || parents[1] !== start) {
    fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate temporary commit must have exactly the candidate start as parent");
  }
  if (candidateTree(projectRoot, sourceEnv) !== expectedTree) {
    fail("CODEXLOOPER_COMPLETION_CANDIDATE_TREE_MISMATCH", "Candidate temporary commit tree does not match the verified staged tree");
  }
  if (run("/usr/bin/git", ["show", "-s", "--format=%an%n%ae%n%cn%n%ce", "HEAD"], {
    cwd: projectRoot,
    env: sourceEnv,
    label: "Candidate commit identity verification",
  }) !== "CodexLooper Candidate\ncandidate@codexlooper.invalid\nCodexLooper Candidate\ncandidate@codexlooper.invalid") {
    fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate temporary commit must use the fixed isolated identity");
  }
  assertCandidateClean(projectRoot, sourceEnv, "Candidate clean temporary commit verification");
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

function prepareCompletionCandidate({ root, patch, declared, policy, sourceEnv, requireTaskCompletion }) {
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
    assertCandidateClean(candidate, env, "Completion candidate clean checkout");
    run("/usr/bin/git", ["apply", "--check", "--whitespace=error-all", "-"], {
      cwd: candidate,
      env,
      label: "Completion candidate patch check",
      input: patch,
    });
    run("/usr/bin/git", ["apply", "--whitespace=error-all", "-"], {
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
    if (requireTaskCompletion && tasks.length === 0) {
      fail("CODEXLOOPER_COMPLETION_CANDIDATE_INVALID", "Candidate patch did not complete the declared task checkbox");
    }
    run("/usr/bin/git", ["add", "--", ...actual], {
      cwd: candidate,
      env,
      label: "Completion candidate staging",
    });
    assertStagedCandidate(candidate, actual, env);
    const expectedTree = candidateIndexTree(candidate, env);
    run("/usr/bin/git", [
      "-c", "core.hooksPath=/dev/null",
      "-c", "commit.gpgSign=false",
      "commit", "--no-gpg-sign", "--no-verify", "-m", "chore: validate completion candidate",
    ], {
      cwd: candidate,
      env: candidateCommitEnvironment(env),
      label: "Completion candidate temporary commit",
    });
    assertCandidateCommit(candidate, env, start, expectedTree);
    const validation = runValidationCommands(candidate, policy.validation_commands, policy.allowed_paths, env);
    const checks = validation.map((entry) => ({ ...entry, gate: "plan_validation" }));
    const fullProjectCheck = runFullProjectCandidateCheck(candidate, policy, sourceEnv, env);
    if (fullProjectCheck) checks.push({ ...fullProjectCheck, gate: "full_project_check" });
    assertCandidateClean(candidate, env, "Candidate post-validation clean verification");
    result = {
      required: true,
      mode: "isolated_candidate_repository",
      expected_start_sha: start,
      candidate_tree: candidateTree(candidate, env),
      tasks,
      validation,
      full_project_check: fullProjectCheck,
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
  assertSingleTaskPlanState(root, policy);
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
      command: "branch-lock and ancestry verification",
      status: "PASS",
      exit_code: 0,
    });
    assertStagedCandidate(root, staged, sourceEnv);
    completionGates.checks.push({
      command: "clean-worktree verification",
      status: "PASS",
      exit_code: 0,
    });
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

function invalidUnifiedDiff(message) {
  fail("CODEXLOOPER_PATCH_UNIFIED_DIFF_INVALID", `Builder patch is not a complete Git unified diff: ${message}`);
}

function assertCompleteUnifiedDiff(patch) {
  let section = null;
  let hunk = null;

  function finishHunk() {
    if (hunk && (hunk.oldLines !== hunk.expectedOld || hunk.newLines !== hunk.expectedNew)) {
      invalidUnifiedDiff("a hunk is truncated or its declared line counts do not match its content");
    }
    hunk = null;
  }

  function finishSection() {
    if (!section) return;
    finishHunk();
    if (!section.oldHeader || !section.newHeader || section.hunks === 0) {
      invalidUnifiedDiff("every file block needs --- and +++ headers plus at least one complete hunk");
    }
  }

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finishSection();
      const match = line.match(/^diff --git a\/([^\s]+) b\/([^\s]+)$/);
      if (!match) invalidUnifiedDiff("a file block has an invalid diff --git header");
      section = { oldPath: `a/${match[1]}`, newPath: `b/${match[2]}`, oldHeader: false, newHeader: false, hunks: 0 };
      continue;
    }
    if (!section) {
      if (line) invalidUnifiedDiff("content appears before the first file block");
      continue;
    }
    if (
      hunk &&
      hunk.oldLines === hunk.expectedOld &&
      hunk.newLines === hunk.expectedNew &&
      (line === "" || line.startsWith("@@ "))
    ) {
      hunk = null;
    }
    if (hunk) {
      if (line === "\\ No newline at end of file") continue;
      if (line.startsWith(" ")) {
        hunk.oldLines += 1;
        hunk.newLines += 1;
      } else if (line.startsWith("-")) {
        hunk.oldLines += 1;
      } else if (line.startsWith("+")) {
        hunk.newLines += 1;
      } else {
        invalidUnifiedDiff("a hunk contains a line without a unified-diff prefix");
      }
      if (hunk.oldLines > hunk.expectedOld || hunk.newLines > hunk.expectedNew) {
        invalidUnifiedDiff("a hunk contains more lines than declared in its header");
      }
      continue;
    }
    if (line.startsWith("--- ")) {
      if (section.oldHeader || section.newHeader) invalidUnifiedDiff("a file block has duplicate or misplaced --- headers");
      if (line !== `--- ${section.oldPath}` && line !== "--- /dev/null") {
        invalidUnifiedDiff("a --- header does not match its diff --git path");
      }
      section.oldHeader = true;
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (!section.oldHeader || section.newHeader) invalidUnifiedDiff("a file block has duplicate or misplaced +++ headers");
      if (line !== `+++ ${section.newPath}` && line !== "+++ /dev/null") {
        invalidUnifiedDiff("a +++ header does not match its diff --git path");
      }
      section.newHeader = true;
      continue;
    }
    if (line.startsWith("@@ ")) {
      if (!section.oldHeader || !section.newHeader) invalidUnifiedDiff("a hunk appears before complete file headers");
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/);
      if (!match) invalidUnifiedDiff("a hunk header is malformed");
      hunk = {
        expectedOld: Number(match[2] || 1),
        expectedNew: Number(match[4] || 1),
        oldLines: 0,
        newLines: 0,
      };
      section.hunks += 1;
      continue;
    }
    if (!line || line.startsWith("index ") || /^(?:old|new|new file|deleted file) mode \d+$/.test(line)) continue;
    invalidUnifiedDiff("a file block contains unexpected content outside a hunk");
  }
  finishSection();
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

function candidateOperationPath(candidate, path) {
  const target = resolve(candidate, path);
  const candidateRelative = relative(candidate, target);
  if (!candidateRelative || candidateRelative.startsWith("..") || isAbsolute(candidateRelative)) {
    fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operation path escapes the private candidate");
  }
  let current = candidate;
  for (const component of path.split("/")) {
    current = resolve(current, component);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operation path traverses a candidate symlink");
      }
      if (current !== target && !stat.isDirectory()) {
        fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operation path has a non-directory parent");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return target;
}

function operationBaseline(candidate, operations) {
  const baseline = Object.create(null);
  for (const operation of operations) {
    const target = candidateOperationPath(candidate, operation.path);
    try {
      const stat = lstatSync(target);
      if (!stat.isFile()) {
        fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operation target must be a regular candidate file");
      }
      const bytes = readFileSync(target);
      const content = bytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(bytes)) {
        fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operation baseline must be valid UTF-8 text");
      }
      baseline[operation.path] = content;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return baseline;
}

function materializeBuilderOperationsCandidate({ root, operations, declared, policy, sourceEnv }) {
  const start = run("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Builder operation candidate start HEAD",
  });
  const temporary = candidateRoot();
  const candidate = resolve(temporary, "repository");
  let failure = null;
  try {
    const env = isolatedCandidateEnvironment(temporary);
    run("/usr/bin/git", ["clone", "--no-local", "--no-checkout", "--", root, candidate], {
      cwd: temporary,
      env,
      label: "Builder operation candidate local clone",
      timeout: VALIDATION_TIMEOUT_MS,
    });
    chmodSync(candidate, 0o700);
    if (realpathSync(candidate) !== candidate || lstatSync(candidate).isSymbolicLink()) {
      fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operation candidate must stay inside its private root");
    }
    run("/usr/bin/git", ["remote", "remove", "origin"], {
      cwd: candidate,
      env,
      label: "Builder operation candidate remote removal",
    });
    run("/usr/bin/git", ["config", "--local", "core.hooksPath", "/dev/null"], {
      cwd: candidate,
      env,
      label: "Builder operation candidate hook isolation",
    });
    run("/usr/bin/git", ["checkout", "--detach", start], {
      cwd: candidate,
      env,
      label: "Builder operation candidate checkout",
    });
    if (run("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: candidate, env, label: "Builder operation candidate HEAD" }) !== start) {
      fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operation candidate did not check out the expected HEAD");
    }
    if (run("/usr/bin/git", ["status", "--porcelain=v1"], { cwd: candidate, env, label: "Builder operation candidate clean checkout" })) {
      fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_DIRTY", "Builder operation candidate is not clean after checkout");
    }
    const materialized = materializeBuilderOperations(operationBaseline(candidate, operations), {
      version: 2,
      operations,
    });
    if (!samePaths(materialized.changed_paths, declared)) {
      fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Materialized builder operation paths do not match the validated envelope");
    }
    for (const path of materialized.changed_paths) {
      const target = candidateOperationPath(candidate, path);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, materialized.files.get(path), { encoding: "utf8", mode: 0o600, flag: "w" });
    }
    const actual = changedPaths(candidate, env);
    if (!samePaths(actual, declared)) {
      fail("CODEXLOOPER_PATCH_PATH_MISMATCH", "Materialized candidate paths do not match the validated envelope");
    }
    validatePaths(actual, policy.allowed_paths);
    run("/usr/bin/git", ["add", "--intent-to-add", "--", ...actual], {
      cwd: candidate,
      env,
      label: "Builder operation candidate intent-to-add",
    });
    const canonical = run("/usr/bin/git", ["diff", "--no-ext-diff", "--binary", "--"], {
      cwd: candidate,
      env,
      label: "Builder operation canonical diff generation",
    });
    if (!canonical) {
      fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_INVALID", "Builder operations produced no canonical diff");
    }
    const canonicalPatch = `${canonical}\n`;
    assertCompleteUnifiedDiff(canonicalPatch);
    const canonicalPaths = declaredPatchPaths(canonicalPatch);
    if (!samePaths(canonicalPaths, declared)) {
      fail("CODEXLOOPER_PATCH_PATH_MISMATCH", "Host-generated canonical diff paths do not match the validated envelope");
    }
    return canonicalPatch;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      removeCandidateRoot(temporary);
    } catch (error) {
      if (!failure) fail("CODEXLOOPER_BUILDER_OPERATION_CANDIDATE_CLEANUP_FAILED", error.message);
    }
  }
}

function builderOperationPreconditionRetryContext(error, operations) {
  if (error?.code !== "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED") return null;
  const reasons = [
    ["create_file", "create_file target already exists", "target already exists"],
    ["replace_exact", "replace_exact target is absent", "target is absent"],
    ["replace_exact", "replace_exact baseline hash is stale", "baseline hash is stale"],
    ["replace_exact", "replace_exact old_text must occur exactly once", "old_text matched zero or multiple locations"],
  ];
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    for (const [type, prefix, reason] of reasons) {
      if (operation.type === type && error.message === `${prefix}: ${operation.path}`) {
        return Object.freeze({
          failure_code: error.code,
          category: "operation_precondition",
          operation_index: index,
          operation_type: operation.type,
          path: operation.path,
          reason,
        });
      }
    }
  }
  return null;
}

export function applyBuilderPatch({
  patch,
  phase,
  sourceEnv = process.env,
  projectRoot = process.cwd(),
  now = () => new Date(),
  transport = "structured_patch",
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
  assertCompleteUnifiedDiff(normalizedPatch);
  authority(root, sourceEnv, "Before structured patch check");
  run("/usr/bin/git", ["apply", "--check", "--whitespace=error-all", "-"], {
    cwd: root,
    env: safeEnvironment(sourceEnv),
    label: "Host patch check",
    input: normalizedPatch,
  });
  const requireTaskCompletion = phase === "task" && patchTaskCompletions(normalizedPatch, policy.plan).length > 0;
  const completionCandidate = requireTaskCompletion || runtimeNpmCli(sourceEnv)
    ? prepareCompletionCandidate({
      root,
      patch: normalizedPatch,
      declared,
      policy,
      sourceEnv,
      requireTaskCompletion,
    })
    : null;
  let applied = false;
  try {
    authority(root, sourceEnv, "Before structured patch apply");
    run("/usr/bin/git", ["apply", "--whitespace=error-all", "-"], {
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
      transport,
      completionCandidate,
    });
  } catch (error) {
    if (applied && changedPaths(root).length > 0) cleanupAppliedPatch(root, declared, sourceEnv);
    throw error;
  }
}

export function applyBuilderOperations({
  envelope,
  phase,
  sourceEnv = process.env,
  projectRoot = process.cwd(),
  now = () => new Date(),
} = {}) {
  if (phase !== "task" && phase !== "review") {
    fail("CODEXLOOPER_SUPERVISOR_PHASE_INVALID", "Supervisor phase must be task or review");
  }
  const root = realpathSync(projectRoot);
  authority(root, sourceEnv, "Before Builder Envelope v2 inspection");
  if (changedPaths(root).length > 0) {
    fail("CODEXLOOPER_PATCH_DIRTY", "Builder Envelope v2 application requires a clean worktree");
  }
  const validated = validateBuilderOperationEnvelope(envelope);
  const { policy } = loadPolicy(sourceEnv, root);
  const declared = validated.operations.map((operation) => operation.path).sort();
  validatePaths(declared, policy.allowed_paths);
  let canonicalDiff;
  try {
    canonicalDiff = materializeBuilderOperationsCandidate({
      root,
      operations: validated.operations,
      declared,
      policy,
      sourceEnv,
    });
  } catch (error) {
    const retryContext = builderOperationPreconditionRetryContext(error, validated.operations);
    if (retryContext) error.builderRetryContext = retryContext;
    throw error;
  }
  const result = applyBuilderPatch({
    patch: canonicalDiff,
    phase,
    sourceEnv,
    projectRoot: root,
    now,
    transport: "builder_envelope_v2_host_generated_diff",
  });
  return { ...result, canonical_diff: canonicalDiff };
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
