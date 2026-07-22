import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertGitAuthority, readGitAuthority } from "../src/git-authority.mjs";

function git(project, args) {
  const result = spawnSync("/usr/bin/git", ["-C", project, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture() {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-authority-"));
  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "Authority Fixture"]);
  git(project, ["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(project, "anchor.txt"), "one\n");
  git(project, ["add", "."]);
  git(project, ["commit", "-m", "chore: initialize authority fixture"]);
  return project;
}

test("accepts the authorized branch and monotonic descendants", () => {
  const project = fixture();
  try {
    const start = git(project, ["rev-parse", "HEAD"]);
    writeFileSync(join(project, "anchor.txt"), "two\n");
    git(project, ["add", "anchor.txt"]);
    git(project, ["commit", "-m", "test: descendant"]);
    const authority = assertGitAuthority({
      projectRoot: project,
      expectedProjectRoot: project,
      expectedBranch: "main",
      runStartSha: start,
    });
    assert.equal(authority.branch, "main");
    assert.equal(authority.ancestry_ok, true);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("rejects branch switching and detached HEAD", () => {
  const project = fixture();
  try {
    const start = git(project, ["rev-parse", "HEAD"]);
    git(project, ["switch", "-c", "other"]);
    assert.throws(
      () =>
        assertGitAuthority({
          projectRoot: project,
          expectedProjectRoot: project,
          expectedBranch: "main",
          runStartSha: start,
        }),
      (error) => error.code === "CODEXLOOPER_GIT_BRANCH_CHANGED",
    );
    git(project, ["checkout", "--detach", start]);
    assert.throws(
      () => readGitAuthority(project),
      (error) => error.code === "CODEXLOOPER_GIT_DETACHED",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("rejects rewritten history whose HEAD no longer descends from run start", () => {
  const project = fixture();
  try {
    const start = git(project, ["rev-parse", "HEAD"]);
    git(project, ["checkout", "--orphan", "replacement"]);
    writeFileSync(join(project, "replacement.txt"), "replacement\n");
    git(project, ["add", "."]);
    git(project, ["commit", "-m", "test: replacement root"]);
    git(project, ["branch", "-M", "main"]);
    assert.throws(
      () =>
        assertGitAuthority({
          projectRoot: project,
          expectedProjectRoot: project,
          expectedBranch: "main",
          runStartSha: start,
        }),
      (error) => error.code === "CODEXLOOPER_GIT_HISTORY_REWRITTEN",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
