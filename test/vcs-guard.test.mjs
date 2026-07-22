import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = resolve(ROOT, "scripts", "vcs-guard.mjs");

function git(project, args) {
  const result = spawnSync("/usr/bin/git", ["-C", project, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture() {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-vcs-guard-"));
  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "VCS Fixture"]);
  git(project, ["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(project, "anchor.txt"), "anchor\n");
  git(project, ["add", "."]);
  git(project, ["commit", "-m", "chore: initialize VCS fixture"]);
  return project;
}

function guard(project, args) {
  const start = git(project, ["rev-parse", "HEAD"]);
  return spawnSync(process.execPath, [GUARD, ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEXLOOPER_PROJECT: project,
      CODEXLOOPER_EXPECTED_PROJECT_ROOT: project,
      CODEXLOOPER_EXPECTED_BRANCH: "main",
      CODEXLOOPER_RUN_START_SHA: start,
    },
  });
}

test("Ralphex branch creation becomes a no-op on the authorized branch", () => {
  const project = fixture();
  try {
    const result = guard(project, ["checkout", "-b", "ralphex-generated-branch"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "main\n");
    assert.equal(git(project, ["branch", "--show-current"]), "main");
    assert.equal(git(project, ["branch", "--list", "ralphex-generated-branch"]), "");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("Ralphex cannot commit a dirty worktree outside the trusted host", () => {
  const project = fixture();
  try {
    writeFileSync(join(project, "dirty.txt"), "dirty\n");
    const result = guard(project, ["commit", "-am", "unauthorized"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /trusted CodexLooper host must commit/);
    assert.equal(git(project, ["log", "-1", "--pretty=%s"]), "chore: initialize VCS fixture");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("read-only Git inspection is delegated", () => {
  const project = fixture();
  try {
    const result = guard(project, ["status", "--porcelain=v1"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
