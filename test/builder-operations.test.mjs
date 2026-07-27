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
    files: new Map([
      ["src/created.mjs", "export const created = true;\n"],
      ["src/value.mjs", "export const value = 2;\n"],
    ]),
    changed_paths: ["src/created.mjs", "src/value.mjs"],
  });
});

test("materializes replacement text literally without replacement-pattern expansion", () => {
  const original = "export const value = 1;\n";
  const result = materializeBuilderOperations(
    { "src/value.mjs": original },
    envelope(replace(original, { new_text: "$&-$`-$'" })),
  );
  assert.equal(result.files.get("src/value.mjs"), "export const $&-$`-$';\n");
});

test("materialization is deterministic and returned Map mutation cannot mutate baseline inputs", () => {
  const original = "export const value = 1;\n";
  const baseline = { "src/z.mjs": "z\n", "src/value.mjs": original };
  const input = envelope(replace(original), create("src/a.mjs", "a\n"));
  const baselineBefore = structuredClone(baseline);
  const envelopeBefore = structuredClone(input);

  const first = materializeBuilderOperations(baseline, input);
  const second = materializeBuilderOperations(baseline, input);

  assert.deepEqual(first, second);
  assert.deepEqual([...first.files.keys()], ["src/a.mjs", "src/value.mjs", "src/z.mjs"]);
  assert.deepEqual(baseline, baselineBefore);
  assert.deepEqual(input, envelopeBefore);
  assert.equal(first.files instanceof Map, true);
  first.files.set("src/value.mjs", "mutated output\n");
  first.files.delete("src/z.mjs");
  assert.deepEqual(baseline, baselineBefore);
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

test("rejects symbol-keyed, non-enumerable, inherited and accessor-backed fields", () => {
  const symbolEnvelope = envelope(create());
  symbolEnvelope[Symbol("unknown")] = true;
  assert.throws(
    () => validateBuilderOperationEnvelope(symbolEnvelope),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  const symbolOperation = create();
  symbolOperation[Symbol("unknown")] = true;
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(symbolOperation)),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  const hiddenEnvelope = envelope(create());
  Object.defineProperty(hiddenEnvelope, "hidden", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => validateBuilderOperationEnvelope(hiddenEnvelope),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  const hiddenOperation = create();
  Object.defineProperty(hiddenOperation, "hidden", {
    value: true,
    enumerable: false,
  });
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(hiddenOperation)),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  const inheritedEnvelope = Object.create({ version: 2 });
  inheritedEnvelope.operations = [create()];
  assert.throws(
    () => validateBuilderOperationEnvelope(inheritedEnvelope),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  const inheritedOperation = Object.create(create());
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(inheritedOperation)),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  let envelopeGetterReads = 0;
  const accessorEnvelope = { version: 2 };
  Object.defineProperty(accessorEnvelope, "operations", {
    enumerable: true,
    get() {
      envelopeGetterReads += 1;
      return [create()];
    },
  });
  assert.throws(
    () => validateBuilderOperationEnvelope(accessorEnvelope),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.equal(envelopeGetterReads, 0);

  let operationGetterReads = 0;
  const accessorOperation = create();
  Object.defineProperty(accessorOperation, "content", {
    enumerable: true,
    get() {
      operationGetterReads += 1;
      return "never read";
    },
  });
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(accessorOperation)),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.equal(operationGetterReads, 0);
});

test("rejects changing SHA and operations getters without invoking them", () => {
  let hashReads = 0;
  const changingHash = replace("export const value = 1;\n");
  Object.defineProperty(changingHash, "expected_file_sha256", {
    enumerable: true,
    get() {
      hashReads += 1;
      return hashReads < 3 ? "0".repeat(64) : "INVALID";
    },
  });
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(changingHash)),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.equal(hashReads, 0);

  let operationsReads = 0;
  const changingOperations = { version: 2 };
  Object.defineProperty(changingOperations, "operations", {
    enumerable: true,
    get() {
      operationsReads += 1;
      return operationsReads === 1
        ? [create()]
        : Array.from(
            { length: BUILDER_OPERATION_LIMITS.max_operations + 1 },
            (_, index) => create(`src/${index}.mjs`),
          );
    },
  });
  assert.throws(
    () => validateBuilderOperationEnvelope(changingOperations),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.equal(operationsReads, 0);
});

test("requires a dense ordinary operations Array with only data elements", () => {
  const sparse = new Array(1);
  const extra = [create()];
  extra.extra = true;
  class OperationArray extends Array {}
  const subclassed = new OperationArray(create());
  const customPrototype = [create()];
  Object.setPrototypeOf(customPrototype, {});
  const proxied = new Proxy([create()], {});
  let elementReads = 0;
  const accessorElement = [create()];
  Object.defineProperty(accessorElement, "0", {
    enumerable: true,
    get() {
      elementReads += 1;
      return create();
    },
  });

  for (const operations of [
    sparse,
    extra,
    subclassed,
    customPrototype,
    proxied,
    accessorElement,
  ]) {
    assert.throws(
      () => validateBuilderOperationEnvelope({ version: 2, operations }),
      (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
    );
  }
  assert.equal(elementReads, 0);
});

test("rejects proxied envelope, operation and baseline objects", () => {
  assert.throws(
    () => validateBuilderOperationEnvelope(new Proxy(envelope(create()), {})),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(new Proxy(create(), {}))),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
  assert.throws(
    () =>
      materializeBuilderOperations(
        new Proxy({ "src/value.mjs": "value\n" }, {}),
        envelope(create()),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
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
    "__proto__",
    "src/prototype/value.mjs",
    "src/constructor",
    "src/toString/value.mjs",
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

test("rejects no-op exact replacements so changed paths are actual changes", () => {
  const original = "export const value = 1;\n";
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope(
          replace(original, {
            old_text: "value = 1",
            new_text: "value = 1",
          }),
        ),
      ),
    (error) =>
      error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID" &&
      /must change/u.test(error.message),
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
    envelope(replace(original, { expected_file_sha256: 42 })),
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

test("accepts exact aggregate boundaries and rejects one-byte multibyte overflows", () => {
  const exactOperationCount = envelope(
    ...Array.from(
      { length: BUILDER_OPERATION_LIMITS.max_operations },
      (_, index) => create(`count/${index}.mjs`, ""),
    ),
  );
  assert.equal(
    validateBuilderOperationEnvelope(exactOperationCount).operations.length,
    BUILDER_OPERATION_LIMITS.max_operations,
  );

  const emptyPair = envelope(create("a", ""), create("b", ""));
  const fixedEnvelopeBytes = Buffer.byteLength(JSON.stringify(emptyPair), "utf8");
  const contentBudget = BUILDER_OPERATION_LIMITS.max_envelope_bytes - fixedEnvelopeBytes;
  const firstBytes = Math.floor(contentBudget / 2);
  const secondBytes = contentBudget - firstBytes;
  assert.ok(firstBytes <= BUILDER_OPERATION_LIMITS.max_content_bytes);
  assert.ok(secondBytes <= BUILDER_OPERATION_LIMITS.max_content_bytes);

  const exactEnvelope = envelope(
    create("a", "a".repeat(firstBytes)),
    create("b", "b".repeat(secondBytes)),
  );
  assert.equal(
    Buffer.byteLength(JSON.stringify(exactEnvelope), "utf8"),
    BUILDER_OPERATION_LIMITS.max_envelope_bytes,
  );
  assert.equal(validateBuilderOperationEnvelope(exactEnvelope).operations.length, 2);

  const overEnvelope = envelope(
    create("a", "a".repeat(firstBytes)),
    create("b", `${"b".repeat(secondBytes)}c`),
  );
  assert.throws(
    () => validateBuilderOperationEnvelope(overEnvelope),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_TOO_LARGE",
  );

  const exactPath = `p/${"é".repeat((BUILDER_OPERATION_LIMITS.max_path_bytes - 2) / 2)}`;
  assert.equal(
    Buffer.byteLength(exactPath, "utf8"),
    BUILDER_OPERATION_LIMITS.max_path_bytes,
  );
  assert.equal(
    validateBuilderOperationEnvelope(envelope(create(exactPath))).operations[0].path,
    exactPath,
  );
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(create(`${exactPath}é`))),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );

  const exactContent = "é".repeat(BUILDER_OPERATION_LIMITS.max_content_bytes / 2);
  assert.equal(
    Buffer.byteLength(exactContent, "utf8"),
    BUILDER_OPERATION_LIMITS.max_content_bytes,
  );
  assert.equal(
    validateBuilderOperationEnvelope(envelope(create("src/exact.mjs", exactContent)))
      .operations[0].content,
    exactContent,
  );
  assert.throws(
    () =>
      validateBuilderOperationEnvelope(
        envelope(create("src/over.mjs", `${exactContent}é`)),
      ),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_INVALID",
  );
});

test("aggregate envelope overflow rejects before validating a later operation", () => {
  const first = replace("baseline", {
    path: "src/large.mjs",
    expected_file_sha256: "0".repeat(64),
    old_text: "x".repeat(BUILDER_OPERATION_LIMITS.max_content_bytes),
    new_text: "y".repeat(BUILDER_OPERATION_LIMITS.max_content_bytes),
  });
  let laterReads = 0;
  const later = create("src/later.mjs");
  Object.defineProperty(later, "content", {
    enumerable: true,
    get() {
      laterReads += 1;
      throw new Error("later operation must not be read");
    },
  });
  assert.throws(
    () => validateBuilderOperationEnvelope(envelope(first, later)),
    (error) => error.code === "CODEXLOOPER_BUILDER_OPERATIONS_TOO_LARGE",
  );
  assert.equal(laterReads, 0);
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

test("accepts null-prototype baselines and returns a path-safe Map", () => {
  const original = "export const value = 1;\n";
  const baseline = Object.create(null);
  baseline["src/value.mjs"] = original;
  const result = materializeBuilderOperations(
    baseline,
    envelope(replace(original)),
  );
  assert.equal(result.files instanceof Map, true);
  assert.deepEqual([...result.files], [["src/value.mjs", "export const value = 2;\n"]]);
});

test("enforces exact multibyte baseline byte limits before constructing a Map", () => {
  const exactContent = "é".repeat(BUILDER_OPERATION_LIMITS.max_baseline_bytes / 2);
  const exactBaseline = { "src/value.mjs": exactContent };
  const exact = materializeBuilderOperations(
    exactBaseline,
    envelope(create("src/created.mjs", "")),
  );
  assert.equal(exact.files.get("src/value.mjs"), exactContent);

  const overBaseline = { "src/value.mjs": `${exactContent}é` };
  assert.throws(
    () =>
      materializeBuilderOperations(
        overBaseline,
        envelope(create("src/created.mjs", "")),
      ),
    (error) =>
      error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID" &&
      /byte limit/u.test(error.message),
  );
});

test("accepts the exact baseline file-count boundary", () => {
  const baseline = Object.fromEntries(
    Array.from(
      { length: BUILDER_OPERATION_LIMITS.max_baseline_files },
      (_, index) => [`files/${index}.mjs`, ""],
    ),
  );
  const result = materializeBuilderOperations(
    baseline,
    envelope(create("src/created.mjs", "")),
  );
  assert.equal(
    result.files.size,
    BUILDER_OPERATION_LIMITS.max_baseline_files + 1,
  );
});

test("baseline count and byte overflow reject before later values are accessed", () => {
  let countGetterReads = 0;
  const tooMany = Object.create(null);
  for (let index = 0; index < BUILDER_OPERATION_LIMITS.max_baseline_files + 1; index += 1) {
    Object.defineProperty(tooMany, `src/${index}.mjs`, {
      enumerable: true,
      get() {
        countGetterReads += 1;
        throw new Error("count-limited baseline value must not be read");
      },
    });
  }
  assert.throws(
    () => materializeBuilderOperations(tooMany, envelope(create("src/new.mjs"))),
    (error) =>
      error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID" &&
      /file-count limit/u.test(error.message),
  );
  assert.equal(countGetterReads, 0);

  let laterGetterReads = 0;
  const byteLimited = Object.create(null);
  byteLimited["src/first.mjs"] = "x".repeat(
    BUILDER_OPERATION_LIMITS.max_baseline_bytes + 1,
  );
  Object.defineProperty(byteLimited, "src/later.mjs", {
    enumerable: true,
    get() {
      laterGetterReads += 1;
      throw new Error("later baseline value must not be read");
    },
  });
  assert.throws(
    () => materializeBuilderOperations(byteLimited, envelope(create("src/new.mjs"))),
    (error) =>
      error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID" &&
      /byte limit/u.test(error.message),
  );
  assert.equal(laterGetterReads, 0);
});

test("rejects symbol, non-enumerable and accessor-backed baseline entries", () => {
  const symbolBaseline = { "src/value.mjs": "value\n" };
  symbolBaseline[Symbol("hidden")] = "hidden\n";
  assert.throws(
    () => materializeBuilderOperations(symbolBaseline, envelope(create())),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
  );

  const hiddenBaseline = {};
  Object.defineProperty(hiddenBaseline, "src/value.mjs", {
    value: "value\n",
    enumerable: false,
  });
  assert.throws(
    () => materializeBuilderOperations(hiddenBaseline, envelope(create())),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
  );

  let getterReads = 0;
  const accessorBaseline = {};
  Object.defineProperty(accessorBaseline, "src/value.mjs", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "value\n";
    },
  });
  assert.throws(
    () => materializeBuilderOperations(accessorBaseline, envelope(create())),
    (error) => error.code === "CODEXLOOPER_BUILDER_BASELINE_INVALID",
  );
  assert.equal(getterReads, 0);
});
