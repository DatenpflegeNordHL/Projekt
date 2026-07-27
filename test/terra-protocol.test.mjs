import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve("bin/terra-as-claude.mjs");

function git(project, args) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: project,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function writeFakeCodex(
  path,
  agentText = null,
  requiredPromptFragments = [],
  forbiddenPromptFragments = [],
) {
  const lines = [
    '#!/usr/bin/env node',
    'import { readFileSync } from "node:fs";',
    'const prompt = readFileSync(0, "utf8");',
  ];
  for (const fragment of requiredPromptFragments) {
    lines.push(
      `if (!prompt.includes(${JSON.stringify(fragment)})) process.exit(41);`,
    );
  }
  for (const fragment of forbiddenPromptFragments) {
    lines.push(
      `if (prompt.includes(${JSON.stringify(fragment)})) process.exit(42);`,
    );
  }
  if (agentText !== null) {
    const event = {
      type: "item.completed",
      item: { type: "agent_message", text: agentText },
    };
    lines.push(`process.stdout.write(${JSON.stringify(`${JSON.stringify(event)}\n`)});`);
  }
  lines.push(`process.stdout.write(${JSON.stringify('{"type":"turn.completed"}\n')});`);
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o700 });
  chmodSync(path, 0o700);
}

function fixture({
  agentText = null,
  requiredPromptFragments = [],
  forbiddenPromptFragments = [],
  planContent = "# Plan\n\n- [x] Complete\n",
} = {}) {
  const project = realpathSync(
    mkdtempSync(join(tmpdir(), "codexlooper-terra-protocol-")),
  );
  const tools = join(project, "tools");
  const codexHome = join(project, ".codexlooper", "codex-home");
  const runDirectory = join(project, ".codexlooper", "runs", "protocol-test");
  const policyPath = join(runDirectory, "policy.json");
  const planPath = join(project, "docs", "plans", "feature.md");

  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "CodexLooper Test"]);
  git(project, ["config", "user.email", "fixture@example.invalid"]);
  mkdirSync(join(project, ".git", "info"), { recursive: true });
  writeFileSync(
    join(project, ".git", "info", "exclude"),
    ".codexlooper/\n.ralphex/\ntools/\n",
  );

  mkdirSync(tools, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(runDirectory, { recursive: true });
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, "docs", "plans"), { recursive: true });

  const codex = join(tools, "codex");
  writeFakeCodex(codex, agentText, requiredPromptFragments, forbiddenPromptFragments);

  writeFileSync(
    join(codexHome, "config.toml"),
    'model_provider = "closerouter"\n\n[model_providers.closerouter]\nbase_url = "https://api.closerouter.dev/v1"\nenv_key = "CLOSEROUTER_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\n',
    { mode: 0o600 },
  );
  writeFileSync(join(project, "README.md"), "fixture\n");
  writeFileSync(join(project, "src", "value.mjs"), "export const value = 1;\n");
  writeFileSync(planPath, planContent);
  writeFileSync(
    policyPath,
    `${JSON.stringify(
      {
        schema: "codexlooper.run-policy.v1",
        plan: "docs/plans/feature.md",
        allowed_paths: [
          { type: "prefix", value: "src/" },
          { type: "exact", value: "docs/plans/feature.md" },
        ],
        validation_commands: ["node --check src/value.mjs"],
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  git(project, ["add", "README.md", "src/value.mjs", "docs/plans/feature.md"]);
  git(project, ["commit", "-m", "chore: initialize fixture"]);

  return {
    project,
    codex,
    codexHome,
    runDirectory,
    policyPath,
  };
}

function runAdapter(current) {
  return spawnSync(process.execPath, [entrypoint, "--print"], {
    cwd: current.project,
    input: "bounded task prompt",
    encoding: "utf8",
    env: {
      HOME: current.project,
      PATH: process.env.PATH,
      CLOSEROUTER_API_KEY: "closerouter_test_secret",
      CODEXLOOPER_REAL_CODEX: current.codex,
      CODEX_HOME: current.codexHome,
      CODEXLOOPER_PROJECT: current.project,
      CODEXLOOPER_RUN_ID: "protocol-test",
      CODEXLOOPER_RUN_DIR: current.runDirectory,
      CODEXLOOPER_RUN_POLICY: current.policyPath,
      CODEXLOOPER_ALLOWED_MODELS:
        "openai/gpt-5.6-terra,openai/gpt-5.6-sol",
    },
  });
}

function payloadArtifacts(runDirectory) {
  return readdirSync(runDirectory)
    .filter((name) => /^builder-envelope-\d+-\d+\.json$/u.test(name))
    .sort();
}

function rejectedResponseArtifacts(runDirectory) {
  return readdirSync(runDirectory)
    .filter((name) => /^builder-rejected-response-\d+-\d+\.json$/u.test(name))
    .sort();
}

function replaceValueEnvelope({ path = "src/value.mjs", oldText = "value = 1", newText = "value = 2" } = {}) {
  const original = "export const value = 1;\n";
  return JSON.stringify({
    version: 2,
    operations: [{
      type: "replace_exact",
      path,
      expected_file_sha256: createHash("sha256").update(original, "utf8").digest("hex"),
      old_text: oldText,
      new_text: newText,
      expected_occurrences: 1,
    }],
  });
}

function completingEnvelope(planContent) {
  return JSON.stringify({
    version: 2,
    operations: [
      {
        type: "replace_exact",
        path: "src/value.mjs",
        expected_file_sha256: createHash("sha256").update("export const value = 1;\n", "utf8").digest("hex"),
        old_text: "value = 1",
        new_text: "value = 2",
        expected_occurrences: 1,
      },
      {
        type: "replace_exact",
        path: "docs/plans/feature.md",
        expected_file_sha256: createHash("sha256").update(planContent, "utf8").digest("hex"),
        old_text: "- [ ] Complete",
        new_text: "- [x] Complete",
        expected_occurrences: 1,
      },
    ],
  });
}

test("Terra wrapper rejects a successful Codex stream with no agent message", () => {
  const current = fixture();
  try {
    const result = runAdapter(current);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no agent message/u);
    assert.deepEqual(payloadArtifacts(current.runDirectory), []);
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("retains a private Builder Envelope v2 artifact when host policy rejects it", () => {
  const payload = JSON.stringify({
    version: 2,
    operations: [{
      type: "create_file",
      path: "README.md",
      content: "outside policy\n",
      expected_absent: true,
    }],
  });
  const current = fixture({
    agentText: payload,
    requiredPromptFragments: [
      "The read-only filesystem is intentional",
      "Do not run tests or validation commands inside the model sandbox",
      "Builder Envelope v2",
      "Do not author a Git diff",
      "The trusted host alone derives continuation and completion",
    ],
  });

  try {
    const result = runAdapter(current);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the plan policy/u);

    const artifacts = payloadArtifacts(current.runDirectory);
    assert.equal(artifacts.length, 1);

    const artifactPath = join(current.runDirectory, artifacts[0]);
    assert.equal(readFileSync(artifactPath, "utf8"), payload);
    assert.equal(statSync(artifactPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(current.project, "README.md"), "utf8"), "fixture\n");
    assert.equal(git(current.project, ["status", "--porcelain=v1"]), "");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("retains bounded, redacted private diagnostics for malformed Builder responses", () => {
  const patch = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
  const malformedResponses = [
    "{\"version\":2,\"operations\":[}",
    "I cannot safely construct an envelope.",
    "```json\n{\"version\":2,\"operations\":[]}\n```",
    "{\"version\":2,\"operations\":[]} trailing",
    patch,
    "{\"version\":2,\"version\":2,\"operations\":[]}",
    `prose closerouter_test_secret Authorization: Bearer exposed ${"x".repeat(70_000)}`,
  ];
  for (const response of malformedResponses) {
    const current = fixture({ agentText: response });
    try {
      const result = runAdapter(current);
      assert.notEqual(result.status, 0);
      assert.deepEqual(payloadArtifacts(current.runDirectory), []);
      const artifacts = rejectedResponseArtifacts(current.runDirectory);
      assert.equal(artifacts.length, 1);
      const artifactPath = join(current.runDirectory, artifacts[0]);
      const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
      assert.equal(artifact.schema, "codexlooper.builder-rejected-response.v1");
      assert.equal(artifact.phase, "task");
      assert.equal(statSync(artifactPath).mode & 0o777, 0o600);
      assert.ok(Buffer.byteLength(artifact.response, "utf8") <= 65_536);
      assert.equal(readFileSync(artifactPath, "utf8").includes("closerouter_test_secret"), false);
      assert.equal(readFileSync(join(current.project, "src", "value.mjs"), "utf8"), "export const value = 1;\n");
      assert.equal(git(current.project, ["status", "--porcelain=v1"]), "");
    } finally {
      rmSync(current.project, { recursive: true, force: true });
    }
  }
});

test("Terra prompt requires a strict Builder Envelope v2 response without a snapshot patch check", () => {
  const current = fixture({
    agentText: replaceValueEnvelope(),
    requiredPromptFragments: [
      "A response containing changes must be exactly one plain Builder Envelope v2 JSON object",
      "That object is {\"version\":2,\"operations\":[...]}",
      "Do not author a Git diff, hunk headers, Apply-Patch markers, or any patch text",
      "Do not run git apply, including git apply --check",
      "Never edit, create, delete, rename, copy, or chmod files",
      "Do not run tests or validation commands inside the model sandbox",
    ],
    forbiddenPromptFragments: [
      "Use ALL_TASKS_DONE",
      "Use REVIEW_DONE",
      "Use TASK_FAILED",
      "empty signal",
    ],
  });
  try {
    const result = runAdapter(current);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(payloadArtifacts(current.runDirectory), []);
    assert.equal(readFileSync(join(current.project, "src", "value.mjs"), "utf8"), "export const value = 2;\n");
    assert.equal(git(current.project, ["status", "--porcelain=v1"]), "");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("removes the builder patch artifact after a successful host commit", () => {
  const current = fixture({
    agentText: replaceValueEnvelope(),
    requiredPromptFragments: [
      "The read-only filesystem is intentional",
      "Do not run tests or validation commands inside the model sandbox",
      "Builder Envelope v2",
      "The trusted host alone derives continuation and completion",
    ],
  });

  try {
    const result = runAdapter(current);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(payloadArtifacts(current.runDirectory), []);
    assert.equal(
      readFileSync(join(current.project, "src", "value.mjs"), "utf8"),
      "export const value = 2;\n",
    );
    assert.equal(git(current.project, ["status", "--porcelain=v1"]), "");
    assert.equal(git(current.project, ["rev-list", "--count", "HEAD"]), "2");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("host keeps a valid partial task envelope non-final while work remains", () => {
  const current = fixture({
    agentText: replaceValueEnvelope(),
    planContent: "# Plan\n\n- [ ] Complete\n",
  });
  try {
    const result = runAdapter(current);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stdout, /<<<RALPHEX:ALL_TASKS_DONE>>>/u);
    assert.equal(readFileSync(join(current.project, "src", "value.mjs"), "utf8"), "export const value = 2;\n");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("host alone derives completion after a validated final envelope", () => {
  const planContent = "# Plan\n\n- [ ] Complete\n";
  const current = fixture({
    agentText: completingEnvelope(planContent),
    planContent,
  });
  try {
    const result = runAdapter(current);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /<<<RALPHEX:ALL_TASKS_DONE>>>/u);
    assert.equal(readFileSync(join(current.project, "docs", "plans", "feature.md"), "utf8"), "# Plan\n\n- [x] Complete\n");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});
