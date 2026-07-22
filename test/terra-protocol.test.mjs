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

function writeFakeCodex(path, agentText = null) {
  const lines = ['#!/usr/bin/env node'];
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

function fixture({ agentText = null } = {}) {
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
  writeFakeCodex(codex, agentText);

  writeFileSync(
    join(codexHome, "config.toml"),
    'model_provider = "closerouter"\n\n[model_providers.closerouter]\nbase_url = "https://api.closerouter.dev/v1"\nenv_key = "CLOSEROUTER_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\n',
    { mode: 0o600 },
  );
  writeFileSync(join(project, "README.md"), "fixture\n");
  writeFileSync(join(project, "src", "value.mjs"), "export const value = 1;\n");
  writeFileSync(planPath, "# Plan\n\n- [x] Complete\n");
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

function patchArtifacts(runDirectory) {
  return readdirSync(runDirectory)
    .filter((name) => /^builder-patch-\d+-\d+\.diff$/u.test(name))
    .sort();
}

test("Terra wrapper rejects a successful Codex stream with no agent message", () => {
  const current = fixture();
  try {
    const result = runAdapter(current);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no agent message/u);
    assert.deepEqual(patchArtifacts(current.runDirectory), []);
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("retains a private builder patch artifact when host policy rejects it", () => {
  const patch = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-fixture
+outside policy
`;
  const current = fixture({
    agentText: JSON.stringify({ version: 1, patch, signal: "" }),
  });

  try {
    const result = runAdapter(current);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the plan policy/u);

    const artifacts = patchArtifacts(current.runDirectory);
    assert.equal(artifacts.length, 1);

    const artifactPath = join(current.runDirectory, artifacts[0]);
    assert.equal(readFileSync(artifactPath, "utf8"), patch);
    assert.equal(statSync(artifactPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(current.project, "README.md"), "utf8"), "fixture\n");
    assert.equal(git(current.project, ["status", "--porcelain=v1"]), "");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("removes the builder patch artifact after a successful host commit", () => {
  const patch = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
  const current = fixture({
    agentText: JSON.stringify({ version: 1, patch, signal: "" }),
  });

  try {
    const result = runAdapter(current);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(patchArtifacts(current.runDirectory), []);
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
