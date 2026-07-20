#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProject } from "../src/run.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  try {
    const result = await runProject();
    const cost = result.receipt.usage?.totals?.estimated_cost_usd ?? 0;
    if (result.receipt.status !== "completed") {
      process.stderr.write(
        `CODEXLOOPER_RUN=BLOCK: ${result.receipt.failure?.code || "CODEXLOOPER_RUN_FAILED"}: ${result.receipt.failure?.message || "Run did not complete"}\n`,
      );
      process.stderr.write(`RECEIPT=${result.receiptPath}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("CODEXLOOPER_RUN=PASS\n");
      process.stdout.write(`RUN_ID=${result.receipt.run_id}\n`);
      process.stdout.write(`RECEIPT=${result.receiptPath}\n`);
      process.stdout.write(`ESTIMATED_COST_USD=${cost.toFixed(9)}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `CODEXLOOPER_RUN=BLOCK: ${error.code || "CODEXLOOPER_RUN_FAILED"}: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}
