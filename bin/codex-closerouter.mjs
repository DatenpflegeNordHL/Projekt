#!/usr/bin/env node

import { spawn } from "node:child_process";
import { prepareLaunch } from "../src/launcher.mjs";

function exitWithError(error) {
  const code = typeof error?.code === "string" ? error.code : "CODEXLOOPER_LAUNCH_FAILED";
  const message = error instanceof Error ? error.message : "Unknown launcher error";
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
}

let launch;
try {
  launch = prepareLaunch(process.argv.slice(2), process.env, process.cwd());
} catch (error) {
  exitWithError(error);
}

if (launch) {
  const child = spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    env: launch.env,
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  child.on("error", exitWithError);
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}
