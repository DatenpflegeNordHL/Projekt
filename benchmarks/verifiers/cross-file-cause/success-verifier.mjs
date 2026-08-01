import assert from "node:assert/strict";
import { runCandidateProbe } from "../../harness/verifier-protocol.mjs";
const workspace = process.argv[2];
try { assert.deepEqual(await runCandidateProbe(workspace, { fixture: "cross-file-cause", operation: "displayName", inputs: ["Ada", "Bo"] }), ["ADA", "BO"]); }
catch (error) { if (error?.code === "BENCHMARK_PROBE_TIMEOUT") process.exitCode = 3; else if (error?.code === "BENCHMARK_PROBE_FAILED") process.exitCode = 2; throw error; }
