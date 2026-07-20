#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runLiveSmoke } from "../src/live-smoke.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  try {
    const result = await runLiveSmoke();
    process.stdout.write("CODEXLOOPER_LIVE_SMOKE=PASS\n");
    process.stdout.write(`RECEIPT=${result.receiptPath}\n`);
  } catch (error) {
    process.stderr.write(`CODEXLOOPER_LIVE_SMOKE=BLOCK: ${error.code || "ERROR"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
