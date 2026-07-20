#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import {
  recordCodexDiagnosticLine,
  sanitizeCodexDiagnosticLine,
} from "../src/codex-diagnostics.mjs";
import { parseBuilderEnvelope } from "../src/builder-envelope.mjs";
import { applyBuilderPatch, superviseBuilderChanges } from "../src/git-supervisor.mjs";
import { prepareProfileLaunch } from "../src/profiles.mjs";
import { recordCodexUsageLine } from "../src/telemetry.mjs";

const MAX_PROMPT_BYTES = 2_000_000;
const MAX_STDERR_BYTES = 16_384;
const MAX_TOOL_DIAGNOSTICS = 20;
const MAX_TOOL_DIAGNOSTIC_TEXT = 8_000;

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

function parseLegacySignal(text, phase) {
  const value = String(text || "").trim();
  const allowed =
    phase === "review"
      ? new Set(["<<<RALPHEX:REVIEW_DONE>>>", "<<<RALPHEX:TASK_FAILED>>>"])
      : new Set(["<<<RALPHEX:ALL_TASKS_DONE>>>", "<<<RALPHEX:TASK_FAILED>>>"]);
  if (!allowed.has(value)) return null;
  return {
    version: 0,
    patch: "",
    signal: value,
    summary: "",
    legacy_worktree: true,
  };
}

function structuredPatchGuidance(phase) {
  const phaseSignal =
    phase === "review"
      ? "Use REVIEW_DONE only when no issue exists. If you provide a fix patch, use an empty signal."
      : "Use ALL_TASKS_DONE only when the patch completes every actionable plan item. Otherwise use an empty signal.";
  return `CodexLooper structured patch policy:
- You are intentionally running in a read-only sandbox. Use read-only shell and file-inspection tools to inspect the plan and repository.
- Never attempt apply_patch, file-writing shell commands, or Git-mutating commands.
- Your final response must be one plain JSON object, not markdown. Required fields are patch and signal. Optional fields are version, summary, and overview. No other fields are allowed.
- patch must be an empty string or a standard textual git unified diff beginning with diff --git lines.
- signal must be one of: empty string, <<<RALPHEX:ALL_TASKS_DONE>>>, <<<RALPHEX:REVIEW_DONE>>>, or <<<RALPHEX:TASK_FAILED>>> as allowed for the current phase.
- Use only same-path file additions, deletions, and modifications. Do not emit renames, copies, binary patches, symlinks, submodules, quoted paths, or paths containing whitespace.
- Every changed path must be permitted by the active plan. For task work, include the plan checkbox update in the patch.
- The trusted host validates allowed paths, runs git apply --check, applies the patch, repeats validation commands, and creates the local commit.
- ${phaseSignal}
- Use TASK_FAILED only when the task cannot be completed safely; TASK_FAILED requires an empty patch.
- Current phase: ${phase}.`;
}

function reviewGuidance(internalReview) {
  if (!internalReview) return "";
  return `Ralphex review adapter for Codex:
- Interpret review Task-tool instructions using Codex collaboration tools.
- Launch requested review agents in parallel and keep them read-only.
- Wait for all agents before collecting findings.
- Return one final structured patch envelope from the primary agent only.\n\n`;
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
  prompt = `${structuredPatchGuidance(phase)}\n\n${reviewGuidance(internalReview)}${prompt}`;

  const launch = prepareProfileLaunch("builder", {
    json: true,
    multiAgent: internalReview,
    sandbox: "read-only",
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

  let telemetryError;
  const agentMessages = [];
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
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event?.type === "item.completed" && event?.item?.type === "agent_message") {
      const text = typeof event.item.text === "string" ? event.item.text : "";
      if (text) agentMessages.push(text);
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
    const events = toolDiagnostics.length > 0 ? `; events=${boundedToolDiagnostics(toolDiagnostics)}` : "";
    fail(`Codex builder exited with status ${exitCode}${detail ? `: ${detail}` : ""}${events}`);
  }
  if (agentMessages.length === 0) fail("Codex builder returned no structured agent message");

  let envelope;
  try {
    envelope = parseBuilderEnvelope(agentMessages.at(-1), phase);
  } catch (error) {
    envelope = parseLegacySignal(agentMessages.at(-1), phase);
    if (!envelope) throw error;
  }
  let supervised = { committed: false };
  if (envelope.signal !== "<<<RALPHEX:TASK_FAILED>>>") {
    supervised = envelope.legacy_worktree
      ? superviseBuilderChanges({ phase })
      : applyBuilderPatch({ patch: envelope.patch, phase });
  }
  if (envelope.summary) emitText(`${envelope.summary}\n`);
  if (supervised.committed) {
    emitText(
      `CodexLooper host commit ${supervised.commit.slice(0, 12)} created after patch, policy, and validation checks.\n`,
    );
  }
  if (envelope.signal) emitText(`${envelope.signal}\n`);
  emit({ type: "result", result: "" });
} catch (error) {
  const diagnostic = `CODEXLOOPER_TERRA_BLOCK: ${redactDiagnostic(error.message)}`;
  emitText(`${diagnostic}\n<<<RALPHEX:TASK_FAILED>>>\n`);
  emit({ type: "result", result: "" });
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
}
