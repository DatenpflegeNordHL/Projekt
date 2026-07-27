import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  CRG_ENVIRONMENT_MANIFEST_SCHEMA,
  CRG_LEGACY_REPOSITORY_PATHS,
  assertNoLegacyCrgRepositoryState,
  captureCrgEnvironmentIdentity,
  createCrgChildEnvironment,
  validateCrgPrivatePaths,
  verifyCrgEnvironmentIdentity,
  verifyLegacyCrgRepositoryState,
} from "../src/code-review-graph.mjs";

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "codexlooper-crg-foundation-"));
  const project = resolve(root, "project");
  const run = resolve(root, "run");
  const environment = resolve(root, "environment");
  const bin = resolve(environment, "bin");
  const interpreter = resolve(root, "python");
  const command = resolve(bin, "code-review-graph");
  mkdirSync(project);
  mkdirSync(run);
  mkdirSync(bin, { recursive: true });
  writeFileSync(interpreter, "interpreter\n");
  writeFileSync(command, "command\n");
  chmodSync(interpreter, 0o755);
  chmodSync(command, 0o755);
  symlinkSync(interpreter, resolve(bin, "python3"));
  return { root, project, run, environment, interpreter, command };
}

function withFixture(callback) {
  const value = fixture();
  try {
    callback(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}

test("captures and verifies the complete sealed CRG environment identity", () => {
  withFixture(({ environment, interpreter, command }) => {
    const manifest = captureCrgEnvironmentIdentity({ environmentRoot: environment, interpreterPath: interpreter, commandPath: command });
    assert.equal(manifest.schema, CRG_ENVIRONMENT_MANIFEST_SCHEMA);
    assert.equal(manifest.command.path, command);
    assert.equal(manifest.interpreter.path, interpreter);
    assert.deepEqual(
      verifyCrgEnvironmentIdentity({ environmentRoot: environment, interpreterPath: interpreter, commandPath: command, manifest }),
      manifest,
    );
  });
});

test("rejects changed, added, missing, and mode-changed sealed environment entries", () => {
  for (const mutation of [
    ({ environment }) => writeFileSync(resolve(environment, "added"), "added\n"),
    ({ command }) => writeFileSync(command, "changed\n"),
    ({ command }) => chmodSync(command, 0o700),
    ({ environment }) => rmSync(resolve(environment, "bin", "python3")),
  ]) {
    withFixture((value) => {
      const manifest = captureCrgEnvironmentIdentity({ environmentRoot: value.environment, interpreterPath: value.interpreter, commandPath: value.command });
      mutation(value);
      assert.throws(
        () => verifyCrgEnvironmentIdentity({ environmentRoot: value.environment, interpreterPath: value.interpreter, commandPath: value.command, manifest }),
        (error) => error.code === "CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY",
      );
    });
  }
});

test("allows only expected external Python launcher symlinks", () => {
  withFixture(({ environment, interpreter, command }) => {
    mkdirSync(resolve(environment, "lib"));
    symlinkSync(interpreter, resolve(environment, "lib", "escape"));
    assert.throws(
      () => captureCrgEnvironmentIdentity({ environmentRoot: environment, interpreterPath: interpreter, commandPath: command }),
      (error) => error.code === "CODEXLOOPER_CRG_ENVIRONMENT_INTEGRITY",
    );
  });
});

test("rejects relative, missing, non-executable, and symlink CRG commands", () => {
  withFixture(({ environment, interpreter, command }) => {
    for (const candidate of ["relative-command", resolve(environment, "missing")]) {
      assert.throws(
        () => captureCrgEnvironmentIdentity({ environmentRoot: environment, interpreterPath: interpreter, commandPath: candidate }),
        (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
      );
    }
    chmodSync(command, 0o644);
    assert.throws(
      () => captureCrgEnvironmentIdentity({ environmentRoot: environment, interpreterPath: interpreter, commandPath: command }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
  });
  withFixture(({ environment, interpreter, command }) => {
    const linkedCommand = resolve(environment, "bin", "linked-command");
    symlinkSync(command, linkedCommand);
    assert.throws(
      () => captureCrgEnvironmentIdentity({ environmentRoot: environment, interpreterPath: interpreter, commandPath: linkedCommand }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
  });
});

test("creates an exact minimal non-secret CRG child environment", () => {
  withFixture(({ project, run }) => {
    const environment = createCrgChildEnvironment({ projectRoot: project, runDir: run, sourceEnv: { CRG_DATA_DIR: "bad", PYTHONPATH: "bad", CLOSE_ROUTER_API_KEY: "secret" } });
    assert.deepEqual(environment, {
      HOME: resolve(run, "crg-home"),
      CRG_DATA_DIR: resolve(run, "crg-data"),
      CRG_REPO_ROOT: project,
      CRG_PARSE_EXECUTOR: "thread",
      CRG_PARSE_WORKERS: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONSAFEPATH: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      DO_NOT_TRACK: "1",
      NO_COLOR: "1",
      PATH: "/usr/bin:/bin",
    });
    assert.equal("CLOSE_ROUTER_API_KEY" in environment, false);
    assert.throws(
      () => validateCrgPrivatePaths({ projectRoot: project, runDir: run, dataDir: resolve(project, "outside") }),
      (error) => error.code === "CODEXLOOPER_CRG_PRIVATE_PATH_INVALID",
    );
  });
});

test("rejects legacy CRG database files before and after a repository-state capture", () => {
  withFixture(({ project }) => {
    const snapshot = assertNoLegacyCrgRepositoryState(project);
    assert.deepEqual(verifyLegacyCrgRepositoryState(snapshot), snapshot);
    for (const name of CRG_LEGACY_REPOSITORY_PATHS) {
      writeFileSync(resolve(project, name), "legacy\n");
      assert.throws(
        () => assertNoLegacyCrgRepositoryState(project),
        (error) => error.code === "CODEXLOOPER_CRG_LEGACY_REPOSITORY_STATE",
      );
      rmSync(resolve(project, name));
    }
    writeFileSync(resolve(project, CRG_LEGACY_REPOSITORY_PATHS[0]), "legacy\n");
    assert.throws(
      () => verifyLegacyCrgRepositoryState(snapshot),
      (error) => error.code === "CODEXLOOPER_CRG_LEGACY_REPOSITORY_STATE",
    );
  });
});
