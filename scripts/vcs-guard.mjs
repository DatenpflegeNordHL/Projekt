#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { assertGitAuthorityFromEnvironment } from "../src/git-authority.mjs";

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

function mutationBlocked(args) {
  const command = args[0];
  if (["checkout", "switch", "reset", "rebase", "merge", "cherry-pick", "revert"].includes(command)) {
    return true;
  }
  if (command === "branch") {
    return args.slice(1).some((arg) =>
      ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy"].includes(arg),
    );
  }
  return false;
}

try {
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
  } else if (mutationBlocked(args)) {
    fail(`Ralphex Git mutation is prohibited: git ${args.join(" ")}`);
  } else {
    delegate(project, args);
  }

  if (!process.exitCode) {
    assertGitAuthorityFromEnvironment({
      projectRoot: project,
      label: "Ralphex VCS post-command authority",
    });
  }
} catch (error) {
  process.stderr.write(`CODEXLOOPER_VCS_BLOCK: ${error.message}\n`);
  process.exitCode = 1;
}
