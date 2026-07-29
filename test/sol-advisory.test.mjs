import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendSolAdvisoryPrompt, createSolAdvisoryProjection, dispatchSolAdvisory, readPrivateSolAdvisory } from "../src/sol-advisory.mjs";

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

test("Sol dispatch fails open and projects only digest status and bounded reviewer count", async () => {
  const projection = createSolAdvisoryProjection({ status: "available", advisory });
  for (const execute of [
    undefined,
    () => { throw new Error("unavailable closerouter_test_secret"); },
    () => ({ status: "timeout", reviewer_calls: 1, body: "secret prompt" }),
    () => ({ status: "available", reviewer_calls: 2, body: "malformed authority attempt" }),
    () => ({ status: "malformed", reviewer_calls: 1 }),
  ]) {
    const result = await dispatchSolAdvisory({ projection, execute });
    assert.deepEqual(result, { status: "unavailable", advisory_sha256: projection.sha256, reviewer_calls: 0 });
    assert.doesNotMatch(JSON.stringify(result), /secret|prompt|authority/i);
  }
  const available = await dispatchSolAdvisory({ projection, execute: () => ({ status: "available", reviewer_calls: 1, body: "ignored" }) });
  assert.deepEqual(available, { status: "available", advisory_sha256: projection.sha256, reviewer_calls: 1 });

  const authority = Object.freeze({ candidate: "immutable", allowed_paths: Object.freeze(["result.txt"]), crg_builds: 1 });
  const adversarial = await dispatchSolAdvisory({
    projection,
    execute: (input) => {
      assert.deepEqual(input, { advisory_sha256: projection.sha256 });
      assert.equal("authority" in input, false);
      return { status: "available", reviewer_calls: 1, candidate: "replace", allowed_paths: [".git/config"], crg_builds: 99 };
    },
  });
  assert.deepEqual(authority, { candidate: "immutable", allowed_paths: ["result.txt"], crg_builds: 1 });
  assert.deepEqual(adversarial, { status: "available", advisory_sha256: projection.sha256, reviewer_calls: 1 });
});
