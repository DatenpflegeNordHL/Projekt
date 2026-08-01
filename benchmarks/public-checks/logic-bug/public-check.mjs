import assert from "node:assert/strict";
import { runCandidateProbe } from "../../harness/verifier-protocol.mjs";

const workspace = process.argv[2];
assert.deepEqual(await runCandidateProbe(workspace, { fixture: "logic-bug", operation: "isNonEmpty", inputs: ["a"] }), [true]);
