import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createCrgMacosSandboxLaunch } from "../src/code-review-graph.mjs";

function fixture() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), "codexlooper-crg-sandbox-")));
  const project = resolve(root, "project");
  const run = resolve(root, "run");
  const environment = resolve(root, "environment");
  const bin = resolve(environment, "bin");
  const pythonRuntimeParent = resolve(root, "uv-python");
  const pythonRuntimeRoot = resolve(pythonRuntimeParent, "cpython-3.13.14");
  const pythonAlias = resolve(pythonRuntimeParent, "cpython-3.13");
  const interpreter = resolve(pythonRuntimeRoot, "bin", "python3.13");
  const launcher = resolve(bin, "python");
  const command = resolve(bin, "code-review-graph");
  const sandbox = resolve(root, "sandbox-exec");
  mkdirSync(project);
  mkdirSync(run);
  mkdirSync(bin, { recursive: true });
  mkdirSync(resolve(pythonRuntimeRoot, "bin"), { recursive: true });
  copyFileSync("/usr/bin/true", interpreter);
  chmodSync(interpreter, 0o755);
  symlinkSync(pythonRuntimeRoot, pythonAlias);
  symlinkSync(resolve(pythonAlias, "bin", "python3.13"), launcher);
  writeFileSync(command, `#!${launcher}\n`);
  chmodSync(command, 0o755);
  writeFileSync(sandbox, `#!/bin/sh
case "$2" in
  *${pythonRuntimeRoot}*) echo 'code-review-graph 2.3.6' ;;
  *) exit 71 ;;
esac
`, { mode: 0o755 });
  chmodSync(sandbox, 0o755);
  return { root, project, run, environment, pythonRuntimeRoot, pythonAlias, interpreter, launcher, command, sandbox };
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
      pythonRuntimeRoot: value.pythonRuntimeRoot,
      sandboxCommand: value.sandbox,
    });
    assert.equal(launch.executable, value.sandbox);
    assert.deepEqual(launch.args, ["-p", launch.profile, value.command, "--version"]);
    assert.equal(launch.shell, false);
    assert.equal(launch.env.CRG_PARSE_EXECUTOR, "thread");
    assert.equal(launch.env.CRG_PARSE_WORKERS, "1");
    assert.match(launch.profile, /^\(deny network\*\)$/m);
    assert.match(launch.profile, new RegExp(`process-exec\\* \\(literal "${value.command}"\\)`));
    assert.match(launch.profile, new RegExp(`process-exec\\* \\(literal "${value.launcher}"\\)`));
    assert.match(launch.profile, new RegExp(`process-exec\\* \\(literal "${value.interpreter}"\\)`));
    assert.doesNotMatch(launch.profile, /^\(allow process\*\)$/m);
    assert.match(launch.profile, new RegExp(`file-write\\* \\(subpath "${value.run}"\\)`));
    assert.match(launch.profile, /^\(allow file-read\* \(literal "\/"\)\)$/m);
    assert.match(launch.profile, new RegExp(`file-read\\* \\(subpath "${value.pythonRuntimeRoot}"\\)`));
    assert.match(launch.profile_sha256, /^[a-f0-9]{64}$/);
  });
});

test("real macOS sandbox-exec permits the sealed launcher rather than denying execvp", { skip: platform() !== "darwin" }, () => {
  withFixture((value) => {
    const launch = createCrgMacosSandboxLaunch({
      projectRoot: value.project,
      runDir: value.run,
      environmentRoot: value.environment,
      interpreterPath: value.interpreter,
      commandPath: value.command,
      pythonRuntimeRoot: value.pythonRuntimeRoot,
      sandboxCommand: "/usr/bin/sandbox-exec",
    });
    const result = spawnSync(launch.executable, launch.args, {
      encoding: "utf8",
      env: launch.env,
      shell: false,
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

test("rejects command and interpreter substitutions, symlink escapes, and outside runtime roots", () => {
  withFixture((value) => {
    const options = {
      projectRoot: value.project,
      runDir: value.run,
      environmentRoot: value.environment,
      interpreterPath: value.interpreter,
      commandPath: value.command,
      pythonRuntimeRoot: value.pythonRuntimeRoot,
      sandboxCommand: value.sandbox,
    };
    const outside = resolve(value.root, "outside-command");
    writeFileSync(outside, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    chmodSync(outside, 0o755);
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, commandPath: outside }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, pythonRuntimeRoot: value.environment }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
    const linkedCommand = resolve(value.environment, "bin", "linked-command");
    symlinkSync(value.command, linkedCommand);
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, commandPath: linkedCommand }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
    const outsideInterpreter = resolve(value.root, "outside-interpreter");
    copyFileSync(value.interpreter, outsideInterpreter);
    chmodSync(outsideInterpreter, 0o755);
    assert.throws(
      () => createCrgMacosSandboxLaunch({ ...options, interpreterPath: outsideInterpreter }),
      (error) => error.code === "CODEXLOOPER_CRG_UNSAFE_COMMAND",
    );
  });
});

test("rejects substituted, escaped, altered, and malformed shebang launcher chains", () => {
  withFixture((value) => {
    const options = {
      projectRoot: value.project, runDir: value.run, environmentRoot: value.environment,
      interpreterPath: value.interpreter, commandPath: value.command,
      pythonRuntimeRoot: value.pythonRuntimeRoot, sandboxCommand: value.sandbox,
    };
    writeFileSync(value.command, "#!/bin/sh\n", { mode: 0o755 });
    assert.throws(() => createCrgMacosSandboxLaunch(options), /sealed environment Python launcher/);
    writeFileSync(value.command, "not-a-shebang\n", { mode: 0o755 });
    assert.throws(() => createCrgMacosSandboxLaunch(options), /bounded absolute shebang/);
    writeFileSync(value.command, `#!${value.launcher}\n`, { mode: 0o755 });
    rmSync(value.launcher);
    assert.throws(() => createCrgMacosSandboxLaunch(options), /readable symlink/);
    const hop = resolve(value.environment, "bin", "python-hop");
    symlinkSync(value.interpreter, hop);
    symlinkSync(hop, value.launcher);
    assert.throws(() => createCrgMacosSandboxLaunch(options), /directly target the sealed interpreter/);
    rmSync(value.launcher);
    const escape = resolve(value.root, "escaped-python");
    copyFileSync(value.interpreter, escape);
    chmodSync(escape, 0o755);
    symlinkSync(escape, value.launcher);
    assert.throws(() => createCrgMacosSandboxLaunch(options), /directly target the sealed interpreter/);
  });
});

test("rejects a retargeted uv parent alias", () => {
  withFixture((value) => {
    const options = { projectRoot: value.project, runDir: value.run, environmentRoot: value.environment, interpreterPath: value.interpreter, commandPath: value.command, pythonRuntimeRoot: value.pythonRuntimeRoot, sandboxCommand: value.sandbox };
    const altered = resolve(value.root, "uv-python", "cpython-altered");
    mkdirSync(resolve(altered, "bin"), { recursive: true });
    copyFileSync(value.interpreter, resolve(altered, "bin", "python3.13"));
    chmodSync(resolve(altered, "bin", "python3.13"), 0o755);
    rmSync(value.pythonAlias);
    symlinkSync(altered, value.pythonAlias);
    assert.throws(() => createCrgMacosSandboxLaunch(options), /directly target the sealed interpreter/);
  });
});

test("permits a controlled external uv-like Python runtime for sandboxed CRG version startup", () => {
  withFixture((value) => {
    const launch = createCrgMacosSandboxLaunch({
      projectRoot: value.project,
      runDir: value.run,
      environmentRoot: value.environment,
      interpreterPath: value.interpreter,
      commandPath: value.command,
      sandboxCommand: value.sandbox,
      pythonRuntimeRoot: value.pythonRuntimeRoot,
    });
    const result = spawnSync(launch.executable, launch.args, { encoding: "utf8", env: launch.env, shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "code-review-graph 2.3.6");
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
      pythonRuntimeRoot: value.pythonRuntimeRoot,
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
      pythonRuntimeRoot: value.pythonRuntimeRoot,
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
