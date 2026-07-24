import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectAdvisory, runCodeReviewGraph } from "../src/code-review-graph.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";

test("disabled mode is normalized", () => {
  const value = runCodeReviewGraph({});
  assert.equal(value.status, "disabled");
  assert.equal(value.version, null);
  assert.equal(value.error_class, null);
  assert.equal(value.advisory, null);
  assert.equal(value.truncated, false);
});

test("normalizes exact no-change output", () => {
  const value = projectAdvisory("No changes detected.", { baseSha: sha, headSha: sha });
  assert.deepEqual(value.changed_files, []);
  assert.equal(value.risk_score, 0);
});

test("rejects malformed and unsafe projections", () => {
  assert.throws(
    () => projectAdvisory("not json", { baseSha: sha, headSha: sha }),
    (error) => error.code === "malformed_json",
  );
  assert.throws(
    () => projectAdvisory(JSON.stringify({ base_sha: sha, head_sha: sha, changed_files: ["../secret"] }), { baseSha: sha, headSha: sha }),
    (error) => error.code === "projection_invalid",
  );
});

test("fails closed when environment identity is incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-crg-"));
  try {
    mkdirSync(join(root, "run"), { recursive: true });
    const value = runCodeReviewGraph({
      command: "/missing/crg",
      projectRoot: root,
      runDirectory: join(root, "run"),
      dataDirectory: join(root, "run", "data"),
      environmentRoot: root,
      manifest: { entries: [] },
      interpreter: "/missing/python",
      baseSha: sha,
      headSha: sha,
    });
    assert.equal(value.status, "failed");
    assert.equal(value.error_class, "environment_integrity");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
