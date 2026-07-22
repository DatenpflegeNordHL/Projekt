#!/usr/bin/env node

import { verifyRuntimeManifest } from "../src/runtime-integrity.mjs";
import {
  recordActualEstimatedCost,
  reserveModelCall,
} from "../src/run-budget.mjs";
import { aggregateUsage, readUsageEvents } from "../src/telemetry.mjs";

function reconcileUsage() {
  const runDirectory = process.env.CODEXLOOPER_RUN_DIR;
  if (!runDirectory) throw new Error("CODEXLOOPER_RUN_DIR is required for Sol usage reconciliation");
  const usage = aggregateUsage(readUsageEvents(runDirectory));
  return recordActualEstimatedCost(usage.totals.estimated_cost_usd);
}

try {
  verifyRuntimeManifest({
    manifestPath: process.env.CODEXLOOPER_RUNTIME_MANIFEST,
    expectedManifestSha256: process.env.CODEXLOOPER_RUNTIME_MANIFEST_SHA256,
    expectedRuntimeDirectory: process.env.CODEXLOOPER_RUNTIME_DIR,
    expectedNodeExecutable: process.execPath,
  });
  reserveModelCall("reviewer");
  await import("./sol-review.mjs");
  reconcileUsage();
} catch (error) {
  process.stderr.write(
    `CODEXLOOPER_SOL_RUNTIME_BLOCK: ${error.code || "CODEXLOOPER_RUNTIME_FAILED"}: ${error.message}\n`,
  );
  process.exitCode = 1;
}
