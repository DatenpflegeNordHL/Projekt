import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  applyBuilderOperations,
  applyBuilderPatch,
  superviseBuilderChanges,
} from "../src/git-supervisor.mjs";
import { removeTree } from "./helpers/remove-tree.mjs";

function git(root, args) {
  const result = spawnSync("/usr/bin/git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture({
  validationCommands = ["node --check src/value.mjs"],
  candidateCheck = "node --check src/value.mjs",
  allowPackageJson = false,
  singleTaskPlan = false,
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
  const planContent = singleTaskPlan
    ? `# Plan

## Allowed paths
- \`src/**\`
- \`this plan file\`

## Validation Commands
- \`node --check src/value.mjs\`

### Task 1: Change
- [ ] Task 1 complete.

### Task 2: Must not run
- [ ] Task 2 complete.
`
    : `# Plan

## Allowed paths
- \`src/**\`
${allowPackageJson ? "- `package.json`\n" : ""}- \`this plan file\`

## Validation Commands
- \`node --check src/value.mjs\`

### Task 1: Change
- [ ] Update value
`;
  writeFileSync(
    join(root, "docs", "plans", "feature.md"),
    planContent,
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
        ...(allowPackageJson ? [{ type: "exact", value: "package.json" }] : []),
        { type: "exact", value: "docs/plans/feature.md" },
      ],
      validation_commands: validationCommands,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { root, policyPath, runDirectory };
}

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function configureSingleTaskPolicy(current) {
  const planPath = join(current.root, "docs", "plans", "feature.md");
  const original = readFileSync(planPath, "utf8");
  const completed = original.replace("- [ ] Task 1 complete.", "- [x] Task 1 complete.");
  const policy = JSON.parse(readFileSync(current.policyPath, "utf8"));
  Object.assign(policy, {
    single_task: true,
    selected_task: 1,
    original_plan: policy.plan,
    original_plan_sha256: sha256(original),
    derived_plan_sha256: "a".repeat(64),
    selected_task_completed_plan_sha256: sha256(completed),
  });
  writeFileSync(current.policyPath, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
  return { planPath, original, completed };
}

function sourceEnv(current) {
  return {
    ...process.env,
    CODEXLOOPER_RUN_ID: "run-1",
    CODEXLOOPER_RUN_POLICY: current.policyPath,
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

test("rejects a derived task-1.md candidate before applying it", () => {
  const current = fixture({ singleTaskPlan: true });
  try {
    configureSingleTaskPolicy(current);
    const patch = [
      "diff --git a/task-1.md b/task-1.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/task-1.md",
      "@@ -0,0 +1 @@",
      "+must never be patched",
      "",
    ].join("\n");
    assert.throws(
      () => applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root }),
      (error) => error.code === "CODEXLOOPER_PATH_POLICY_VIOLATION",
    );
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "1");
  } finally {
    removeTree(current.root);
  }
});

test("single-task accepts only the canonical Task 1 checkbox state bound by policy", () => {
  const current = fixture({ singleTaskPlan: true });
  try {
    const { planPath, completed } = configureSingleTaskPolicy(current);
    const patch = generatedPatch(current.root, [
      { path: "src/value.mjs", content: "export const value = 2;\n" },
      { path: "docs/plans/feature.md", content: completed },
    ]);
    const result = applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root });
    assert.equal(result.committed, true);
    assert.equal(readFileSync(planPath, "utf8"), completed);
    assert.match(readFileSync(planPath, "utf8"), /- \[x\] Task 1 complete\./);
    assert.match(readFileSync(planPath, "utf8"), /- \[ \] Task 2 complete\./);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
  } finally {
    removeTree(current.root);
  }
});

test("single-task rejects a canonical plan patch that differs from the bound completed hash", () => {
  const current = fixture({ singleTaskPlan: true });
  try {
    const { planPath, original } = configureSingleTaskPolicy(current);
    const wrongCompletion = original.replace("- [ ] Task 2 complete.", "- [x] Task 2 complete.");
    const patch = generatedPatch(current.root, [
      { path: "src/value.mjs", content: "export const value = 2;\n" },
      { path: "docs/plans/feature.md", content: wrongCompletion },
    ]);
    assert.throws(
      () => applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root }),
      (error) => error.code === "CODEXLOOPER_SINGLE_TASK_PLAN_MUTATION",
    );
    assert.equal(readFileSync(planPath, "utf8"), original);
    assert.match(readFileSync(planPath, "utf8"), /- \[ \] Task 2 complete\./);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "1");
  } finally {
    removeTree(current.root);
  }
});

test("materializes Builder Envelope v2 only in a candidate and commits its host-generated diff", () => {
  const current = fixture({ singleTaskPlan: true });
  try {
    const { planPath, original: originalPlan, completed } = configureSingleTaskPolicy(current);
    const originalValue = readFileSync(join(current.root, "src", "value.mjs"), "utf8");
    const result = applyBuilderOperations({
      envelope: {
        version: 2,
        operations: [
          {
            type: "create_file",
            path: "src/new-value.mjs",
            content: "export const newValue = true;\n",
            expected_absent: true,
          },
          {
            type: "replace_exact",
            path: "src/value.mjs",
            expected_file_sha256: sha256(originalValue),
            old_text: "value = 1",
            new_text: "value = 2",
            expected_occurrences: 1,
          },
          {
            type: "replace_exact",
            path: "docs/plans/feature.md",
            expected_file_sha256: sha256(originalPlan),
            old_text: "- [ ] Task 1 complete.",
            new_text: "- [x] Task 1 complete.",
            expected_occurrences: 1,
          },
        ],
      },
      phase: "task",
      sourceEnv: sourceEnv(current),
      projectRoot: current.root,
    });
    assert.equal(result.committed, true);
    assert.match(result.canonical_diff, /^diff --git a\/docs\/plans\/feature\.md b\/docs\/plans\/feature\.md/m);
    assert.match(result.canonical_diff, /^diff --git a\/src\/new-value\.mjs b\/src\/new-value\.mjs/m);
    assert.doesNotMatch(result.canonical_diff, /--recount/u);
    assert.deepEqual(result.changed_paths, [
      "docs/plans/feature.md",
      "src/new-value.mjs",
      "src/value.mjs",
    ]);
    assert.equal(readFileSync(join(current.root, "src", "value.mjs"), "utf8"), "export const value = 2;\n");
    assert.equal(readFileSync(join(current.root, "src", "new-value.mjs"), "utf8"), "export const newValue = true;\n");
    assert.equal(readFileSync(planPath, "utf8"), completed);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    const event = readFileSync(resolve(current.runDirectory, "host-commits.jsonl"), "utf8");
    assert.match(event, /"transport":"builder_envelope_v2_host_generated_diff"/u);
    assert.match(event, /"tree_identity_match":true/u);
  } finally {
    removeTree(current.root);
  }
});

test("rejects unauthorized or invalid Builder Envelope v2 operations without changing the host", () => {
  const current = fixture();
  try {
    const start = git(current.root, ["rev-parse", "HEAD"]);
    assert.throws(
      () =>
        applyBuilderOperations({
          envelope: {
            version: 2,
            operations: [{
              type: "create_file",
              path: "README.md",
              content: "outside policy\n",
              expected_absent: true,
            }],
          },
          phase: "task",
          sourceEnv: sourceEnv(current),
          projectRoot: current.root,
        }),
      (error) => error.code === "CODEXLOOPER_PATH_POLICY_VIOLATION",
    );
    const original = readFileSync(join(current.root, "src", "value.mjs"), "utf8");
    assert.throws(
      () =>
        applyBuilderOperations({
          envelope: {
            version: 2,
            operations: [{
              type: "replace_exact",
              path: "src/value.mjs",
              expected_file_sha256: sha256(original),
              old_text: "value = 1",
              new_text: "value = ;",
              expected_occurrences: 1,
            }],
          },
          phase: "task",
          sourceEnv: sourceEnv(current),
          projectRoot: current.root,
        }),
      (error) => error.code === "CODEXLOOPER_HOST_COMMAND_FAILED",
    );
    assert.equal(git(current.root, ["rev-parse", "HEAD"]), start);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(readFileSync(join(current.root, "src", "value.mjs"), "utf8"), original);
  } finally {
    removeTree(current.root);
  }
});

test("Builder Envelope v2 remains bound to the canonical single-task plan checkbox", () => {
  const current = fixture({ singleTaskPlan: true });
  try {
    const { original } = configureSingleTaskPolicy(current);
    assert.throws(
      () =>
        applyBuilderOperations({
          envelope: {
            version: 2,
            operations: [{
              type: "replace_exact",
              path: "docs/plans/feature.md",
              expected_file_sha256: sha256(original),
              old_text: "- [ ] Task 2 complete.",
              new_text: "- [x] Task 2 complete.",
              expected_occurrences: 1,
            }],
          },
          phase: "task",
          sourceEnv: sourceEnv(current),
          projectRoot: current.root,
        }),
      (error) => error.code === "CODEXLOOPER_SINGLE_TASK_PLAN_MUTATION",
    );
    assert.equal(readFileSync(join(current.root, "docs", "plans", "feature.md"), "utf8"), original);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
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

test("validates a completion patch in an isolated candidate using only plan commands", () => {
  const current = fixture({ candidateCheck: "node -e \"throw new Error('npm must not run')\"" });
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
    const result = applyBuilderPatch({
      patch,
      phase: "task",
      sourceEnv: sourceEnv(current),
      projectRoot: current.root,
    });
    assert.equal(result.committed, true);
    assert.equal(result.completion_gates.mode, "isolated_candidate_repository");
    assert.equal(result.completion_gates.cleanup, "PASS");
    assert.equal(result.completion_gates.tree_identity_match, true);
    assert.equal(result.completion_gates.candidate_tree, result.completion_gates.final_tree);
    assert.deepEqual(result.completion_gates.validation.map((entry) => entry.command), ["node --check src/value.mjs"]);
    assert.ok(result.completion_gates.checks.every((entry) => entry.command !== "npm run check"));
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "2");
    const event = readFileSync(resolve(current.runDirectory, "host-commits.jsonl"), "utf8");
    assert.match(event, /"mode":"isolated_candidate_repository"/);
    assert.match(event, /"tree_identity_match":true/);
    assert.match(event, /"cleanup":"PASS"/);
    assert.doesNotMatch(event, /npm run check|runtime-integrity verification/);
  } finally {
    removeTree(current.root);
  }
});

test("preserves an actual plan-validation failure and leaves the host untouched", () => {
  const current = fixture();
  try {
    const planPath = join(current.root, "docs", "plans", "feature.md");
    const patch = generatedPatch(current.root, [
      {
        path: "src/value.mjs",
        content: "export const value = ;\n",
      },
      {
        path: "docs/plans/feature.md",
        content: readFileSync(planPath, "utf8").replace("- [ ] Update", "- [x] Update"),
      },
    ]);
    const start = git(current.root, ["rev-parse", "HEAD"]);
    assert.throws(
      () => applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root }),
      (error) => error.code === "CODEXLOOPER_HOST_COMMAND_FAILED" && /Validation command/.test(error.message),
    );
    assert.equal(git(current.root, ["rev-parse", "HEAD"]), start);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.match(readFileSync(planPath, "utf8"), /- \[ \] Update/);
  } finally {
    removeTree(current.root);
  }
});

test("rejects a package manifest change unless the plan policy allows it", () => {
  const current = fixture();
  try {
    const planPath = join(current.root, "docs", "plans", "feature.md");
    const patch = generatedPatch(current.root, [
      {
        path: "package.json",
        content: `${JSON.stringify({ private: true, description: "outside policy", scripts: { check: "node --check src/value.mjs" } })}\n`,
      },
      {
        path: "docs/plans/feature.md",
        content: readFileSync(planPath, "utf8").replace("- [ ] Update", "- [x] Update"),
      },
    ]);
    assert.throws(
      () => applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root }),
      (error) => error.code === "CODEXLOOPER_PATH_POLICY_VIOLATION",
    );
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.match(readFileSync(join(current.root, "package.json"), "utf8"), /node --check src\/value\.mjs/);
  } finally {
    removeTree(current.root);
  }
});

test("accepts a package manifest change when the plan policy explicitly allows it", () => {
  const current = fixture({
    allowPackageJson: true,
    candidateCheck: "node -e \"throw new Error('npm must not run')\"",
  });
  try {
    const planPath = join(current.root, "docs", "plans", "feature.md");
    const patch = generatedPatch(current.root, [
      {
        path: "src/value.mjs",
        content: "export const value = 2;\n",
      },
      {
        path: "package.json",
        content: `${JSON.stringify({ private: true, description: "explicitly allowed", scripts: { check: "node -e \"throw new Error('npm must not run')\"" } })}\n`,
      },
      {
        path: "docs/plans/feature.md",
        content: readFileSync(planPath, "utf8").replace("- [ ] Update", "- [x] Update"),
      },
    ]);
    const result = applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root });
    assert.equal(result.committed, true);
    assert.deepEqual(result.changed_paths, ["docs/plans/feature.md", "package.json", "src/value.mjs"]);
    assert.match(readFileSync(join(current.root, "package.json"), "utf8"), /explicitly allowed/);
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
  } finally {
    removeTree(current.root);
  }
});

test("rejects a truncated unified diff before completion-candidate validation", () => {
  const current = fixture();
  try {
    const patch = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1,2 +1,2 @@
-export const value = 1;
+export const value = 2;
diff --git a/docs/plans/feature.md b/docs/plans/feature.md
--- a/docs/plans/feature.md
+++ b/docs/plans/feature.md
@@ -10 +10 @@
-- [ ] Update value
+- [x] Update value
`;
    const gitCheck = spawnSync(
      "/usr/bin/git",
      ["apply", "--check", "--recount", "--whitespace=error-all", "-"],
      { cwd: current.root, encoding: "utf8", input: patch },
    );
    assert.equal(gitCheck.status, 0, gitCheck.stderr || gitCheck.stdout);
    assert.throws(
      () => applyBuilderPatch({ patch, phase: "task", sourceEnv: sourceEnv(current), projectRoot: current.root }),
      (error) => error.code === "CODEXLOOPER_PATCH_UNIFIED_DIFF_INVALID" && /truncated/.test(error.message),
    );
    assert.equal(git(current.root, ["rev-list", "--count", "HEAD"]), "1");
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
    assert.throws(() => readFileSync(join(current.runDirectory, "host-commits.jsonl"), "utf8"), { code: "ENOENT" });
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

test("accepts a complete new-file unified diff with standard mode metadata", () => {
  const current = fixture();
  try {
    const patch = `diff --git a/src/new-value.mjs b/src/new-value.mjs
new file mode 100644
--- /dev/null
+++ b/src/new-value.mjs
@@ -0,0 +1 @@
+export const newValue = 1;
`;
    const result = applyBuilderPatch({
      patch,
      phase: "task",
      sourceEnv: sourceEnv(current),
      projectRoot: current.root,
    });
    assert.equal(result.committed, true);
    assert.equal(readFileSync(join(current.root, "src", "new-value.mjs"), "utf8"), "export const newValue = 1;\n");
    assert.equal(git(current.root, ["status", "--porcelain=v1"]), "");
  } finally {
    removeTree(current.root);
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
