import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve("bin/terra-as-claude.mjs");

test("Terra wrapper rejects a successful Codex stream with no agent message", () => {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-terra-protocol-"));
  const tools = join(project, "tools");
  mkdirSync(tools, { recursive: true });
  const codex = join(tools, "codex");
  writeFileSync(codex, "#!/bin/sh\necho '{\"type\":\"turn.completed\"}'\n", { mode: 0o700 });
  chmodSync(codex, 0o700);

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
        CODEX_HOME: join(project, ".codexlooper", "codex-home"),
        CODEXLOOPER_ALLOWED_MODELS: "openai/gpt-5.6-terra,openai/gpt-5.6-sol",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no translatable agent message/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
