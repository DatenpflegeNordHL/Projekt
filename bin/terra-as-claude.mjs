#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { prepareProfileLaunch } from "../src/profiles.mjs";
import { translateCodexEvent } from "../src/claude-stream.mjs";

const MAX_PROMPT_BYTES = 2_000_000;

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
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    fail("Ralphex prompt exceeds the bounded adapter size");
  }

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
  let messageEmitted = false;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const linesClosed = new Promise((resolveClose) => lines.once("close", resolveClose));
  lines.on("line", (line) => {
    const event = translateCodexEvent(line);
    if (!event) return;
    if (event.type === "result") resultEmitted = true;
    if (event.type === "content_block_delta") messageEmitted = true;
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
  await linesClosed;

  if (exitCode !== 0) fail(`Codex builder exited with status ${exitCode}`);
  if (!messageEmitted) fail("Codex builder returned no translatable agent message");
  if (!resultEmitted) emit({ type: "result", result: "" });
} catch (error) {
  process.stderr.write(`CODEXLOOPER_TERRA_BLOCK: ${error.message}\n`);
  process.exitCode = 1;
}
