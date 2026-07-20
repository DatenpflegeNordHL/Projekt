import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyBuilderPatch, superviseBuilderChanges } from "../src/git-supervisor.mjs";

function git(root, args) {
  const result = spawnSync("/usr/bin/git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture({ validationCommands = ["node --check src/value.mjs"] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-supervisor-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "CodexLooper Test"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  writeFileSync(join(root, ".git", "info", "exclude"), ".codexlooper/\n.ralphex/\n");
  writeFileSync(join(root, "src", "value.mjs"), "export const value = 1;\n");
  writeFileSync(
    join(root, "docs", "plans", "feature.md"),
    "# Plan\n\n## Allowed paths\n- `src/**`\n- `this plan file`\n\n## Validation Commands\n- `node --check src/value.mjs`\n\n### Task 1: Change\n- [ ] Update value\n",
  );
  writeFileSync(join(root, "README.md"), "fixture\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "chore: initialize fixture"]);

  const runDirectory = join(root, ".codexlooper", "runs", "run-1");
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  chmodSync(join(root, ".codexlooper"), 0o700);
  chmodSync(join(root, ".codexlooper", "runs"), 0o700);
  chmodSync(runDirectory, 0o700);
  const policyPath = join(runDirectory, "policy.json");
  writeFileSync(
    policyPath,
    `${JSON.stringify({
      schema: "codexlooper.run-policy.v1",
      plan: "docs/plans/feature.md",
      allowed_paths: [
        { type: "prefix", value: "src/" },
        { type: "exact", value: "docs/plans/feature.md" },
      ],
      validation_commands: validationCommands,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { root, policyPath, runDirectory };
}

function sourceEnv(current) {
  return {
    ...process.env,
    CODEXLOOPER_RUN_ID: "run-1",
    CODEXLOOPER_RUN_POLICY: current.policyPath,
  };
}

test("validates and commits only plan-allowed builder changes", () => {
  const current = fixture();
  try {
    writeFileSync(join(current.root, "src", "value.mjs"), "export const value = 2;\n");
    const planPath = join(current.root, "docs", "plans", "feature.md");
    writeFileSync(planPath, readFileSync(planPath, "utf8").replace("- [ ] Update", "- [x] Update"));

    const result = superviseBuilderChanges({
      phase: "task",
      sourceEnv: sourceEnv(current),
      projectRoot: current.root,
      now: () => new Date("2026-07-20T18:00:00.000Z"),
    });

    assert.equal(result.committed, true);
    assert.deepEqual(result.changed_paths, ["docs/plans/feature.md", "src/value.mjs"]);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "2");
    assert.match(git(current.root, ["log", "-1", "--pretty=%s"]), /CodexLooper task iteration/);
    const event = readFileSync(resolve(current.runDirectory, "host-commits.jsonl"), "utf8");
    assert.match(event, /"phase":"task"/);
    assert.match(event, /"transport":"worktree"/);
    assert.doesNotMatch(event, /CLOSEROUTER_API_KEY|Bearer/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects changes outside the roadmap path policy", () => {
  const current = fixture();
  try {
    writeFileSync(join(current.root, "README.md"), "changed outside policy\n");
    assert.throws(
      () =>
        superviseBuilderChanges({
          phase: "task",
          sourceEnv: sourceEnv(current),
          projectRoot: current.root,
        }),
      (error) => error.code === "CODEXLOOPER_PATH_POLICY_VIOLATION",
    );
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "1");
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("checks, applies, validates and commits a structured patch", () => {
  const current = fixture();
  try {
    const patch = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
    const result = applyBuilderPatch({
      patch,
      phase: "task",
      sourceEnv: sourceEnv(current),
      projectRoot: current.root,
      now: () => new Date("2026-07-20T18:10:00.000Z"),
    });
    assert.equal(result.committed, true);
    assert.deepEqual(result.changed_paths, ["src/value.mjs"]);
    assert.equal(readFileSync(join(current.root, "src", "value.mjs"), "utf8"), "export const value = 2;\n");
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    const event = readFileSync(resolve(current.runDirectory, "host-commits.jsonl"), "utf8");
    assert.match(event, /"transport":"structured_patch"/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rejects a structured patch outside policy before applying it", () => {
  const current = fixture();
  try {
    const patch = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-fixture
+outside
`;
    assert.throws(
      () =>
        applyBuilderPatch({
          patch,
          phase: "task",
          sourceEnv: sourceEnv(current),
          projectRoot: current.root,
        }),
      (error) => error.code === "CODEXLOOPER_PATH_POLICY_VIOLATION",
    );
    assert.equal(readFileSync(join(current.root, "README.md"), "utf8"), "fixture\n");
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("rolls back an applied patch when validation fails", () => {
  const current = fixture();
  try {
    const patch = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1 +1 @@
-export const value = 1;
+export const value = ;
`;
    assert.throws(
      () =>
        applyBuilderPatch({
          patch,
          phase: "task",
          sourceEnv: sourceEnv(current),
          projectRoot: current.root,
        }),
      (error) => error.code === "CODEXLOOPER_HOST_COMMAND_FAILED",
    );
    assert.equal(readFileSync(join(current.root, "src", "value.mjs"), "utf8"), "export const value = 1;\n");
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "1");
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
