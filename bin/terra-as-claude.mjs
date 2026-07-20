#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { prepareProfileLaunch } from "../src/profiles.mjs";
import { translateCodexEvent } from "../src/claude-stream.mjs";

function fail(message) {
  throw new Error(message);
}

function validateArgs(args) {
  let printSeen = false;
  for (const arg of args) {
    if (arg === "--print" && !printSeen) {
      printSeen = true;
      continue;
    }
    fail(`Ralphex executor argument is not allowed: ${arg}`);
  }
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

try {
  validateArgs(process.argv.slice(2));
  let prompt = readFileSync(0, "utf8");
  if (!prompt.trim()) fail("Ralphex supplied an empty prompt");

  const internalReview = prompt.includes("<<<RALPHEX:REVIEW_DONE>>>");
  if (internalReview) {
    prompt = `Ralphex review adapter for Codex:\n- Interpret review Task-tool instructions using Codex collaboration tools.\n- Launch requested review agents in parallel.\n- Wait for all agents before collecting findings and applying fixes.\n- Preserve every <<<RALPHEX:...>>> signal exactly.\n\n${prompt}`;
  }

  const launch = prepareProfileLaunch("builder", {
    json: true,
    multiAgent: internalReview,
    sandbox: "workspace-write",
  });

  const child = spawn(launch.command, launch.args, {
    cwd: process.cwd(),
    env: launch.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }

  child.stdin.end(prompt);
  let resultEmitted = false;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const event = translateCodexEvent(line);
    if (!event) return;
    if (event.type === "result") resultEmitted = true;
    emit(event);
  });

  child.stderr.resume();

  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      if (signal) {
        rejectExit(new Error(`Codex terminated by ${signal}`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });

  if (exitCode !== 0) fail(`Codex builder exited with status ${exitCode}`);
  if (!resultEmitted) emit({ type: "result", result: "" });
} catch (error) {
  process.stderr.write(`CODEXLOOPER_TERRA_BLOCK: ${error.message}\n`);
  process.exitCode = 1;
}
