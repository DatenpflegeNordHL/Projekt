import assert from "node:assert/strict";
import test from "node:test";
import { deriveSingleTaskPlan, parseRunInvocation } from "../src/run-hardened.mjs";

const plan = {
  relative: "docs/plans/example.md",
  content: `# Plan: Example

## Allowed paths
- \`result.txt\`
- \`this plan file\`

### Task 1: First task
Implement the first result.

- [ ] Task 1 complete.

### Task 2: Must not run
This task must remain unavailable to the selected-task runner.

- [ ] Task 2 complete.

## Validation requirements
- \`npm run check\`
`,
};

test("run invocation accepts the ordinary plan form and strict selected-task form", () => {
  assert.deepEqual(parseRunInvocation([plan.relative]), { planPath: plan.relative, taskNumber: null });
  assert.deepEqual(parseRunInvocation(["--task", "1", plan.relative]), { planPath: plan.relative, taskNumber: 1 });
});

test("run invocation rejects malformed selected-task forms", () => {
  for (const argv of [
    [],
    ["--task", plan.relative],
    ["--task", "0", plan.relative],
    ["--task", "01", plan.relative],
    ["--task", "1.5", plan.relative],
    ["--task", "one", plan.relative],
    ["--task", "1", plan.relative, "extra"],
    ["--other", "1", plan.relative],
  ]) {
    assert.throws(
      () => parseRunInvocation(argv),
      (error) => error?.code === "CODEXLOOPER_SINGLE_TASK_INVALID",
    );
  }
});

test("single-task plan keeps global contract and exactly one selected task", () => {
  const derived = deriveSingleTaskPlan(plan, 1);
  assert.match(derived.content, /## Allowed paths/);
  assert.match(derived.content, /## Validation requirements/);
  assert.match(derived.content, /## Single-task execution contract/);
  assert.match(derived.content, /private derived plan is execution-only input/i);
  assert.match(derived.content, /Never patch, modify, add, delete, or rename this derived file/i);
  assert.match(derived.content, /including `task-1\.md`/);
  assert.match(derived.content, /only permitted plan-file patch target is the canonical original plan: `docs\/plans\/example\.md`/i);
  assert.match(derived.content, /change exactly `- \[ \] Task 1 complete\.` to `- \[x\] Task 1 complete\.`/);
  assert.match(derived.content, /### Task 1: First task/);
  assert.doesNotMatch(derived.content, /### Task 2: Must not run/);
  assert.doesNotMatch(derived.content, /Task 2 complete/);
  assert.match(derived.original_plan_sha256, /^[a-f0-9]{64}$/);
  assert.match(derived.derived_plan_sha256, /^[a-f0-9]{64}$/);
  assert.match(derived.selected_task_completed_plan_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(derived.original_plan_sha256, derived.selected_task_completed_plan_sha256);
});

test("single-task plan fails closed for unknown and already-completed tasks", () => {
  assert.throws(
    () => deriveSingleTaskPlan(plan, 3),
    (error) => error?.code === "CODEXLOOPER_SINGLE_TASK_INVALID",
  );
  assert.throws(
    () => deriveSingleTaskPlan({
      ...plan,
      content: plan.content.replace("- [ ] Task 1 complete.", "- [x] Task 1 complete."),
    }, 1),
    (error) => error?.code === "CODEXLOOPER_SINGLE_TASK_ALREADY_COMPLETED",
  );
});
