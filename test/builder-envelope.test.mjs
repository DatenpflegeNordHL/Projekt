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
  parseBuilderOperationEnvelopeV2,
} from "../src/builder-envelope.mjs";
import { createHash } from "node:crypto";

test("parses bounded full, minimal and fenced task patch envelopes", () => {
  const full = parseBuilderEnvelope(
    JSON.stringify({
      version: 1,
      patch: "diff --git a/src/value.mjs b/src/value.mjs\n--- a/src/value.mjs\n+++ b/src/value.mjs\n@@ -1 +1 @@\n-old\n+new\n",
      signal: "<<<RALPHEX:ALL_TASKS_DONE>>>",
      summary: "Implemented the task.",
    }),
    "task",
  );
  assert.equal(full.version, 1);
  assert.match(full.patch, /diff --git/);
  assert.equal(full.signal, "<<<RALPHEX:ALL_TASKS_DONE>>>");
  assert.equal(full.summary, "Implemented the task.");

  const minimal = parseBuilderEnvelope(
    JSON.stringify({ patch: "", signal: "", overview: "Still working." }),
    "task",
  );
  assert.equal(minimal.version, 1);
  assert.equal(minimal.summary, "Still working.");

  const fenced = parseBuilderEnvelope(
    'Result:\n```json\n{"patch":"","signal":"","overview":"Inspected."}\n```',
    "task",
  );
  assert.equal(fenced.summary, "Inspected.");
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

test("strictly parses one Builder Envelope v2 operation object", () => {
  const original = "export const value = 1;\n";
  const payload = JSON.stringify({
    version: 2,
    operations: [
      {
        type: "create_file",
        path: "src/new-value.mjs",
        content: "export const newValue = true;\n",
        expected_absent: true,
      },
      {
        type: "replace_exact",
        path: "src/value.mjs",
        expected_file_sha256: createHash("sha256").update(original, "utf8").digest("hex"),
        old_text: "value = 1",
        new_text: "value = 2",
        expected_occurrences: 1,
      },
    ],
  });
  const parsed = parseBuilderOperationEnvelopeV2(payload);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.operations.length, 2);
  assert.equal(Object.isFrozen(parsed.operations[0]), true);
});

test("rejects raw diffs and non-strict Builder Envelope v2 JSON", () => {
  const validCreate = {
    type: "create_file",
    path: "src/new-value.mjs",
    content: "export const newValue = true;\n",
    expected_absent: true,
  };
  for (const input of [
    "diff --git a/src/value.mjs b/src/value.mjs\n",
    '{"version":2,"operations":[}',
    '{"version":2,"version":2,"operations":[]}',
    `${JSON.stringify({ version: 2, operations: [validCreate] })} trailing`,
  ]) {
    assert.throws(
      () => parseBuilderOperationEnvelopeV2(input),
      (error) => /^CODEXLOOPER_BUILDER_V2_JSON/.test(error.code),
    );
  }
  assert.throws(
    () =>
      parseBuilderOperationEnvelopeV2(
        JSON.stringify({
          version: 2,
          operations: [{ ...validCreate, path: "../outside.mjs" }],
        }),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.throws(
    () =>
      parseBuilderOperationEnvelopeV2(
        JSON.stringify({
          version: 2,
          operations: [{ ...validCreate, content: "x".repeat(2_000_000) }],
        }),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_V2_JSON_TOO_LARGE",
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
