#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { assertGitAuthorityFromEnvironment } from "../src/git-authority.mjs";
import { verifyRuntimeManifest } from "../src/runtime-integrity.mjs";

function fail(message) {
  throw new Error(message);
}

function safeGitEnv() {
  return Object.fromEntries(
    ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE"].flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
}

function verifyConfiguredRuntime() {
  const manifestPath = process.env.CODEXLOOPER_RUNTIME_MANIFEST;
  const manifestSha256 = process.env.CODEXLOOPER_RUNTIME_MANIFEST_SHA256;
  const runtimeDirectory = process.env.CODEXLOOPER_RUNTIME_DIR;
  const configured = [manifestPath, manifestSha256, runtimeDirectory].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) fail("Immutable runtime evidence is incomplete");
  return verifyRuntimeManifest({
    manifestPath,
    expectedManifestSha256: manifestSha256,
    expectedRuntimeDirectory: runtimeDirectory,
    expectedNodeExecutable: process.execPath,
  });
}

function currentProject() {
  const configured = process.env.CODEXLOOPER_EXPECTED_PROJECT_ROOT || process.env.CODEXLOOPER_PROJECT;
  if (!configured) fail("CODEXLOOPER_EXPECTED_PROJECT_ROOT is required");
  return realpathSync(resolve(configured));
}

function delegate(project, args) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: project,
    env: safeGitEnv(),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function isBranchCreation(args) {
  if (args[0] === "checkout" && ["-b", "-B"].includes(args[1])) return true;
  if (args[0] === "switch" && ["-c", "-C", "--create", "--force-create"].includes(args[1])) return true;
  return false;
}

const READ_ONLY_COMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "merge-base",
  "cat-file",
  "check-ignore",
  "for-each-ref",
  "describe",
  "name-rev",
  "rev-list",
]);
const READ_ONLY_BRANCH_OPTIONS = new Set([
  "-a",
  "-r",
  "-v",
  "-vv",
  "--all",
  "--remotes",
  "--verbose",
  "--no-color",
  "--color=never",
  "--show-current",
  "--list",
]);
const READ_ONLY_SYMBOLIC_REF_INVOCATIONS = [
  ["symbolic-ref", "--short", "HEAD"],
  ["symbolic-ref", "refs/remotes/origin/HEAD"],
];

function matchesArguments(args, expected) {
  return args.length === expected.length && args.every((value, index) => value === expected[index]);
}

function readOnlyAllowed(args) {
  if (READ_ONLY_COMMANDS.has(args[0])) return true;
  if (READ_ONLY_SYMBOLIC_REF_INVOCATIONS.some((expected) => matchesArguments(args, expected))) {
    return true;
  }
  if (args[0] !== "branch") return false;
  return args.length === 1 || args.slice(1).every((arg) => READ_ONLY_BRANCH_OPTIONS.has(arg));
}

try {
  verifyConfiguredRuntime();
  const project = currentProject();
  const args = process.argv.slice(2);
  if (args.length === 0) fail("Git arguments are required");

  assertGitAuthorityFromEnvironment({
    projectRoot: project,
    label: "Ralphex VCS pre-command authority",
  });

  if (isBranchCreation(args)) {
    process.stdout.write(`${process.env.CODEXLOOPER_EXPECTED_BRANCH}\n`);
    process.exitCode = 0;
  } else if (args[0] === "commit") {
    const status = spawnSync("/usr/bin/git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
      cwd: project,
      env: safeGitEnv(),
      encoding: "utf8",
    });
    if (status.error || status.status !== 0) fail("Unable to inspect worktree before Ralphex commit");
    if (String(status.stdout || "").trim()) {
      fail("Ralphex commit blocked: trusted CodexLooper host must commit every worktree mutation");
    }
    process.stdout.write("CodexLooper trusted host already committed the iteration.\n");
    process.exitCode = 0;
  } else if (readOnlyAllowed(args)) {
    delegate(project, args);
  } else {
    fail(`Ralphex Git command is not allowlisted: git ${args.join(" ")}`);
  }

  if (!process.exitCode) {
    assertGitAuthorityFromEnvironment({
      projectRoot: project,
      label: "Ralphex VCS post-command authority",
    });
  }
} catch (error) {
  process.stderr.write(`CODEXLOOPER_VCS_BLOCK: ${error.code || "CODEXLOOPER_VCS_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
}
