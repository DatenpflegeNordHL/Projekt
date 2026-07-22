import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../scripts/install.mjs";
import { removeTree } from "./helpers/remove-tree.mjs";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

test("installer pins the exact project as Codex workspace writable root", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper writable root "));
  const project = join(root, "project with spaces");
  const tools = join(root, "tools");
  mkdirSync(project, { recursive: true });
  mkdirSync(tools, { recursive: true });

  const codex = executable(
    join(tools, "codex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then echo 'codex-cli 0.144.6'; exit 0; fi\nexit 0\n",
  );
  const mex = executable(
    join(tools, "mex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then echo 'mex 0.6.3'; exit 0; fi\nif [ \"${1:-}\" = \"check\" ] && [ \"${2:-}\" = \"--json\" ]; then echo '{\"score\":100}'; exit 0; fi\nexit 0\n",
  );
  const ralphex = executable(
    join(tools, "ralphex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then echo 'ralphex 1.6.0'; exit 0; fi\nexit 0\n",
  );

  try {
    run("/usr/bin/git", ["init", "-b", "main"], project);
    writeFileSync(join(project, "AGENTS.md"), "# Agent\n");
    writeFileSync(join(project, "ROUTER.md"), "# Router\n");

    const result = install([
      "--project",
      project,
      "--real-codex",
      codex,
      "--mex-command",
      mex,
      "--ralphex-command",
      ralphex,
    ]);

    const config = readFileSync(join(project, ".codexlooper", "codex-home", "config.toml"), "utf8");
    assert.match(config, /\[sandbox_workspace_write\]/);
    assert.match(config, /writable_roots = \[/);
    assert.ok(config.includes(JSON.stringify(project)));

    const state = JSON.parse(
      readFileSync(join(project, ".codexlooper", "install-state.json"), "utf8"),
    );
    assert.equal(state.writable_root, project);
    assert.equal(state.runtime.id, result.runtimeId);
    assert.equal(state.budgets.max_builder_calls, 12);
    assert.ok(existsSync(state.runtime.manifest));
    assert.equal(result.runCommand, join(project, ".codexlooper", "bin", "codexlooper"));
  } finally {
    removeTree(root);
  }
});
