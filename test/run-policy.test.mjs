import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRunPolicy,
  pathAllowed,
  validationInvocation,
} from "../src/run-policy.mjs";

const planPath = "docs/plans/feature.md";

function plan(
  allowed = "- `src/**`\n- `test/example.test.mjs`\n- `artifact.txt`\n- `this plan file`",
  commands = "- `node --check src/index.mjs`\n- `git diff --check`\n- `test -f artifact.txt`",
) {
  return `# Plan\n\n## Allowed paths\n\n${allowed}\n\n## Validation Commands\n\n${commands}\n\n### Task 1: Build\n\n- [ ] Implement\n`;
}

test("parses exact and prefix path rules plus allowlisted validation commands", () => {
  const policy = parseRunPolicy(planPath, plan());
  assert.equal(policy.schema, "codexlooper.run-policy.v1");
  assert.deepEqual(policy.validation_commands, [
    "node --check src/index.mjs",
    "git diff --check",
    "test -f artifact.txt",
  ]);
  assert.equal(pathAllowed("src/index.mjs", policy.allowed_paths), true);
  assert.equal(pathAllowed("src/nested/value.mjs", policy.allowed_paths), true);
  assert.equal(pathAllowed("test/example.test.mjs", policy.allowed_paths), true);
  assert.equal(pathAllowed(planPath, policy.allowed_paths), true);
  assert.equal(pathAllowed("package.json", policy.allowed_paths), false);

  assert.deepEqual(validationInvocation("git diff --check", policy.allowed_paths), {
    executable: "/usr/bin/git",
    args: ["diff", "--check"],
    display: "git diff --check",
  });
  assert.deepEqual(validationInvocation("test ! -e artifact.txt", policy.allowed_paths), {
    executable: "/usr/bin/test",
    args: ["!", "-e", "artifact.txt"],
    display: "test ! -e artifact.txt",
  });
});

test("rejects missing or unsafe plan path policy", () => {
  assert.throws(
    () => parseRunPolicy(planPath, "# Plan\n\n## Validation Commands\n- `git diff --check`\n"),
    (error) => error.code === "CODEXLOOPER_POLICY_MISSING",
  );
  assert.throws(
    () => parseRunPolicy(planPath, plan("- `../outside`")),
    (error) => error.code === "CODEXLOOPER_POLICY_PATH_INVALID",
  );
  assert.throws(
    () => parseRunPolicy(planPath, plan("- `src/*.mjs`")),
    (error) => error.code === "CODEXLOOPER_POLICY_PATH_INVALID",
  );
  assert.throws(
    () => parseRunPolicy(planPath, plan("- `.codexlooper/**`\n- `src/**`")),
    (error) => error.code === "CODEXLOOPER_POLICY_PATH_INVALID",
  );
});

test("rejects executable, destructive and shell validation commands", () => {
  for (const command of [
    "node --test",
    "npm test",
    "npm run check",
    "sh -c rm",
    "bash scripts/check.sh",
    "rm -rf .",
    "git reset --hard",
    "git checkout main",
    "git diff --check; rm -rf .",
    "git diff --check | cat",
    "git diff --check > result.txt",
    "node --check src/index.mjs && rm -rf .",
    "node src/index.mjs",
    "python3 -m pytest",
  ]) {
    assert.throws(
      () => parseRunPolicy(planPath, plan(undefined, `- \`${command}\``)),
      (error) => error.code === "CODEXLOOPER_POLICY_COMMAND_REJECTED",
      command,
    );
  }
});

test("validation commands may inspect only plan-approved repository paths", () => {
  for (const command of [
    "node --check package.json",
    "node --check ../outside.mjs",
    "test -f package.json",
    "test -f .git/config",
    "test ! -e ../outside",
  ]) {
    assert.throws(
      () => parseRunPolicy(planPath, plan(undefined, `- \`${command}\``)),
      (error) => error.code === "CODEXLOOPER_POLICY_COMMAND_REJECTED",
      command,
    );
  }
});

test("never allows runtime or Git metadata paths", () => {
  const policy = parseRunPolicy(planPath, plan("- `src/**`\n- `artifact.txt`"));
  assert.equal(pathAllowed(".git/config", policy.allowed_paths), false);
  assert.equal(pathAllowed(".codexlooper/runs/x", policy.allowed_paths), false);
  assert.equal(pathAllowed(".ralphex/config", policy.allowed_paths), false);
});
