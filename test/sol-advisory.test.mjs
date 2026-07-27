import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendSolAdvisoryPrompt, createSolAdvisoryProjection, readPrivateSolAdvisory } from "../src/sol-advisory.mjs";

const advisory = { base_sha: "a".repeat(40), head_sha: "b".repeat(40), risk_score: 1, changed_files: ["src/x.mjs"], test_gap_count: 0, review_priorities: [] };

test("Sol advisory is bounded projection-only and cannot replace the review prompt", () => {
  const projection = createSolAdvisoryProjection({ status: "available", advisory });
  const prompt = appendSolAdvisoryPrompt("Review this committed change.", projection);
  assert.match(prompt, /Trusted host advisory only/);
  assert.match(prompt, /src\/x\.mjs/);
  assert.equal(createSolAdvisoryProjection({ status: "failed", advisory: null }), null);
  assert.throws(() => createSolAdvisoryProjection({ status: "available", advisory: { ...advisory, changed_files: ["../secret"] } }), /safe project-relative/);
});

test("private advisory files reject tampering and unsafe permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-sol-advisory-"));
  try {
    const projection = createSolAdvisoryProjection({ status: "available", advisory });
    const path = join(root, "advisory.json");
    writeFileSync(path, JSON.stringify(projection), { mode: 0o600 });
    chmodSync(path, 0o600);
    assert.deepEqual(readPrivateSolAdvisory({ advisoryPath: path, runDirectory: root }), projection);
    writeFileSync(path, JSON.stringify({ ...projection, sha256: "0".repeat(64) }));
    assert.throws(() => readPrivateSolAdvisory({ advisoryPath: path, runDirectory: root }), /digest/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
