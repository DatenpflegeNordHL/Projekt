import test from "node:test";
import assert from "node:assert/strict";
import { parseRunPolicy, pathAllowed } from "../src/run-policy.mjs";

const planPath = "docs/plans/feature.md";

function plan(allowed = "- `src/**`\n- `test/example.test.mjs`\n- `this plan file`") {
  return `# Plan\n\n## Allowed paths\n\n${allowed}\n\n## Validation Commands\n\n- \`node --check src/index.mjs\`\n- \`node --test\`\n\n### Task 1: Build\n\n- [ ] Implement\n`;
}

test("parses exact and prefix path rules plus trusted validation commands", () => {
  const policy = parseRunPolicy(planPath, plan());
  assert.equal(policy.schema, "codexlooper.run-policy.v1");
  assert.deepEqual(policy.validation_commands, ["node --check src/index.mjs", "node --test"]);
  assert.equal(pathAllowed("src/index.mjs", policy.allowed_paths), true);
  assert.equal(pathAllowed("src/nested/value.mjs", policy.allowed_paths), true);
  assert.equal(pathAllowed("test/example.test.mjs", policy.allowed_paths), true);
  assert.equal(pathAllowed(planPath, policy.allowed_paths), true);
  assert.equal(pathAllowed("package.json", policy.allowed_paths), false);
});

test("rejects missing or unsafe plan policy", () => {
  assert.throws(
    () => parseRunPolicy(planPath, "# Plan\n\n## Validation Commands\n- `node --test`\n"),
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

test("never allows runtime or Git metadata paths", () => {
  const policy = parseRunPolicy(planPath, plan("- `src/**`"));
  assert.equal(pathAllowed(".git/config", policy.allowed_paths), false);
  assert.equal(pathAllowed(".codexlooper/runs/x", policy.allowed_paths), false);
  assert.equal(pathAllowed(".ralphex/config", policy.allowed_paths), false);
});
