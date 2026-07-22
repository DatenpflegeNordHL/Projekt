import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSupervised } from "../scripts/run.mjs";

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

test("hard-kills a process group that ignores SIGTERM after duration expiry", async () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-process-bound-"));
  const script = join(root, "stubborn.mjs");
  const pidPath = join(root, "pid.txt");
  writeFileSync(
    script,
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`,
  );
  const started = Date.now();
  try {
    await assert.rejects(
      () =>
        spawnSupervised(process.execPath, [script], {
          cwd: root,
          env: process.env,
          stdio: "ignore",
          timeoutMs: 50,
          killGraceMs: 50,
          label: "Stubborn fixture",
        }),
      (error) => error.code === "CODEXLOOPER_BUDGET_DURATION_EXCEEDED",
    );
    assert.ok(Date.now() - started < 2_000);
    const pid = Number(readFileSync(pidPath, "utf8"));
    assert.equal(Number.isSafeInteger(pid), true);
    assert.equal(processExists(pid), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
