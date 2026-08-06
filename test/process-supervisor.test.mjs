import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
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

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    if (!child.stdout) {
      reject(new Error("Stubborn fixture did not expose a readiness stream"));
      return;
    }
    let output = "";
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Stubborn fixture exited before readiness (code=${code}, signal=${signal})`));
    };
    const onData = (chunk) => {
      output += chunk;
      const newline = output.indexOf("\n");
      if (newline === -1) return;
      cleanup();
      resolve(Number(output.slice(0, newline)));
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

test("hard-kills a process group that ignores SIGTERM after duration expiry", async () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-process-bound-"));
  const script = join(root, "stubborn.mjs");
  writeFileSync(
    script,
    `import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);')}], { stdio: "ignore" });
child.unref();
process.stdout.write(String(child.pid) + "\\n");
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`,
  );
  try {
    let durationStartedAt = 0;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const supervised = spawnSupervised(process.execPath, [script], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
      timeoutMs: 500,
      killGraceMs: 50,
      label: "Stubborn fixture",
      startBarrier: async (child) => {
        try {
          const pid = await waitForReady(child);
          durationStartedAt = Date.now();
          resolveReady(pid);
        } catch (error) {
          rejectReady(error);
          throw error;
        }
      },
    });
    const observed = supervised.then(
      () => new Error("Stubborn fixture completed without exceeding its duration budget"),
      (error) => error,
    );
    const pid = await ready;
    assert.equal(Number.isSafeInteger(pid), true);
    const error = await observed;
    assert.equal(error.code, "CODEXLOOPER_BUDGET_DURATION_EXCEEDED");
    assert.ok(Date.now() - durationStartedAt < 2_000);
    assert.equal(processExists(pid), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
