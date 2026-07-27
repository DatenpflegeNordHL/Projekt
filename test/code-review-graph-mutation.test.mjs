import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { CRG_VERSION, captureCrgRepositoryState, executeCrgStandalone, verifyCrgRepositoryState } from "../src/code-review-graph.mjs";

function fixture() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codexlooper-crg-mutation-")));
  const project = resolve(root, "project");
  const run = resolve(project, ".codexlooper", "runs", "run-1");
  mkdirSync(resolve(project, ".git"), { recursive: true, mode: 0o700 });
  mkdirSync(run, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(project, "tracked.txt"), "before\n", { mode: 0o644 });
  writeFileSync(resolve(project, ".git", "index"), "metadata-before\n", { mode: 0o600 });
  return {
    root,
    project,
    run,
    launch: Object.freeze({ executable: "/usr/bin/true", args: Object.freeze([]), shell: false, env: Object.freeze({ PATH: "/usr/bin:/bin" }) }),
  };
}

function withFixture(callback) {
  const value = fixture();
  try {
    callback(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}

function execute(value, mutate) {
  return executeCrgStandalone({
    launch: value.launch,
    operation: "version",
    projectRoot: value.project,
    runDir: value.run,
    spawnSyncImpl: () => {
      mutate?.(value);
      return { status: 0, stdout: Buffer.from(`code-review-graph ${CRG_VERSION}\n`), stderr: Buffer.alloc(0) };
    },
  });
}

test("permits only the private report delta around standalone execution", () => {
  withFixture((value) => {
    const snapshot = captureCrgRepositoryState({ projectRoot: value.project, runDir: value.run });
    const result = execute(value);
    assert.equal(result.status, "available");
    assert.deepEqual(verifyCrgRepositoryState(snapshot), snapshot);
  });
});

test("permits writes only in the sealed CRG cache data directory", () => {
  withFixture((value) => {
    const cache = resolve(value.project, ".codexlooper", "crg-cache");
    const data = resolve(cache, "a".repeat(64) + ".data");
    mkdirSync(data, { recursive: true, mode: 0o700 });
    chmodSync(cache, 0o700);
    chmodSync(data, 0o700);
    const result = executeCrgStandalone({
      launch: value.launch,
      operation: "build",
      projectRoot: value.project,
      runDir: value.run,
      dataDir: data,
      spawnSyncImpl: () => {
        writeFileSync(resolve(data, "graph"), "sealed\n", { mode: 0o600 });
        return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      },
    });
    assert.equal(result.status, "available");
  });
});

test("fails closed for tracked, untracked, deleted, renamed, mode, symlink, and Git metadata mutations", () => {
  const mutations = [
    (value) => writeFileSync(resolve(value.project, "tracked.txt"), "changed\n"),
    (value) => writeFileSync(resolve(value.project, "untracked.txt"), "new\n"),
    (value) => unlinkSync(resolve(value.project, "tracked.txt")),
    (value) => renameSync(resolve(value.project, "tracked.txt"), resolve(value.project, "renamed.txt")),
    (value) => chmodSync(resolve(value.project, "tracked.txt"), 0o700),
    (value) => symlinkSync("tracked.txt", resolve(value.project, "linked.txt")),
    (value) => writeFileSync(resolve(value.project, ".git", "index"), "metadata-after\n"),
  ];
  for (const mutate of mutations) {
    withFixture((value) => {
      const result = execute(value, mutate);
      assert.equal(result.status, "failed");
      assert.equal(result.error_class, "repository_mutation");
    });
  }
});

test("rejects snapshots whose private run directory is outside the canonical private hierarchy", () => {
  withFixture((value) => {
    assert.throws(
      () => captureCrgRepositoryState({ projectRoot: value.project, runDir: value.root }),
      (error) => error.code === "CODEXLOOPER_CRG_PRIVATE_PATH_INVALID",
    );
  });
});
