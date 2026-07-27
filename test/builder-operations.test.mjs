import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BUILDER_OPERATION_LIMITS,
  materializeBuilderOperations,
  validateBuilderOperationEnvelope,
} from "../src/builder-operations.mjs";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function create(path = "src/created.mjs", content = "export const created = true;\n") {
  return {
    type: "create_file",
    path,
    content,
    expected_absent: true,
  };
}

function replace(content, overrides = {}) {
  return {
    type: "replace_exact",
    path: "src/value.mjs",
    expected_file_sha256: sha256(content),
    old_text: "value = 1",
    new_text: "value = 2",
    expected_occurrences: 1,
    ...overrides,
  };
}

function envelope(...operations) {
  return { version: 2, operations };
}

test("validates and materializes create_file and replace_exact operations", () => {
  const original = "export const value = 1;\n";
  const result = materializeBuilderOperations(
    { "src/value.mjs": original },
    envelope(create(), replace(original)),
  );
  assert.deepEqual(result, {
    files: {
      "src/created.mjs": "export const created = true;\n",
      "src/value.mjs": "export const value = 2;\n",
    },
    changed_paths: ["src/created.mjs", "src/value.mjs"],
  });
});

test("materializes replacement text literally without replacement-pattern expansion", () => {
  const original = "export const value = 1;\n";
  const result = materializeBuilderOperations(
    { "src/value.mjs": original },
    envelope(replace(original, { new_text: "$&-$`-$'" })),
  );
  assert.equal(result.files["src/value.mjs"], "export const $&-$`-$';\n");
});

test("materialization is deterministic and does not mutate baseline or envelope inputs", () => {
  const original = "export const value = 1;\n";
  const baseline = { "src/z.mjs": "z\n", "src/value.mjs": original };
  const input = envelope(replace(original), create("src/a.mjs", "a\n"));
  const baselineBefore = structuredClone(baseline);
  const envelopeBefore = structuredClone(input);

  const first = materializeBuilderOperations(baseline, input);
  const second = materializeBuilderOperations(baseline, input);

  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.files), ["src/a.mjs", "src/value.mjs", "src/z.mjs"]);
  assert.deepEqual(baseline, baselineBefore);
  assert.deepEqual(input, envelopeBefore);
  assert.notStrictEqual(first.files, baseline);
});

test("returns a deeply frozen validated envelope copy", () => {
  const input = envelope(create());
  const validated = validateBuilderOperationEnvelope(input);
  assert.notStrictEqual(validated, input);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.operations), true);
  assert.equal(Object.isFrozen(validated.operations[0]), true);
});

test("rejects unknown and missing envelope or operation fields", () => {
  assert.throws(
    () => validateBuilderOperationEnvelope({ ...envelope(create()), summary: "not allowed" }),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.throws(
    () => validateBuilderOperationEnvelope({ operations: [create()] }),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope({ ...create(), mode: "text" }),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
});

test("rejects unsafe project-relative POSIX paths", () => {
  for (const path of [
    "",
    "/absolute.mjs",
    ".",
    "..",
    "./value.mjs",
    "src/../value.mjs",
    "src//value.mjs",
    "src\\value.mjs",
    "src/\u0000value.mjs",
    "src/\nvalue.mjs",
  ]) {
    assert.throws(
      () => validateBuilderOperationEnvelope(envelope(create(path))),
      (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
      path,
    );
  }
});

test("rejects duplicate operation target paths", () => {
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope(create("src/same.mjs"), create("src/same.mjs", "other\n")),
      ),
    (error) =>
      error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID" &&
      /repeats target path/u.test(error.message),
  );
});

test("rejects stale replacement hashes", () => {
  const original = "export const value = 1;\n";
  assert.throws(
    () =>
      materializeBuilderOperations(
        { "src/value.mjs": original },
        envelope(replace(original, { expected_file_sha256: "0".repeat(64) })),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
  );
});

test("rejects absent replace targets and existing create targets", () => {
  const original = "export const value = 1;\n";
  assert.throws(
    () => materializeBuilderOperations({}, envelope(replace(original))),
    (error) =>
      error.code === "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED" &&
      /target is absent/u.test(error.message),
  );
  assert.throws(
    () =>
      materializeBuilderOperations(
        { "src/created.mjs": "already here\n" },
        envelope(create()),
      ),
    (error) =>
      error.code === "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED" &&
      /already exists/u.test(error.message),
  );
});

test("rejects zero and multiple old-text occurrences, including overlaps", () => {
  const absent = "export const value = 3;\n";
  assert.throws(
    () =>
      materializeBuilderOperations(
        { "src/value.mjs": absent },
        envelope(replace(absent)),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
  );

  const repeated = "value = 1; value = 1;\n";
  assert.throws(
    () =>
      materializeBuilderOperations(
        { "src/value.mjs": repeated },
        envelope(replace(repeated)),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
  );

  const overlapping = "aaa";
  assert.throws(
    () =>
      materializeBuilderOperations(
        { "src/value.mjs": overlapping },
        envelope(
          replace(overlapping, {
            old_text: "aa",
            new_text: "b",
          }),
        ),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATION_PRECONDITION_FAILED",
  );
});

test("rejects unsupported operation types", () => {
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope({ type: "delete_file", path: "src/value.mjs" }),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_UNSUPPORTED",
  );
});

test("rejects malformed versions, arrays, operation values, hashes and preconditions", () => {
  const original = "export const value = 1;\n";
  for (const input of [
    null,
    [],
    { version: 1, operations: [create()] },
    { version: 2, operations: [] },
    { version: 2, operations: "not an array" },
    envelope(null),
    { version: 2, operations: new Array(1) },
    envelope({ ...create(), expected_absent: false }),
    envelope(replace(original, { expected_file_sha256: "A".repeat(64) })),
    envelope(replace(original, { expected_file_sha256: "a".repeat(63) })),
    envelope(replace(original, { expected_occurrences: 2 })),
    envelope(replace(original, { old_text: "" })),
    envelope(create("src/value.mjs", "contains\u0000nul")),
    envelope({ ...create(), content: 42 }),
  ]) {
    assert.throws(
      () => validateBuilderOperationEnvelope(input),
      (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
    );
  }
});

test("enforces explicit operation, path, content and envelope limits", () => {
  assert.throws(
    () =>
      validateBuilderOperationEnvelope({
        version: 2,
        operations: Array.from(
          { length: BUILDER_OPERATION_LIMITS.max_operations + 1 },
          (_, index) => create(`src/${index}.mjs`),
        ),
      }),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope(create(`src/${"x".repeat(BUILDER_OPERATION_LIMITS.max_path_bytes)}.mjs`)),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope(
          create(
            "src/large.mjs",
            "x".repeat(BUILDER_OPERATION_LIMITS.max_content_bytes + 1),
          ),
        ),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  const halfLimit = Math.floor(BUILDER_OPERATION_LIMITS.max_envelope_bytes / 2);
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope(
          replace("old", {
            path: "src/large.mjs",
            old_text: "x".repeat(halfLimit),
            new_text: "y".repeat(halfLimit),
            expected_file_sha256: sha256("old"),
          }),
        ),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_TOO_LARGE",
  );
});

test("rejects malformed and oversized baseline collections", () => {
  assert.throws(
    () => materializeBuilderOperations([], envelope(create())),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
  );
  assert.throws(
    () =>
      materializeBuilderOperations(
        { "src/value.mjs": Buffer.from("not text") },
        envelope(create()),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
  );
  assert.throws(
    () =>
      materializeBuilderOperations(
        { "src/value.mjs": "contains\u0000nul" },
        envelope(create()),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
  );
  assert.throws(
    () =>
      materializeBuilderOperations(
        Object.fromEntries(
          Array.from(
            { length: BUILDER_OPERATION_LIMITS.max_baseline_files + 1 },
            (_, index) => [`src/${index}.mjs`, ""],
          ),
        ),
        envelope(create()),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
  );
});
