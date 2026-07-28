import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  existsSync,
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

async function waitForReady(path, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error("Stubborn child did not publish readiness before the bounded deadline");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("hard-kills a process group that ignores SIGTERM after duration expiry", async () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-process-bound-"));
  const script = join(root, "stubborn.mjs");
  const pidPath = join(root, "pid.txt");
  writeFileSync(
    script,
    `import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`)}], { stdio: "ignore" });
child.unref();
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`,
  );
  const started = Date.now();
  try {
    const supervised = spawnSupervised(process.execPath, [script], {
      cwd: root,
      env: process.env,
      stdio: "ignore",
      timeoutMs: 500,
      killGraceMs: 50,
      label: "Stubborn fixture",
    });
    await waitForReady(pidPath);
    const pid = Number(readFileSync(pidPath, "utf8"));
    assert.equal(Number.isSafeInteger(pid), true);
    await assert.rejects(
      () => supervised,
      (error) => error.code === "CODEXLOOPER_BUDGET_DURATION_EXCEEDED",
    );
    assert.ok(Date.now() - started < 2_000);
    assert.equal(processExists(pid), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
