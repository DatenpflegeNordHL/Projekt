import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createCrgMacosSandboxLaunch } from "../src/code-review-graph.mjs";

function fixture() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codexlooper-crg-sandbox-")));
  const project = resolve(root, "project");
  const run = resolve(root, "run");
  const environment = resolve(root, "environment");
  const bin = resolve(environment, "bin");
  const interpreter = resolve(root, "python");
  const command = resolve(bin, "code-review-graph");
  const sandbox = resolve(root, "sandbox-exec");
  mkdirSync(project);
  mkdirSync(run);
  mkdirSync(bin, { recursive: true });
  for (const path of [interpreter, command, sandbox]) {
    writeFileSync(path, "#!/bin/sh\nexit 0\n");
    chmodSync(path, 0o755);
  }
  return { root, project, run, environment, interpreter, command, sandbox };
}

function withFixture(callback) {
  const value = fixture();
  try {
    callback(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}

test("constructs a pinned static macOS sandbox launch without executing CRG", () => {
  withFixture((value) => {
    const launch = createCrgMacosSandboxLaunch({
      projectRoot: value.project,
      runDir: value.run,
      environmentRoot: value.environment,
      interpreterPath: value.interpreter,
      commandPath: value.command,
      sandboxCommand: value.sandbox,
    });
    assert.equal(launch.executable, value.sandbox);
    assert.deepEqual(launch.args, ["-p", launch.profile, value.command, "--version"]);
    assert.equal(launch.shell, false);
    assert.equal(launch.env.CRG_PARSE_EXECUTOR, "thread");
    assert.equal(launch.env.CRG_PARSE_WORKERS, "1");
    assert.match(launch.profile, /^\(deny network\*\)$/m);
    assert.match(launch.profile, new RegExp(`file-write\\* \\(subpath "${value.run}"\\)`));
    assert.match(launch.profile_sha256, /^[a-f0-9]{64}$/);
  });
});

test("rejects unavailable sandboxes, unsafe private paths, and profile mismatches", () => {
  withFixture((value) => {
    const options = {
      projectRoot: value.project,
      runDir: value.run,
      environmentRoot: value.environment,
      interpreterPath: value.interpreter,
      commandPath: value.command,
      sandboxCommand: value.sandbox,
    };
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, sandboxCommand: resolve(value.root, "missing-sandbox") }),
      (error) => error.code === "CODEXLOOPER_CRG_SANDBOX_UNAVAILABLE",
    );
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, projectRoot: "relative-project" }),
      (error) => error.code === "CODEXLOOPER_CRG_PRIVATE_PATH_INVALID",
    );
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, expectedProfileSha256: "0".repeat(64) }),
      (error) => error.code === "CODEXLOOPER_CRG_SANDBOX_DENIED",
    );
  });
});

test("allows only the pinned CRG argument arrays", () => {
  withFixture((value) => {
    const options = {
      projectRoot: value.project,
      runDir: value.run,
      environmentRoot: value.environment,
      interpreterPath: value.interpreter,
      commandPath: value.command,
      sandboxCommand: value.sandbox,
    };
    const build = createCrgMacosSandboxLaunch({ ...options, operation: "build" });
    assert.deepEqual(build.args.slice(2), [
      value.command,
      "build",
      "--repo",
      value.project,
      "--skip-flows",
      "--data-dir",
      resolve(value.run, "crg-data"),
    ]);
    const detect = createCrgMacosSandboxLaunch({ ...options, operation: "detect-changes", baseSha: "a".repeat(40) });
    assert.deepEqual(detect.args.slice(2), [
      value.command,
      "detect-changes",
      "--repo",
      value.project,
      "--base",
      "a".repeat(40),
    ]);
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, operation: "install" }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, operation: "detect-changes", baseSha: "not-a-sha" }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
  });
});
