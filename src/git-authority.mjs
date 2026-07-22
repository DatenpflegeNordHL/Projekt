import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function safeGitEnv(sourceEnv = process.env) {
  return Object.fromEntries(
    ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE"].flatMap((key) =>
      sourceEnv[key] === undefined ? [] : [[key, sourceEnv[key]]],
    ),
  );
}

function gitResult(projectRoot, args, sourceEnv = process.env) {
  return spawnSync("/usr/bin/git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: safeGitEnv(sourceEnv),
  });
}

function git(projectRoot, args, label, sourceEnv = process.env) {
  const result = gitResult(projectRoot, args, sourceEnv);
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail("CODEXLOOPER_GIT_AUTHORITY_FAILED", `${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function fullSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    fail("CODEXLOOPER_GIT_AUTHORITY_INVALID", `${label} must be a full lowercase Git SHA`);
  }
  return value;
}

function branchName(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 240 ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    fail("CODEXLOOPER_GIT_AUTHORITY_INVALID", "Expected branch is invalid");
  }
  return value;
}

export function readGitAuthority(projectRoot, sourceEnv = process.env) {
  const root = realpathSync(projectRoot);
  const reportedRoot = realpathSync(git(root, ["rev-parse", "--show-toplevel"], "Git root check", sourceEnv));
  if (reportedRoot !== root) {
    fail("CODEXLOOPER_GIT_ROOT_CHANGED", "Git repository root changed during the run");
  }
  const branchResult = gitResult(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], sourceEnv);
  if (branchResult.error || branchResult.status !== 0) {
    fail("CODEXLOOPER_GIT_DETACHED", "Detached HEAD is not allowed during a CodexLooper run");
  }
  const branch = String(branchResult.stdout || "").trim();
  if (!branch) fail("CODEXLOOPER_GIT_DETACHED", "Current Git branch is empty");
  const head = git(root, ["rev-parse", "HEAD"], "Git HEAD check", sourceEnv);
  fullSha(head, "Current HEAD");
  return { root, branch, head };
}

export function assertGitAuthority({
  projectRoot,
  expectedProjectRoot,
  expectedBranch,
  runStartSha,
  sourceEnv = process.env,
  label = "Git authority check",
} = {}) {
  const current = readGitAuthority(projectRoot, sourceEnv);
  const expectedRoot = realpathSync(expectedProjectRoot || projectRoot);
  if (current.root !== expectedRoot) {
    fail("CODEXLOOPER_GIT_ROOT_CHANGED", `${label}: repository root changed`);
  }
  const branch = branchName(expectedBranch);
  if (current.branch !== branch) {
    fail(
      "CODEXLOOPER_GIT_BRANCH_CHANGED",
      `${label}: expected branch ${branch}, found ${current.branch}`,
    );
  }
  const start = fullSha(runStartSha, "Run start SHA");
  const ancestor = gitResult(current.root, ["merge-base", "--is-ancestor", start, current.head], sourceEnv);
  if (ancestor.error || (ancestor.status !== 0 && ancestor.status !== 1)) {
    const detail = String(ancestor.stderr || ancestor.stdout || ancestor.error?.message || "unknown error").trim();
    fail("CODEXLOOPER_GIT_AUTHORITY_FAILED", `${label}: ancestry check failed${detail ? `: ${detail}` : ""}`);
  }
  if (ancestor.status === 1) {
    fail("CODEXLOOPER_GIT_HISTORY_REWRITTEN", `${label}: run start SHA is no longer an ancestor of HEAD`);
  }
  return { ...current, run_start_sha: start, ancestry_ok: true };
}

export function assertGitAuthorityFromEnvironment({
  projectRoot = process.cwd(),
  sourceEnv = process.env,
  label,
} = {}) {
  const expectedBranch = sourceEnv.CODEXLOOPER_EXPECTED_BRANCH;
  const runStartSha = sourceEnv.CODEXLOOPER_RUN_START_SHA;
  const expectedProjectRoot = sourceEnv.CODEXLOOPER_EXPECTED_PROJECT_ROOT;
  const present = [expectedBranch, runStartSha, expectedProjectRoot].filter(Boolean).length;
  if (present === 0) return null;
  if (present !== 3) {
    fail("CODEXLOOPER_GIT_AUTHORITY_INVALID", "Git authority environment is incomplete");
  }
  return assertGitAuthority({
    projectRoot,
    expectedProjectRoot,
    expectedBranch,
    runStartSha,
    sourceEnv,
    label,
  });
}
