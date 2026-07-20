#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { prepareProfileLaunch } from "../src/profiles.mjs";
import { translateCodexEvent } from "../src/claude-stream.mjs";
import { recordCodexUsageLine } from "../src/telemetry.mjs";

const MAX_PROMPT_BYTES = 2_000_000;
const MAX_STDERR_BYTES = 16_384;

function fail(message) {
  throw new Error(message);
}

function validateArgs(args) {
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--print", "--verbose", "--dangerously-skip-permissions"].includes(arg)) {
      if (seen.has(arg)) fail(`Ralphex executor argument is duplicated: ${arg}`);
      seen.add(arg);
      continue;
    }
    if (arg === "--output-format") {
      if (seen.has(arg) || args[index + 1] !== "stream-json") {
        fail("Ralphex executor requires exactly --output-format stream-json");
      }
      seen.add(arg);
      index += 1;
      continue;
    }
    fail(`Ralphex executor argument is not allowed: ${arg}`);
  }
  if (!seen.has("--print")) fail("Ralphex executor requires --print mode");
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function redactDiagnostic(value) {
  let text = String(value || "");
  const secret = process.env.CLOSEROUTER_API_KEY;
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]")
    .trim();
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

  let stdinError;
  child.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") stdinError = error;
  });
  child.stdin.end(prompt);

  let resultEmitted = false;
  let messageEmitted = false;
  let telemetryError;
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const linesClosed = new Promise((resolveClose) => lines.once("close", resolveClose));
  lines.on("line", (line) => {
    try {
      recordCodexUsageLine(line, launch.metadata);
    } catch (error) {
      telemetryError ||= error;
    }
    const event = translateCodexEvent(line);
    if (!event) return;
    if (event.type === "result") resultEmitted = true;
    if (event.type === "content_block_delta") messageEmitted = true;
    emit(event);
  });

  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-MAX_STDERR_BYTES);
  });

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

  if (stdinError) fail(`Codex stdin failed: ${stdinError.message}`);
  if (telemetryError) fail(`Codex usage telemetry failed: ${telemetryError.message}`);
  if (exitCode !== 0) {
    const detail = redactDiagnostic(stderrTail);
    fail(`Codex builder exited with status ${exitCode}${detail ? `: ${detail}` : ""}`);
  }
  if (!messageEmitted) fail("Codex builder returned no translatable agent message");
  if (!resultEmitted) emit({ type: "result", result: "" });
} catch (error) {
  const diagnostic = `CODEXLOOPER_TERRA_BLOCK: ${redactDiagnostic(error.message)}`;
  emit({
    type: "content_block_delta",
    delta: { type: "text_delta", text: `${diagnostic}\n` },
  });
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
}
