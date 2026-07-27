import assert from "node:assert/strict";
import test from "node:test";
import {
  CRG_VERSION,
  NO_CHANGES_DETECTED,
  createCrgResult,
  disabledCrgResult,
  normalizeDetectOutput,
  projectCrgAdvisory,
  redactCrgDiagnostic,
} from "../src/code-review-graph.mjs";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function advisory(overrides = {}) {
  return {
    base_sha: baseSha,
    head_sha: headSha,
    risk_score: 7.5,
    changed_files: ["src/example.mjs"],
    test_gap_count: 1,
    review_priorities: [{ file: "src/example.mjs", line: 4, kind: "changed_function" }],
    ...overrides,
  };
}

test("creates the exact disabled normalized CRG result", () => {
  assert.deepEqual(disabledCrgResult(12), {
    status: "disabled",
    version: null,
    duration_ms: 12,
    report_path: null,
    truncated: false,
    error_class: null,
    advisory: null,
  });
});

test("requires the exact pinned version for available results", () => {
  const result = createCrgResult({
    status: "available",
    version: CRG_VERSION,
    duration_ms: 3,
    advisory: advisory(),
  });
  assert.equal(result.version, CRG_VERSION);
  assert.throws(
    () => createCrgResult({ status: "available", version: "2.3.5" }),
    (error) => error.code === "CODEXLOOPER_CRG_RESULT_INVALID",
  );
});

test("normalizes only the exact upstream no-changes text", () => {
  assert.deepEqual(normalizeDetectOutput(NO_CHANGES_DETECTED, { baseSha, headSha }), {
    base_sha: baseSha,
    head_sha: headSha,
    risk_score: 0,
    changed_files: [],
    test_gap_count: 0,
    review_priorities: [],
  });
  assert.throws(
    () => normalizeDetectOutput(`${NO_CHANGES_DETECTED}\n`, { baseSha, headSha }),
    (error) => error.code === "CODEXLOOPER_CRG_MALFORMED_JSON",
  );
});

test("projects only bounded allowlisted advisory fields", () => {
  assert.deepEqual(projectCrgAdvisory(advisory()), advisory());
  for (const invalid of [
    advisory({ extra: "source snippet" }),
    advisory({ changed_files: ["../secret"] }),
    advisory({ changed_files: ["src\\secret.mjs"] }),
    advisory({ risk_score: Number.NaN }),
    advisory({ test_gap_count: -1 }),
    advisory({ review_priorities: [{ file: "src/example.mjs", line: 1, kind: "summary" }] }),
    advisory({ review_priorities: [{ file: "src/example.mjs", line: 1, kind: "changed_function", hint: "raw" }] }),
  ]) {
    assert.throws(
      () => projectCrgAdvisory(invalid),
      (error) => error.code === "CODEXLOOPER_CRG_PROJECTION_INVALID",
    );
  }
});

test("rejects malformed detect JSON and redacts credentials from diagnostics", () => {
  assert.throws(
    () => normalizeDetectOutput("not json", { baseSha, headSha }),
    (error) => error.code === "CODEXLOOPER_CRG_MALFORMED_JSON",
  );
  const diagnostic = redactCrgDiagnostic(
    "Authorization: Bearer bearer-value token=token-value secret-value",
    "secret-value",
  );
  assert.doesNotMatch(diagnostic, /bearer-value|token-value|secret-value/);
  assert.match(diagnostic, /\[REDACTED\]/);
});
