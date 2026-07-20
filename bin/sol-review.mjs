#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname } from "node:path";
import { prepareProfileLaunch } from "../src/profiles.mjs";
import { recordCodexUsageLine } from "../src/telemetry.mjs";

const MAX_STDERR_BYTES = 16_384;

function fail(message) {
  throw new Error(message);
}

function redactDiagnostic(value) {
  let text = String(value || "");
  const secret = process.env.CLOSEROUTER_API_KEY;
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]")
    .trim();
}

function readRalphexPrompt(suppliedPath) {
  if (!suppliedPath || suppliedPath.includes("\0")) {
    fail("Sol review requires one valid prompt-file path");
  }

  const promptPath = realpathSync(suppliedPath);
  const tempRoot = realpathSync(tmpdir());
  if (dirname(promptPath) !== tempRoot) {
    fail("Sol review accepts only Ralphex temporary prompt files");
  }
  if (!/^ralphex-custom-prompt-[A-Za-z0-9._-]+\.txt$/.test(basename(promptPath))) {
    fail("Sol review prompt filename is not a Ralphex custom prompt");
  }

  const noFollow = constants.O_NOFOLLOW || 0;
  const descriptor = openSync(promptPath, constants.O_RDONLY | noFollow);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 2_000_000) {
      fail("Sol review prompt must be a bounded regular file");
    }
    if ((stat.mode & 0o077) !== 0) {
      fail("Sol review prompt permissions must not allow group or public access");
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      fail("Sol review prompt must be owned by the current user");
    }
    const prompt = readFileSync(descriptor, "utf8");
    if (!prompt.trim()) fail("Sol review prompt is empty");
    return prompt;
  } finally {
    closeSync(descriptor);
  }
}

function parseReviewOutput(stdout, metadata) {
  const messages = [];
  let resultSeen = false;
  for (const line of String(stdout || "").split(/\r?\n/).filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      fail("Sol review returned non-JSON output in JSON mode");
    }
    recordCodexUsageLine(line, metadata);
    if (event?.type === "item.completed" && event?.item?.type === "agent_message") {
      const text = typeof event.item.text === "string" ? event.item.text.trim() : "";
      if (text) messages.push(text);
    }
    if (event?.type === "turn.completed") resultSeen = true;
    if (event?.type === "turn.failed" || event?.type === "error") {
      fail(`Sol review failed: ${event.error?.message || event.message || "unknown error"}`);
    }
  }
  if (!resultSeen) fail("Sol review returned no completed turn");
  if (messages.length === 0) fail("Sol review returned no agent message");
  return messages.join("\n");
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    fail("Sol review requires exactly one prompt-file path");
  }
  const prompt = readRalphexPrompt(args[0]);

  const launch = prepareProfileLaunch("reviewer", {
    json: true,
    sandbox: "read-only",
  });
  const result = spawnSync(launch.command, launch.args, {
    cwd: process.cwd(),
    env: launch.env,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const detail = redactDiagnostic(String(result.stderr || "").slice(-MAX_STDERR_BYTES));
    fail(`Codex reviewer exited with status ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`);
  }
  const output = parseReviewOutput(result.stdout, launch.metadata);
  process.stdout.write(`${output}\n`);
} catch (error) {
  process.stderr.write(`CODEXLOOPER_SOL_BLOCK: ${redactDiagnostic(error.message)}\n`);
  process.exitCode = 1;
}
