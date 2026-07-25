import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyBuilderPatch, superviseBuilderChanges } from "../src/git-supervisor.mjs";
import { installImmutableRuntime, RUNTIME_FILES } from "../src/runtime-integrity.mjs";
import { removeTree } from "./helpers/remove-tree.mjs";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(root, args) {
  const result = spawnSync("/usr/bin/git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture({
  validationCommands = ["node --check src/value.mjs"],
  candidateRuntimeCheck = false,
  candidateCheck = "node --check src/value.mjs",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-supervisor-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "docs", "plans"), { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "CodexLooper Test"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  writeFileSync(join(root, ".git", "info", "exclude"), ".codexlooper/\n.ralphex/\n");
  writeFileSync(join(root, "src", "value.mjs"), "export const value = 1;\n");
  writeFileSync(join(root, "src", "marker.txt"), "*** context\nold\n");
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ private: true, scripts: { check: candidateCheck } })}\n`);
  if (candidateRuntimeCheck) {
    for (const path of RUNTIME_FILES) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(SOURCE_ROOT, path), target);
    }
    writeFileSync(
      join(root, "candidate-check.mjs"),
      `import { chmodSync, existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { installImmutableRuntime } from "./src/runtime-integrity.mjs";

if (process.env.CLOSEROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.GITHUB_TOKEN) {
  throw new Error("candidate environment contains a secret");
}
function removeTree(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) removeTree(path + "/" + entry);
  } else {
    chmodSync(path, 0o600);
  }
  rmSync(path, stat.isDirectory() ? { recursive: true, force: true } : { force: true });
}
try {
  installImmutableRuntime({
    sourceRoot: process.cwd(),
    projectRoot: process.cwd(),
    externalTools: {
      codex: { path: process.execPath, version: "candidate" },
      mex: { path: process.execPath, version: "candidate" },
      npm_cli: { path: process.execPath, version: "candidate" },
      ralphex: { path: process.execPath, version: "candidate" },
    },
    budgets: { max_builder_calls: 1, max_reviewer_calls: 1, max_run_duration_ms: 1000, max_estimated_cost_usd: 1, model_call_reserve_usd: 0.1, max_crg_builds: 0 },
  });
} finally {
  if (existsSync(".codexlooper")) removeTree(".codexlooper");
}
`,
    );
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ private: true, scripts: { check: "node candidate-check.mjs" } })}\n`);
  }
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

function completionEnv(current) {
  const npmCli = resolve(dirname(process.execPath), "npm");
  const sourceParent = mkdtempSync(join(tmpdir(), "codexlooper-runtime-source-"));
  const sourceRoot = join(sourceParent, "source");
  let runtime;
  try {
    git(sourceParent, ["clone", "--no-local", "--", SOURCE_ROOT, sourceRoot]);
    runtime = installImmutableRuntime({
      sourceRoot,
      projectRoot: current.root,
      externalTools: {
        codex: { path: process.execPath, version: "test" },
        mex: { path: process.execPath, version: "test" },
        npm_cli: { path: npmCli, version: "test" },
        ralphex: { path: process.execPath, version: "test" },
      },
      budgets: {
        max_builder_calls: 12,
        max_reviewer_calls: 3,
        max_run_duration_ms: 3_600_000,
        max_estimated_cost_usd: 0.5,
        model_call_reserve_usd: 0.05,
        max_crg_builds: 0,
      },
    });
  } finally {
    rmSync(sourceParent, { recursive: true, force: true });
  }
  const start = git(current.root, ["rev-parse", "HEAD"]);
  return {
    ...sourceEnv(current),
    CODEXLOOPER_RUNTIME_DIR: runtime.runtimeDirectory,
    CODEXLOOPER_RUNTIME_MANIFEST: runtime.manifestPath,
    CODEXLOOPER_RUNTIME_MANIFEST_SHA256: runtime.manifestSha256,
    CODEXLOOPER_NPM_CLI: npmCli,
    CODEXLOOPER_EXPECTED_PROJECT_ROOT: current.root,
    CODEXLOOPER_EXPECTED_BRANCH: "main",
    CODEXLOOPER_RUN_START_SHA: start,
  };
}

function generatedPatch(root, changes) {
  const original = changes.map(({ path }) => ({ path, content: readFileSync(join(root, path), "utf8") }));
  try {
    for (const { path, content } of changes) writeFileSync(join(root, path), content);
    return git(root, ["diff", "--no-ext-diff", "--"]);
  } finally {
    for (const { path, content } of original) writeFileSync(join(root, path), content);
  }
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
    assert.match(event, /"completion_gates":\{"required":false,"legacy":true/);
    assert.doesNotMatch(event, /CLOSEROUTER_API_KEY|Bearer/);
  } finally {
    removeTree(current.root);
  }
});

test("rolls back a completed task when trusted completion evidence is incomplete", () => {
  const current = fixture();
  try {
    writeFileSync(join(current.root, "src", "value.mjs"), "export const value = 2;\n");
    const planPath = join(current.root, "docs", "plans", "feature.md");
    writeFileSync(planPath, readFileSync(planPath, "utf8").replace("- [ ] Update", "- [x] Update"));
    assert.throws(
      () => superviseBuilderChanges({
        phase: "task",
        sourceEnv: {
          ...sourceEnv(current),
          CODEXLOOPER_RUNTIME_MANIFEST: "/incomplete/manifest.json",
        },
        projectRoot: current.root,
      }),
      (error) => error.code === "CODEXLOOPER_COMPLETION_GATE_RUNTIME_INVALID",
    );
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(readFileSync(planPath, "utf8").includes("- [ ] Update"), true);
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "1");
  } finally {
    removeTree(current.root);
  }
});

test("validates a runtime-source completion patch in an isolated clean candidate", () => {
  const current = fixture({ candidateRuntimeCheck: true });
  try {
    const planPath = join(current.root, "docs", "plans", "feature.md");
    const supervisorPath = join(current.root, "src", "git-supervisor.mjs");
    const patch = generatedPatch(current.root, [
      {
        path: "src/git-supervisor.mjs",
        content: `// isolated candidate runtime-source probe\n${readFileSync(supervisorPath, "utf8")}`,
      },
      {
        path: "docs/plans/feature.md",
        content: readFileSync(planPath, "utf8").replace("- [ ] Update", "- [x] Update"),
      },
    ]);
    const result = applyBuilderPatch({
      patch,
      phase: "task",
      sourceEnv: completionEnv(current),
      projectRoot: current.root,
    });
    assert.equal(result.committed, true);
    assert.equal(result.completion_gates.mode, "isolated_candidate_repository");
    assert.equal(result.completion_gates.cleanup, "PASS");
    assert.equal(result.completion_gates.tree_identity_match, true);
    assert.equal(result.completion_gates.candidate_tree, result.completion_gates.final_tree);
    assert.ok(result.completion_gates.checks.some((entry) => entry.command === "npm run check"));
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "2");
    const event = readFileSync(resolve(current.runDirectory, "host-commits.jsonl"), "utf8");
    assert.match(event, /"mode":"isolated_candidate_repository"/);
    assert.match(event, /"tree_identity_match":true/);
    assert.match(event, /"cleanup":"PASS"/);
  } finally {
    removeTree(current.root);
  }
});

test("preserves the actual candidate test failure and leaves the host untouched", () => {
  const current = fixture({ candidateCheck: "node -e \"throw new Error('candidate test failure')\"" });
  try {
    const planPath = join(current.root, "docs", "plans", "feature.md");
    const patch = generatedPatch(current.root, [
      {
        path: "src/value.mjs",
        content: "export const value = 2;\n",
      },
      {
        path: "docs/plans/feature.md",
        content: readFileSync(planPath, "utf8").replace("- [ ] Update", "- [x] Update"),
      },
    ]);
    const start = git(current.root, ["rev-parse", "HEAD"]);
    assert.throws(
      () => applyBuilderPatch({ patch, phase: "task", sourceEnv: completionEnv(current), projectRoot: current.root }),
      (error) => error.code === "CODEXLOOPER_HOST_COMMAND_FAILED" && /candidate test failure/.test(error.message),
    );
    assert.equal(git(current.root, ["rev-parse", "HEAD"]), start);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.match(readFileSync(planPath, "utf8"), /- \[ \] Update/);
  } finally {
    removeTree(current.root);
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

test("rejects pure and mixed Apply-Patch dialects before git apply", () => {
  const current = fixture();
  const gitPatch = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
  try {
    for (const patch of [
      `*** Begin Patch
*** Update File: src/value.mjs
*** End Patch
`,
      `${gitPatch}*** Update File: src/second.mjs
`,
      `${gitPatch}diff --git a/src/second.mjs b/src/second.mjs
*** End Patch
`,
    ]) {
      assert.throws(
        () => applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root }),
        (error) =>
          error.code === "CODEXLOOPER_PATCH_DIALECT_MIXED" &&
          /no Apply-Patch markers.*every file block needs diff --git.*rewrite the complete patch/u.test(error.message),
      );
    }
    assert.equal(readFileSync(join(current.root, "src", "value.mjs"), "utf8"), "export const value = 1;\n");
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("accepts a pure multi-file Git diff with literal marker-like source lines", () => {
  const current = fixture();
  const patch = `diff --git a/src/marker.txt b/src/marker.txt
--- a/src/marker.txt
+++ b/src/marker.txt
@@ -1,2 +1,2 @@
 *** context
-old
+*** value
diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
  try {
    const result = applyBuilderPatch({
      patch,
      phase: "task",
      sourceEnv: sourceEnv(current),
      projectRoot: current.root,
    });
    assert.equal(result.committed, true);
    assert.deepEqual(result.changed_paths, ["src/marker.txt", "src/value.mjs"]);
    assert.equal(readFileSync(join(current.root, "src", "marker.txt"), "utf8"), "*** context\n*** value\n");
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("runs allowlisted validation without resolving a Git binary from PATH", () => {
  const current = fixture({ validationCommands: ["git diff --check"] });
  const binDirectory = mkdtempSync(join(tmpdir(), "codexlooper-fake-git-"));
  const marker = join(binDirectory, "unexpected-shell-git");
  try {
    const fakeGit = join(binDirectory, "git");
    writeFileSync(fakeGit, `#!/bin/sh\nprintf '%s\\n' invoked > ${JSON.stringify(marker)}\n`);
    chmodSync(fakeGit, 0o700);
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
      sourceEnv: { ...sourceEnv(current), PATH: `${binDirectory}:${process.env.PATH}` },
      projectRoot: current.root,
    });
    assert.equal(result.committed, true);
    assert.equal(readFileSync(join(current.root, "src", "value.mjs"), "utf8"), "export const value = 2;\n");
    assert.throws(() => readFileSync(marker, "utf8"), { code: "ENOENT" });
  } finally {
    rmSync(current.root, { recursive: true, force: true });
    rmSync(binDirectory, { recursive: true, force: true });
  }
});
