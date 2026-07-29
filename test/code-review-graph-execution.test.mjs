import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { CRG_VERSION, executeCrgStandalone } from "../src/code-review-graph.mjs";

function fixture() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codexlooper-crg-execution-")));
  const project = resolve(root, "project");
  const run = resolve(project, ".codexlooper", "runs", "run-1");
  mkdirSync(run, { recursive: true, mode: 0o700 });
  chmodSync(run, 0o700);
  return {
    root,
    project,
    run,
    launch: Object.freeze({
      executable: "/usr/bin/true",
      args: Object.freeze([]),
      shell: false,
      env: Object.freeze({ PATH: "/usr/bin:/bin" }),
    }),
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

function execute(value, extra = {}) {
  return executeCrgStandalone({
    launch: value.launch,
    operation: "version",
    projectRoot: value.project,
    runDir: value.run,
    ...extra,
  });
}

test("executes only the shell-free launch contract and stores a redacted private report", () => {
  withFixture((value) => {
    let invocation;
    const result = execute(value, {
      spawnSyncImpl(command, args, options) {
        invocation = { command, args, options };
        return { status: 0, stdout: Buffer.from(`code-review-graph ${CRG_VERSION}\n`), stderr: Buffer.from("token=secret-value") };
      },
    });
    assert.equal(result.status, "available");
    assert.equal(result.report_path, ".codexlooper/runs/run-1/crg-version-report.json");
    assert.equal(invocation.command, "/usr/bin/true");
    assert.deepEqual(invocation.args, []);
    assert.equal(invocation.options.shell, false);
    assert.equal(invocation.options.cwd, value.project);
    assert.equal(invocation.options.env.CLOSEROUTER_API_KEY, undefined);
    const report = readFileSync(resolve(value.run, "crg-version-report.json"), "utf8");
    assert.equal(report.includes("secret-value"), false);
    assert.match(report, /\[REDACTED\]/u);
    assert.equal(statSync(resolve(value.run, "crg-version-report.json")).mode & 0o777, 0o600);
  });
});

test("classifies timeout, output and non-zero failures without a real CRG process", () => {
  withFixture((value) => {
    const timeout = execute(value, { spawnSyncImpl: () => ({ error: { code: "ETIMEDOUT" } }) });
    assert.equal(timeout.error_class, "timeout");
    assert.equal(timeout.report_path, ".codexlooper/runs/run-1/crg-version-report.json");
  });
  withFixture((value) => {
    const output = execute(value, {
      maxOutputBytes: 4,
      spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from("12345"), stderr: Buffer.alloc(0) }),
    });
    assert.equal(output.error_class, "output_limit");
    assert.equal(output.truncated, true);
  });
  withFixture((value) => {
    const failed = execute(value, { spawnSyncImpl: () => ({ status: 17, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) });
    assert.equal(failed.error_class, "non_zero_exit");
  });
});

test("projects detect output and rejects unsafe launches and private report limits", () => {
  withFixture((value) => {
    const result = execute(value, {
      operation: "detect-changes",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from("No changes detected."), stderr: Buffer.alloc(0) }),
    });
    assert.equal(result.status, "available");
    assert.deepEqual(result.advisory.changed_files, []);
  });
  withFixture((value) => {
    const limited = execute(value, {
      maxReportBytes: 1,
      spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from(`code-review-graph ${CRG_VERSION}`), stderr: Buffer.alloc(0) }),
    });
    assert.equal(limited.error_class, "output_limit");
    assert.equal(limited.truncated, true);
    assert.equal(limited.report_path, null);
  });
  withFixture((value) => {
    assert.throws(
      () => execute(value, { launch: { ...value.launch, shell: true } }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
  });
});
