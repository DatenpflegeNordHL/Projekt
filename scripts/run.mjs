#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProject } from "../src/run.mjs";
import { readRunBudget } from "../src/run-budget.mjs";
import { verifyRuntimeManifest } from "../src/runtime-integrity.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const WORKER_TOKEN_FLAG = "CODEXLOOPER_INTERNAL_RUN_WORKER_TOKEN";
const WORKER_PARENT_FLAG = "CODEXLOOPER_INTERNAL_RUN_WORKER_PARENT";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function redact(value) {
  let text = String(value || "");
  const secret = process.env.CLOSEROUTER_API_KEY;
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]")
    .slice(0, 1000);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail("CODEXLOOPER_PROCESS_BOUND_INVALID", `${label} must be a positive integer`);
  }
  return parsed;
}

function writeAtomic(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function persistFailedReceipt(result, error) {
  const secret = process.env.CLOSEROUTER_API_KEY;
  result.receipt.status = "failed";
  result.receipt.checks ||= {};
  result.receipt.checks.runtime_integrity = false;
  result.receipt.failure = {
    code: error.code || "CODEXLOOPER_FINAL_TRUST_FAILED",
    message: redact(error.message || error),
  };
  const serialized = `${JSON.stringify(result.receipt, null, 2)}\n`;
  if (secret && serialized.includes(secret)) {
    throw new Error("Final failed receipt contained the CloseRouter credential");
  }
  writeAtomic(result.receiptPath, serialized, 0o600);
}

function finalTrustCheck(result) {
  verifyRuntimeManifest({
    manifestPath: process.env.CODEXLOOPER_RUNTIME_MANIFEST,
    expectedManifestSha256: process.env.CODEXLOOPER_RUNTIME_MANIFEST_SHA256,
    expectedRuntimeDirectory: process.env.CODEXLOOPER_RUNTIME_DIR,
    expectedNodeExecutable: process.execPath,
  });
  const budgetPath = resolve(dirname(result.receiptPath), "budget.json");
  const state = readRunBudget({
    budgetPath,
    projectRoot: process.env.CODEXLOOPER_PROJECT || process.cwd(),
  });
  const usageCost = result.receipt.usage?.totals?.estimated_cost_usd;
  if (!Number.isFinite(usageCost) || usageCost < 0) {
    fail("CODEXLOOPER_FINAL_COST_INVALID", "Final usage cost is missing or invalid");
  }
  if (Math.abs(state.actual_estimated_cost_usd - usageCost) > 1e-9) {
    fail("CODEXLOOPER_FINAL_COST_MISMATCH", "Budget actual cost does not match recorded usage");
  }
  if (state.actual_estimated_cost_usd > state.limits.max_estimated_cost_usd) {
    fail("CODEXLOOPER_BUDGET_COST_EXCEEDED", "Actual estimated cost exceeds the configured run maximum");
  }
  if (
    state.attempts.builder > state.limits.max_builder_calls ||
    state.attempts.reviewer > state.limits.max_reviewer_calls
  ) {
    fail("CODEXLOOPER_BUDGET_CALLS_EXCEEDED", "Recorded model attempts exceed the configured run limits");
  }
  result.receipt.budgets.state = state;
  result.receipt.checks.runtime_integrity = true;
  return result;
}

async function runWorker() {
  try {
    const result = await runProject();
    if (result.receipt.status === "completed") {
      try {
        finalTrustCheck(result);
      } catch (error) {
        persistFailedReceipt(result, error);
      }
    }
    const cost = result.receipt.usage?.totals?.estimated_cost_usd ?? 0;
    if (result.receipt.status !== "completed") {
      process.stderr.write(
        `CODEXLOOPER_RUN=BLOCK: ${result.receipt.failure?.code || "CODEXLOOPER_RUN_FAILED"}: ${redact(result.receipt.failure?.message || "Run did not complete")}\n`,
      );
      process.stderr.write(`RECEIPT=${result.receiptPath}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("CODEXLOOPER_RUN=PASS\n");
      process.stdout.write(`RUN_ID=${result.receipt.run_id}\n`);
      process.stdout.write(`RECEIPT=${result.receiptPath}\n`);
      process.stdout.write(`ESTIMATED_COST_USD=${cost.toFixed(9)}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `CODEXLOOPER_RUN=BLOCK: ${error.code || "CODEXLOOPER_RUN_FAILED"}: ${redact(error.message)}\n`,
    );
    process.exitCode = 1;
  }
}

function signalProcessGroup(child, signal) {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    try {
      return child.kill(signal);
    } catch {
      return false;
    }
  }
}

export async function spawnSupervised(command, args, {
  cwd = process.cwd(),
  env = process.env,
  stdio = "inherit",
  timeoutMs,
  killGraceMs = 2_000,
  label = "Supervised process",
} = {}) {
  const timeout = positiveInteger(timeoutMs, "Process timeout");
  const grace = positiveInteger(killGraceMs, "Kill grace period");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio,
    detached: true,
  });
  let timedOut = false;
  let hardKillTimer = null;
  const signalHandlers = new Map();
  const forward = (signal) => signalProcessGroup(child, signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => forward(signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    forward("SIGTERM");
    hardKillTimer = setTimeout(() => forward("SIGKILL"), grace);
    hardKillTimer.unref?.();
  }, timeout);
  timeoutTimer.unref?.();
  try {
    return await new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        if (timedOut) {
          const error = new Error(`${label} exceeded its duration budget`);
          error.code = "CODEXLOOPER_BUDGET_DURATION_EXCEEDED";
          error.signal = signal;
          rejectExit(error);
          return;
        }
        if (signal) {
          const error = new Error(`${label} terminated by ${signal}`);
          error.code = "CODEXLOOPER_CHILD_SIGNALLED";
          rejectExit(error);
          return;
        }
        resolveExit(code ?? 1);
      });
    });
  } finally {
    clearTimeout(timeoutTimer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  }
}

function workerAuthorized() {
  const token = process.env[WORKER_TOKEN_FLAG];
  const expectedParent = process.env[WORKER_PARENT_FLAG];
  return (
    typeof token === "string" &&
    /^[0-9a-f]{48}$/.test(token) &&
    expectedParent === String(process.ppid)
  );
}

async function superviseWorker() {
  const timeoutMs = positiveInteger(
    process.env.CODEXLOOPER_MAX_RUN_DURATION_MS,
    "CODEXLOOPER_MAX_RUN_DURATION_MS",
  );
  const token = randomBytes(24).toString("hex");
  const env = {
    ...process.env,
    [WORKER_TOKEN_FLAG]: token,
    [WORKER_PARENT_FLAG]: String(process.pid),
  };
  const exitCode = await spawnSupervised(process.execPath, [THIS_FILE, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    timeoutMs,
    killGraceMs: 2_000,
    label: "CodexLooper run worker",
  });
  process.exitCode = exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  if (workerAuthorized()) {
    await runWorker();
  } else {
    try {
      await superviseWorker();
    } catch (error) {
      process.stderr.write(
        `CODEXLOOPER_RUN=BLOCK: ${error.code || "CODEXLOOPER_RUN_FAILED"}: ${redact(error.message)}\n`,
      );
      process.exitCode = 1;
    }
  }
}
