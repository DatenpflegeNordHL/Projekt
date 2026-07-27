#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  recordCodexDiagnosticLine,
  sanitizeCodexDiagnosticLine,
} from "../src/codex-diagnostics.mjs";
import { parseBuilderOperationEnvelopeV2 } from "../src/builder-envelope.mjs";
import {
  captureBuilderSnapshotPatch,
  cleanupBuilderSnapshot,
  createBuilderSnapshot,
} from "../src/builder-snapshot.mjs";
import { applyBuilderOperations } from "../src/git-supervisor.mjs";
import { prepareProfileLaunch } from "../src/profiles.mjs";
import { recordCodexUsageLine } from "../src/telemetry.mjs";

const MAX_PROMPT_BYTES = 2_000_000;
const MAX_STDERR_BYTES = 16_384;
const MAX_TOOL_DIAGNOSTICS = 20;
const MAX_TOOL_DIAGNOSTIC_TEXT = 8_000;
const MAX_REJECTED_RESPONSE_BYTES = 65_536;
const MAX_RETRY_CONTEXT_BYTES = 4_096;
const MAX_CANDIDATE_VALIDATION_ARTIFACT_BYTES = 20_000;
const RETRY_CONTEXT_FILE = "builder-retry-context.json";
const RETRY_CONTEXT_CONSUMED_FILE = "builder-retry-context-consumed.json";
const CANDIDATE_VALIDATION_CONTEXT_FILE = "builder-candidate-validation-context.json";
const CANDIDATE_VALIDATION_CONTEXT_CONSUMED_FILE = "builder-candidate-validation-context-consumed.json";

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

function parseOperationMessages(messages, phase) {
  let lastError;
  let rejectedMessage = "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const legacy = parseLegacySignal(messages[index], phase);
    if (legacy) return legacy;
    try {
      return {
        operations: parseBuilderOperationEnvelopeV2(messages[index]),
        signal: "",
        summary: "",
        raw_payload: messages[index],
      };
    } catch (error) {
      lastError = error;
      rejectedMessage = messages[index];
    }
  }
  const error = lastError || new Error("Codex builder returned no usable agent result");
  error.rejectedBuilderMessage = rejectedMessage;
  throw error;
}

function exactPrivateRunDirectory() {
  const runDirectory = process.env.CODEXLOOPER_RUN_DIR;
  const projectRoot = process.env.CODEXLOOPER_PROJECT || process.cwd();
  if (typeof runDirectory !== "string" || !runDirectory || !isAbsolute(runDirectory)) {
    fail("Run directory is unavailable for rejected Builder response retention");
  }
  const runId = basename(runDirectory);
  if (!runId || runId === "." || runId === "..") {
    fail("Run directory is invalid for rejected Builder response retention");
  }
  const expected = resolve(projectRoot, ".codexlooper", "runs", runId);
  if (resolve(runDirectory) !== expected) {
    fail("Run directory is outside the private CodexLooper run path");
  }
  return expected;
}

function retainRejectedBuilderResponse(message, phase, error) {
  if (typeof message !== "string" || !message.trim()) return null;
  const redacted = redactDiagnostic(message);
  const bytes = Buffer.from(redacted, "utf8");
  const truncated = bytes.length > MAX_REJECTED_RESPONSE_BYTES;
  const response = truncated
    ? bytes.subarray(0, MAX_REJECTED_RESPONSE_BYTES).toString("utf8")
    : redacted;
  const artifactPath = resolve(
    exactPrivateRunDirectory(),
    `builder-rejected-response-${Date.now()}-${process.pid}.json`,
  );
  writeFileSync(
    artifactPath,
    `${JSON.stringify({
      schema: "codexlooper.builder-rejected-response.v1",
      phase,
      parser_error: redactDiagnostic(error?.message),
      truncated,
      response,
    })}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  chmodSync(artifactPath, 0o600);
  return artifactPath;
}

function retryContextPath(name) {
  return resolve(exactPrivateRunDirectory(), name);
}

function validRetryContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expected = [
    "category",
    "failure_code",
    "operation_index",
    "operation_type",
    "path",
    "reason",
    "schema",
  ];
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")) return null;
  if (
    value.schema !== "codexlooper.builder-retry-context.v1" ||
    value.failure_code !== "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED" ||
    value.category !== "operation_precondition" ||
    !Number.isSafeInteger(value.operation_index) ||
    value.operation_index < 0 ||
    !["create_file", "replace_exact"].includes(value.operation_type) ||
    typeof value.path !== "string" ||
    !value.path ||
    Buffer.byteLength(value.path, "utf8") > 1_024 ||
    typeof value.reason !== "string" ||
    !value.reason ||
    Buffer.byteLength(value.reason, "utf8") > 256
  ) {
    return null;
  }
  return Object.freeze({
    failure_code: value.failure_code,
    category: value.category,
    operation_index: value.operation_index,
    operation_type: value.operation_type,
    path: value.path,
    reason: value.reason,
  });
}

function retainBuilderRetryContext(context) {
  if (!context) return;
  const artifactPath = retryContextPath(RETRY_CONTEXT_FILE);
  const serialized = `${JSON.stringify({
    schema: "codexlooper.builder-retry-context.v1",
    ...context,
  })}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_RETRY_CONTEXT_BYTES) {
    fail("Builder retry context exceeds its bounded size");
  }
  if (existsSync(retryContextPath(RETRY_CONTEXT_CONSUMED_FILE))) return;
  writeFileSync(artifactPath, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(artifactPath, 0o600);
}

function consumeBuilderRetryContext() {
  const artifactPath = retryContextPath(RETRY_CONTEXT_FILE);
  const consumedPath = retryContextPath(RETRY_CONTEXT_CONSUMED_FILE);
  if (existsSync(consumedPath)) {
    rmSync(artifactPath, { force: true });
    return null;
  }
  if (!existsSync(artifactPath)) return null;
  let context;
  try {
    const serialized = readFileSync(artifactPath, "utf8");
    if (Buffer.byteLength(serialized, "utf8") > MAX_RETRY_CONTEXT_BYTES) return null;
    context = validRetryContext(JSON.parse(serialized));
  } catch {
    context = null;
  }
  writeFileSync(
    consumedPath,
    `${JSON.stringify({ schema: "codexlooper.builder-retry-context-consumed.v1" })}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  chmodSync(consumedPath, 0o600);
  rmSync(artifactPath, { force: true });
  return context;
}

function retryContextGuidance(context) {
  if (!context) return "";
  return `\n\nTrusted host retry context (re-read the immutable snapshot and return a corrected strict Builder Envelope v2 object):
- failure_code: ${context.failure_code}
- category: ${context.category}
- operation_index: ${context.operation_index}
- operation_type: ${context.operation_type}
- path: ${context.path}
- reason: ${context.reason}`;
}

function validCandidateValidationContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expected = ["category", "command", "exit_status", "failure_code", "failure_tail", "schema"];
  if (Object.keys(value).sort().join("\0") !== expected.join("\0")) return null;
  if (
    value.schema !== "codexlooper.builder-candidate-validation-context.v1" ||
    value.failure_code !== "CODEXLOOPER_CANDIDATE_FULL_PROJECT_CHECK_FAILED" ||
    value.category !== "candidate_full_project_validation" ||
    value.command !== "npm run check" ||
    !Number.isSafeInteger(value.exit_status) ||
    value.exit_status === 0 ||
    typeof value.failure_tail !== "string" ||
    Buffer.byteLength(value.failure_tail, "utf8") > MAX_RETRY_CONTEXT_BYTES
  ) {
    return null;
  }
  return Object.freeze({
    failure_code: value.failure_code,
    category: value.category,
    command: value.command,
    exit_status: value.exit_status,
    failure_tail: redactDiagnostic(value.failure_tail),
  });
}

function retainCandidateValidationContext(context, diagnostic) {
  if (!context || !diagnostic) return;
  const runDirectory = exactPrivateRunDirectory();
  const contextPath = resolve(runDirectory, CANDIDATE_VALIDATION_CONTEXT_FILE);
  const consumedPath = resolve(runDirectory, CANDIDATE_VALIDATION_CONTEXT_CONSUMED_FILE);
  if (existsSync(consumedPath)) return;
  const artifact = {
    schema: "codexlooper.builder-candidate-validation.v1",
    failure_code: context.failure_code,
    command: context.command,
    exit_status: context.exit_status,
    stdout: redactDiagnostic(diagnostic.stdout),
    stderr: redactDiagnostic(diagnostic.stderr),
  };
  const serializedArtifact = `${JSON.stringify(artifact)}\n`;
  const serializedContext = `${JSON.stringify({
    schema: "codexlooper.builder-candidate-validation-context.v1",
    ...context,
  })}\n`;
  if (
    Buffer.byteLength(serializedArtifact, "utf8") > MAX_CANDIDATE_VALIDATION_ARTIFACT_BYTES ||
    Buffer.byteLength(serializedContext, "utf8") > MAX_RETRY_CONTEXT_BYTES
  ) {
    fail("Candidate validation retry context exceeds its bounded size");
  }
  const artifactPath = resolve(
    runDirectory,
    `builder-candidate-validation-${Date.now()}-${process.pid}.json`,
  );
  writeFileSync(artifactPath, serializedArtifact, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(artifactPath, 0o600);
  writeFileSync(contextPath, serializedContext, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(contextPath, 0o600);
}

function consumeCandidateValidationContext() {
  const contextPath = retryContextPath(CANDIDATE_VALIDATION_CONTEXT_FILE);
  const consumedPath = retryContextPath(CANDIDATE_VALIDATION_CONTEXT_CONSUMED_FILE);
  if (existsSync(consumedPath)) {
    rmSync(contextPath, { force: true });
    return null;
  }
  if (!existsSync(contextPath)) return null;
  let context;
  try {
    const serialized = readFileSync(contextPath, "utf8");
    if (Buffer.byteLength(serialized, "utf8") > MAX_RETRY_CONTEXT_BYTES) return null;
    context = validCandidateValidationContext(JSON.parse(serialized));
  } catch {
    context = null;
  }
  writeFileSync(
    consumedPath,
    `${JSON.stringify({ schema: "codexlooper.builder-candidate-validation-context-consumed.v1" })}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  chmodSync(consumedPath, 0o600);
  rmSync(contextPath, { force: true });
  return context;
}

function candidateValidationContextGuidance(context) {
  if (!context) return "";
  return `\n\nTrusted host candidate validation retry context (re-read the immutable snapshot and return one corrected strict Builder Envelope v2 object):
- failure_code: ${context.failure_code}
- category: ${context.category}
- command: ${context.command}
- exit_status: ${context.exit_status}
- failure_tail: ${context.failure_tail}`;
}

function planCompleted(projectRoot = process.cwd(), sourceEnv = process.env) {
  const policyPath = sourceEnv.CODEXLOOPER_RUN_POLICY;
  if (typeof policyPath !== "string" || !policyPath) fail("Run policy is unavailable for completion check");
  let policy;
  try {
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    fail("Run policy is invalid during completion check");
  }
  if (policy?.schema !== "codexlooper.run-policy.v1" || typeof policy.plan !== "string") {
    fail("Run policy schema is invalid during completion check");
  }
  const plan = readFileSync(resolve(projectRoot, policy.plan), "utf8");
  if (policy.single_task !== undefined) {
    if (
      policy.single_task !== true ||
      !Number.isSafeInteger(policy.selected_task) ||
      policy.selected_task < 1 ||
      policy.original_plan !== policy.plan ||
      !/^[a-f0-9]{64}$/.test(policy.selected_task_completed_plan_sha256 || "")
    ) {
      fail("Single-task policy metadata is invalid during completion check");
    }
    return createHash("sha256").update(plan, "utf8").digest("hex") === policy.selected_task_completed_plan_sha256;
  }
  return !plan.includes("- [ ]");
}

function hostSignal({ phase, requestedSignal, committed, effectivePatch }) {
  if (requestedSignal === "<<<RALPHEX:TASK_FAILED>>>") return requestedSignal;
  if (phase === "task") {
    return planCompleted() ? "<<<RALPHEX:ALL_TASKS_DONE>>>" : "";
  }
  return committed || effectivePatch.trim() ? "" : "<<<RALPHEX:REVIEW_DONE>>>";
}

function builderEnvelopeV2Guidance(phase) {
  return `CodexLooper read-only Builder Envelope v2 policy:
- You are running inside a disposable read-only clone of the repository. The real project is never writable from this session.
- Inspect files with read-only shell commands, git status, git diff, and git log.
- The read-only filesystem is intentional. Do not run tests or validation commands inside the model sandbox when they may create temporary files, caches, lockfiles, coverage data, or other writes.
- Inability to create files or execute write-producing validation inside the snapshot is expected and is not a task blocker. The trusted host performs validation after accepting the patch.
- Never edit, create, delete, rename, copy, or chmod files. Never run git-mutating commands.
- Your first and only substantive response must be exactly one syntactically valid Builder Envelope v2 JSON object: its first non-whitespace character is { and its final non-whitespace character is }. Do not emit Markdown, prose, comments, control signals, code fences, or trailing material.
- That root object is {"version":2,"operations":[...]}. Its only top-level fields are version and operations.
- Every operation discriminator field is exactly type. No aliases, no unknown fields, no omitted required fields, and never use kind as an operation field.
- A create_file operation has exactly these fields: type, path, content, expected_absent. type is exactly "create_file" and expected_absent is exactly true. Normative accepted V2 shape: {"version":2,"operations":[{"type":"create_file","path":"src/example.mjs","content":"export const example = true;\\n","expected_absent":true}]}.
- A replace_exact operation has exactly these fields: type, path, expected_file_sha256, old_text, new_text, expected_occurrences. type is exactly "replace_exact"; expected_file_sha256 is a lowercase 64-character SHA-256 digest; old_text is non-empty; expected_occurrences is exactly 1. Normative accepted V2 shape: {"version":2,"operations":[{"type":"replace_exact","path":"src/example.mjs","expected_file_sha256":"0000000000000000000000000000000000000000000000000000000000000000","old_text":"export const example = true;\\n","new_text":"export const example = false;\\n","expected_occurrences":1}]}.
- All code belongs in JSON string values. Before output, JSON-escape every embedded double quote, backslash, tab, carriage return, and newline.
- Do not author a Git diff, hunk headers, Apply-Patch markers, or any patch text. Do not run git apply, including git apply --check; the host materializes operations and generates the canonical diff.
- Re-read every existing replacement target immediately before constructing its expected_file_sha256, old_text, and new_text. The expected_file_sha256 is the lowercase SHA-256 of the complete current UTF-8 file content; old_text must occur exactly once.
- For every replace_exact, use a distinctive block confirmed to occur exactly once in the immutable snapshot. Never use a short structural anchor such as a bare closing brace, generic return statement, import line, or other fragment likely to recur. Prefer complete current file content for a whole-file replacement; otherwise use a complete named function, class, or block with enough unique surrounding context.
- Inspect silently. Your first and only substantive agent response must be the strict Builder Envelope v2 JSON object; never emit planning or progress prose.
- Every changed path must be permitted by the active plan. A valid non-final task envelope may omit a canonical plan checkbox while work remains. Include its exact checkbox change only in the final envelope that completes the task.
- Do not mark a task checkbox complete unless the operations cover every requirement and required test category for that task. Tests must be authored as create_file or replace_exact operations even though they cannot be executed inside the read-only model snapshot.
- Never emit Ralphex markers or control signals alongside a Builder Envelope v2 JSON object.
- The trusted host alone derives continuation and completion from validated operations, canonical plan state, and trusted host commit evidence.
- Current phase: ${phase}.`;
}

function reviewGuidance(internalReview) {
  if (!internalReview) return "";
  return `Ralphex review adapter for Codex:
- Interpret review Task-tool instructions using Codex collaboration tools.
- Launch requested review agents in parallel inside the read-only disposable snapshot.
- Wait for all agents before collecting findings.
- Return one final structured patch envelope from the primary agent only.\n\n`;
}

let snapshot;
try {
  validateArgs(process.argv.slice(2));
  let prompt = readFileSync(0, "utf8");
  if (!prompt.trim()) fail("Ralphex supplied an empty prompt");
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    fail("Ralphex prompt exceeds the bounded adapter size");
  }

  const internalReview = prompt.includes("<<<RALPHEX:REVIEW_DONE>>>");
  const phase = internalReview ? "review" : "task";
  const retryContext = consumeBuilderRetryContext();
  const candidateValidationContext = consumeCandidateValidationContext();
  prompt = `${builderEnvelopeV2Guidance(phase)}${retryContextGuidance(retryContext)}${candidateValidationContextGuidance(candidateValidationContext)}\n\n${reviewGuidance(internalReview)}${prompt}`;
  snapshot = createBuilderSnapshot();

  const launch = prepareProfileLaunch("builder", {
    json: true,
    multiAgent: internalReview,
    sandbox: "read-only",
    sourceEnv: snapshot.env,
    projectRoot: snapshot.root,
  });

  const child = spawn(launch.command, launch.args, {
    cwd: snapshot.root,
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
  if (agentMessages.length === 0) fail("Codex builder returned no agent message");

  const snapshotPatch = captureBuilderSnapshotPatch({ snapshot });
  if (snapshotPatch.trim()) fail("Read-only Codex builder modified the isolated snapshot");
  let envelope;
  try {
    envelope = parseOperationMessages(agentMessages, phase);
  } catch (error) {
    retainRejectedBuilderResponse(error.rejectedBuilderMessage, phase, error);
    throw error;
  }
  let supervised = { committed: false };
  let effectivePatch = "";
  if (envelope.signal !== "<<<RALPHEX:TASK_FAILED>>>") {
    const runDirectory = process.env.CODEXLOOPER_RUN_DIR;
    const payloadArtifact =
      typeof runDirectory === "string" && runDirectory
        ? resolve(
            runDirectory,
            `builder-envelope-${Date.now()}-${process.pid}.json`,
          )
        : null;

    if (payloadArtifact && envelope.raw_payload) {
      writeFileSync(payloadArtifact, envelope.raw_payload, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    }

    try {
      supervised = envelope.operations
        ? applyBuilderOperations({ envelope: envelope.operations, phase })
        : { committed: false };
    } catch (error) {
      retainCandidateValidationContext(
        error.candidateValidationContext,
        error.candidateValidationDiagnostic,
      );
      retainBuilderRetryContext(error.builderRetryContext);
      throw error;
    }
    effectivePatch = supervised.canonical_diff || "";

    if (payloadArtifact && supervised.committed) {
      rmSync(payloadArtifact, { force: true });
    }
  }
  const signal = hostSignal({
    phase,
    requestedSignal: envelope.signal,
    committed: Boolean(supervised.committed),
    effectivePatch,
  });
  if (envelope.summary) emitText(`${envelope.summary}\n`);
  if (supervised.committed) {
    emitText(
      `CodexLooper host commit ${supervised.commit.slice(0, 12)} created after read-only patch, policy, and validation checks.\n`,
    );
  }
  if (signal) emitText(`${signal}\n`);
  emit({ type: "result", result: "" });
} catch (error) {
  const diagnostic = `CODEXLOOPER_TERRA_BLOCK: ${redactDiagnostic(error.message)}`;
  emitText(`${diagnostic}\n<<<RALPHEX:TASK_FAILED>>>\n`);
  emit({ type: "result", result: "" });
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
} finally {
  try {
    cleanupBuilderSnapshot({ snapshot });
  } catch (error) {
    const diagnostic = `CODEXLOOPER_SNAPSHOT_CLEANUP_BLOCK: ${redactDiagnostic(error.message)}`;
    process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
  }
}
