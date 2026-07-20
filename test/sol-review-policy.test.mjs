import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const entrypoint = resolve("bin/sol-review.mjs");

test("Sol wrapper rejects arbitrary non-Ralphex files before model execution", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-sol-policy-"));
  const arbitrary = join(root, "private.txt");
  writeFileSync(arbitrary, "must not be sent\n", { mode: 0o600 });
  try {
    const result = spawnSync(process.execPath, [entrypoint, arbitrary], {
      encoding: "utf8",
      env: {},
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /accepts only Ralphex temporary prompt files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
