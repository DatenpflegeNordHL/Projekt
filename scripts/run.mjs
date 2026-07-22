#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnBoundedProcess } from "../src/bounded-process.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const WORKER = fileURLToPath(new URL("./run-worker.mjs", import.meta.url));

function timeoutFromEnvironment() {
  const parsed = Number(process.env.CODEXLOOPER_MAX_RUN_DURATION_MS);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    const error = new Error("CODEXLOOPER_MAX_RUN_DURATION_MS must be a positive integer");
    error.code = "CODEXLOOPER_PROCESS_BOUND_INVALID";
    throw error;
  }
  return parsed;
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  try {
    const exitCode = await spawnBoundedProcess(process.execPath, [WORKER, ...process.argv.slice(2)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      timeoutMs: timeoutFromEnvironment(),
      killGraceMs: 2_000,
      label: "CodexLooper run worker",
    });
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(
      `CODEXLOOPER_RUN=BLOCK: ${error.code || "CODEXLOOPER_RUN_FAILED"}: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
