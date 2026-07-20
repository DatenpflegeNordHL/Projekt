#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { prepareProfileLaunch } from "../src/profiles.mjs";

function fail(message) {
  throw new Error(message);
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0] || args[0].includes("\0")) {
    fail("Sol review requires exactly one prompt-file path");
  }

  const suppliedPath = args[0];
  const initial = lstatSync(suppliedPath);
  if (initial.isSymbolicLink() || !initial.isFile()) {
    fail("Sol review prompt must be a regular non-symlink file");
  }
  if (initial.size <= 0 || initial.size > 2_000_000) {
    fail("Sol review prompt size is outside the allowed range");
  }

  const promptPath = realpathSync(suppliedPath);
  const prompt = readFileSync(promptPath, "utf8");
  if (!prompt.trim()) fail("Sol review prompt is empty");

  const launch = prepareProfileLaunch("reviewer", {
    json: false,
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
    fail(`Codex reviewer exited with status ${result.status ?? "unknown"}`);
  }
  const output = result.stdout.trim();
  if (!output) fail("Sol review returned no output");
  process.stdout.write(`${output}\n`);
} catch (error) {
  process.stderr.write(`CODEXLOOPER_SOL_BLOCK: ${error.message}\n`);
  process.exitCode = 1;
}
