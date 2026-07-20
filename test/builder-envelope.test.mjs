import test from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  builderOutputSchema,
  createBuilderOutputSchemaFile,
  parseBuilderEnvelope,
} from "../src/builder-envelope.mjs";

test("parses a bounded task patch envelope", () => {
  const value = parseBuilderEnvelope(
    JSON.stringify({
      version: 1,
      patch: "diff --git a/src/value.mjs b/src/value.mjs\n--- a/src/value.mjs\n+++ b/src/value.mjs\n@@ -1 +1 @@\n-old\n+new\n",
      signal: "<<<RALPHEX:ALL_TASKS_DONE>>>",
      summary: "Implemented the task.",
    }),
    "task",
  );
  assert.equal(value.version, 1);
  assert.match(value.patch, /diff --git/);
  assert.equal(value.signal, "<<<RALPHEX:ALL_TASKS_DONE>>>");
  assert.equal(value.summary, "Implemented the task.");
});

test("rejects phase-invalid signals and patches attached to terminal failures", () => {
  assert.throws(
    () =>
      parseBuilderEnvelope(
        JSON.stringify({ version: 1, patch: "", signal: "<<<RALPHEX:REVIEW_DONE>>>", summary: "" }),
        "task",
      ),
    (error) => error.code === "CODEXLOOPER_ENVELOPE_SIGNAL_INVALID",
  );
  assert.throws(
    () =>
      parseBuilderEnvelope(
        JSON.stringify({
          version: 1,
          patch: "diff --git a/a b/a\n",
          signal: "<<<RALPHEX:TASK_FAILED>>>",
          summary: "blocked",
        }),
        "task",
      ),
    (error) => error.code === "CODEXLOOPER_ENVELOPE_INVALID",
  );
});

test("schema is strict and created only in the private run directory", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-envelope-"));
  try {
    const runDirectory = join(root, ".codexlooper", "runs", "run-1");
    const path = createBuilderOutputSchemaFile({
      sourceEnv: { CODEXLOOPER_RUN_DIR: runDirectory },
      projectRoot: root,
    });
    const schema = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(schema, builderOutputSchema());
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    assert.throws(
      () =>
        createBuilderOutputSchemaFile({
          sourceEnv: { CODEXLOOPER_RUN_DIR: join(root, "outside") },
          projectRoot: root,
        }),
      (error) => error.code === "CODEXLOOPER_RUN_DIR_INVALID",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
