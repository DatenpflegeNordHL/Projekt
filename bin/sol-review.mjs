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

function fail(message) {
  throw new Error(message);
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

try {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    fail("Sol review requires exactly one prompt-file path");
  }
  const prompt = readRalphexPrompt(args[0]);

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
