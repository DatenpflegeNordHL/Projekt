import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
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

function executable(path, version) {
  writeFileSync(
    path,
    `#!/bin/sh\nif [ "\${1:-}" = "--version" ]; then echo '${version}'; exit 0; fi\nexit 0\n`,
    { mode: 0o700 },
  );
  chmodSync(path, 0o700);
  return path;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-install-path-"));
  const project = join(root, "project");
  const tools = join(root, "tools");
  const outside = join(root, "outside");
  mkdirSync(project);
  mkdirSync(tools);
  mkdirSync(outside);
  run("/usr/bin/git", ["init", "-b", "main"], project);
  const codex = executable(join(tools, "codex"), "codex-cli 0.144.6");
  const mex = executable(join(tools, "mex"), "mex 0.6.3");
  const ralphex = executable(join(tools, "ralphex"), "ralphex 1.6.0");
  return { root, project, outside, codex, mex, ralphex };
}

function installFixture(current) {
  return install([
    "--project",
    current.project,
    "--real-codex",
    current.codex,
    "--mex-command",
    current.mex,
    "--ralphex-command",
    current.ralphex,
  ]);
}

test("rejects a symlinked .codexlooper installation root", () => {
  const current = fixture();
  try {
    symlinkSync(current.outside, join(current.project, ".codexlooper"));
    assert.throws(
      () => installFixture(current),
      /Unsafe runtime path segment/,
    );
  } finally {
    removeTree(current.root);
  }
});

test("rejects a symlinked .ralphex configuration root", () => {
  const current = fixture();
  try {
    symlinkSync(current.outside, join(current.project, ".ralphex"));
    assert.throws(
      () => installFixture(current),
      /Unsafe runtime path segment/,
    );
  } finally {
    removeTree(current.root);
  }
});
