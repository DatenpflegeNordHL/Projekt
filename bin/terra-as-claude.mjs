#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  recordCodexDiagnosticLine,
  sanitizeCodexDiagnosticLine,
} from "../src/codex-diagnostics.mjs";
import { superviseBuilderChanges } from "../src/git-supervisor.mjs";
import { prepareProfileLaunch } from "../src/profiles.mjs";
import { translateCodexEvent } from "../src/claude-stream.mjs";
import { recordCodexUsageLine } from "../src/telemetry.mjs";

const MAX_PROMPT_BYTES = 2_000_000;
const MAX_STDERR_BYTES = 16_384;
const MAX_TOOL_DIAGNOSTICS = 20;
const MAX_TOOL_DIAGNOSTIC_TEXT = 8_000;
const FAILURE_SIGNAL = /<<<RALPHEX:(?:TASK_)?FAILED>>>/;

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

function emitText(text) {
  emit({ type: "content_block_delta", delta: { type: "text_delta", text } });
}

function redactDiagnostic(value) {
  let text = String(value || "");
  const secret = process.env.CLOSEROUTER_API_KEY;
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]")
    .trim();
}

function hostGitGuidance(phase) {
  return `CodexLooper host Git policy:
- The workspace-write sandbox intentionally protects .git metadata.
- Do not run git add, git commit, git branch, git checkout, git merge, git reset, or other Git-mutating commands.
- Read-only Git commands such as git status, git diff, and git log remain allowed.
- Make only worktree changes permitted by the active plan, run its validation commands, and update its checkboxes.
- A trusted host supervisor validates allowed paths, repeats the validation commands, stages exact changed paths, and creates the local commit after this turn.
- Do not emit <<<RALPHEX:TASK_FAILED>>> merely because Git metadata is read-only.
- Follow the normal Ralphex signal rules as though the host commit succeeds.
- Current phase: ${phase}.`;
}

function boundedToolDiagnostics(events) {
  const relevant = events.filter((event) => {
    if (event.type === "turn.failed" || event.type === "error") return true;
    if (event.item_type === "command_execution" || event.item_type === "commandExecution") {
      return event.status === "failed" || event.status === "declined" || event.exit_code !== 0;
    }
    if (event.item_type === "file_change" || event.item_type === "fileChange") {
      return event.status === "failed" || event.status === "declined";
    }
    return event.item_type === "error";
  });
  const selected = (relevant.length > 0 ? relevant : events).slice(-8);
  return JSON.stringify(selected).slice(-MAX_TOOL_DIAGNOSTIC_TEXT);
}

try {
  validateArgs(process.argv.slice(2));
  let prompt = readFileSync(0, "utf8");
  if (!prompt.trim()) fail("Ralphex supplied an empty prompt");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    fail("Ralphex prompt exceeds the bounded adapter size");
  }

  const internalReview = prompt.includes("<<<RALPHEX:REVIEW_DONE>>>");
  const phase = internalReview ? "review" : "task";
  const reviewGuidance = internalReview
    ? `Ralphex review adapter for Codex:
- Interpret review Task-tool instructions using Codex collaboration tools.
- Launch requested review agents in parallel.
- Wait for all agents before collecting findings and applying fixes.
- Preserve every <<<RALPHEX:...>>> signal exactly.\n\n`
    : "";
  prompt = `${hostGitGuidance(phase)}\n\n${reviewGuidance}${prompt}`;

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

  let resultSeen = false;
  let messageEmitted = false;
  let telemetryError;
  let agentText = "";
  const toolDiagnostics = [];
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const linesClosed = new Promise((resolveClose) => lines.once("close", resolveClose));
  lines.on("line", (line) => {
    const diagnostic = sanitizeCodexDiagnosticLine(line, process.env.CLOSEROUTER_API_KEY);
    if (diagnostic) {
      toolDiagnostics.push(diagnostic);
      if (toolDiagnostics.length > MAX_TOOL_DIAGNOSTICS) toolDiagnostics.shift();
    }
    try {
      recordCodexDiagnosticLine(line);
    } catch {
      // Persistent diagnostics are optional and may never alter execution.
    }
    try {
      recordCodexUsageLine(line, launch.metadata);
    } catch (error) {
      telemetryError ||= error;
    }
    const event = translateCodexEvent(line);
    if (!event) return;
    if (event.type === "result") {
      resultSeen = true;
      return;
    }
    if (event.type === "content_block_delta") {
      messageEmitted = true;
      agentText += event.delta?.text || "";
      emit(event);
    }
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
    const toolDetail = toolDiagnostics.length > 0 ? boundedToolDiagnostics(toolDiagnostics) : "";
    fail(
      `Codex builder exited with status ${exitCode}${detail ? `: ${detail}` : ""}${toolDetail ? `; diagnostics=${toolDetail}` : ""}`,
    );
  }
  if (!messageEmitted) fail("Codex builder returned no translatable agent message");
  if (FAILURE_SIGNAL.test(agentText)) {
    if (toolDiagnostics.length > 0) {
      emitText(`CodexLooper tool diagnostics: ${boundedToolDiagnostics(toolDiagnostics)}\n`);
    }
  } else {
    const supervised = superviseBuilderChanges({ phase });
    if (supervised.committed) {
      emitText(`CodexLooper host commit ${supervised.commit.slice(0, 12)} created after policy and validation checks.\n`);
    }
  }
  if (!resultSeen) {
    emitText("CodexLooper compatibility note: Codex emitted no explicit turn.completed event.\n");
  }
  emit({ type: "result", result: "" });
} catch (error) {
  const diagnostic = `CODEXLOOPER_TERRA_BLOCK: ${redactDiagnostic(error.message)}`;
  emitText(`${diagnostic}\n<<<RALPHEX:TASK_FAILED>>>\n`);
  emit({ type: "result", result: "" });
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
}
