import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve("bin/terra-as-claude.mjs");

function git(project, args) {
  const result = spawnSync("/usr/bin/git", args, { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("Terra wrapper rejects a successful Codex stream with no agent message", () => {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-terra-protocol-"));
  const tools = join(project, "tools");
  const codexHome = join(project, ".codexlooper", "codex-home");
  mkdirSync(tools, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  const codex = join(tools, "codex");
  writeFileSync(codex, "#!/bin/sh\necho '{\"type\":\"turn.completed\"}'\n", { mode: 0o700 });
  chmodSync(codex, 0o700);
  writeFileSync(
    join(codexHome, "config.toml"),
    'model_provider = "closerouter"\n\n[model_providers.closerouter]\nbase_url = "https://api.closerouter.dev/v1"\nenv_key = "CLOSEROUTER_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\n',
    { mode: 0o600 },
  );
  writeFileSync(join(project, "README.md"), "fixture\n");
  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "CodexLooper Test"]);
  git(project, ["config", "user.email", "fixture@example.invalid"]);
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-m", "chore: initialize fixture"]);

  try {
    const result = spawnSync(process.execPath, [entrypoint, "--print"], {
      cwd: project,
      input: "bounded task prompt",
      encoding: "utf8",
      env: {
        HOME: project,
        PATH: process.env.PATH,
        CLOSEROUTER_API_KEY: "closerouter_test_secret",
        CODEXLOOPER_REAL_CODEX: codex,
        CODEX_HOME: codexHome,
        CODEXLOOPER_RUN_DIR: join(project, ".codexlooper", "runs", "protocol-test"),
        CODEXLOOPER_ALLOWED_MODELS: "openai/gpt-5.6-terra,openai/gpt-5.6-sol",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no structured agent message/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
