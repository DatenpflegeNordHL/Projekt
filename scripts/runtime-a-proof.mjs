#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "../src/bootstrap.mjs";
import { assertGitAuthority } from "../src/git-authority.mjs";
import { runPreflight } from "./preflight.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = realpathSync(resolve(dirname(THIS_FILE), ".."));

function fail(message) {
  throw new Error(message);
}

function safeEnv(sourceEnv = process.env) {
  return Object.fromEntries(
    ["HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP"].flatMap(
      (key) => (sourceEnv[key] === undefined ? [] : [[key, sourceEnv[key]]]),
    ),
  );
}

function run(command, args, { cwd, env = process.env, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: safeEnv(env),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function git(root, args) {
  return String(run("/usr/bin/git", args, { cwd: root }).stdout || "").trim();
}

function resolveCommand(name, explicit) {
  if (explicit) return realpathSync(explicit);
  const result = run("/usr/bin/env", ["sh", "-c", `command -v ${name}`], {
    cwd: REPO_ROOT,
    allowFailure: true,
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) {
    fail(`${name} was not found; pass --${name === "codex" ? "real-codex" : `${name}-command`} /absolute/path`);
  }
  return realpathSync(String(result.stdout).trim());
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set(["--real-codex", "--mex-command", "--ralphex-command", "--output"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key)) fail(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for ${key}`);
    if (values[key]) fail(`Duplicate argument: ${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function makeWritable(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) makeWritable(join(path, entry));
  } else {
    chmodSync(path, 0o600);
  }
}

function removeFixture(path) {
  makeWritable(path);
  rmSync(path, { recursive: true, force: true });
}

function createTargetFixture(root) {
  const project = join(root, "target project");
  mkdirSync(project, { recursive: true });
  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "Runtime A Proof"]);
  git(project, ["config", "user.email", "runtime-a-proof@example.invalid"]);
  writeFileSync(join(project, "README.md"), "# Runtime A proof target\n");
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-m", "chore: initialize Runtime A proof target"]);
  return realpathSync(project);
}

function commitBootstrapScaffold(project) {
  git(project, ["add", "--all"]);
  const status = git(project, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) git(project, ["commit", "-m", "chore: commit Runtime A proof scaffold"]);
  const remaining = git(project, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (remaining) fail(`Runtime A proof target is dirty after scaffold commit: ${remaining}`);
}

function assertSourceClean() {
  const status = git(REPO_ROOT, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (status) fail("Runtime A proof requires a clean candidate checkout");
}

function preflightArgs(project, tools, installed, branch, startSha) {
  return [
    "--project",
    project,
    "--mex-command",
    tools.mex,
    "--real-codex",
    tools.codex,
    "--ralphex-command",
    tools.ralphex,
    "--runtime-manifest",
    installed.runtimeManifest,
    "--runtime-manifest-sha256",
    installed.runtimeManifestSha256,
    "--expected-branch",
    branch,
    "--run-start-sha",
    startSha,
    "--expected-project-root",
    project,
  ];
}

function tamperWasRejected(error) {
  return (
    error?.code === "CODEXLOOPER_RUNTIME_INTEGRITY_FAILED" ||
    error?.code === "CODEXLOOPER_RUNTIME_PATH_INVALID" ||
    /Runtime file mode changed|Runtime file hash changed|integrity verification failed/u.test(String(error?.message || error))
  );
}

export function proveRuntimeA({
  codex,
  mex,
  ralphex,
  outputPath,
  now = () => new Date(),
} = {}) {
  assertSourceClean();
  const sourceCommit = git(REPO_ROOT, ["rev-parse", "HEAD"]);
  assert.match(sourceCommit, /^[0-9a-f]{40}$/);

  const root = mkdtempSync(join(tmpdir(), "codexlooper-runtime-a-proof-"));
  try {
    const project = createTargetFixture(root);
    const tools = {
      codex: realpathSync(codex),
      mex: realpathSync(mex),
      ralphex: realpathSync(ralphex),
    };

    const installed = bootstrap([
      "--project",
      project,
      "--project-name",
      "Runtime A Proof Target",
      "--real-codex",
      tools.codex,
      "--mex-command",
      tools.mex,
      "--ralphex-command",
      tools.ralphex,
      "--max-builder-calls",
      "1",
      "--max-reviewer-calls",
      "1",
      "--max-run-seconds",
      "60",
      "--max-estimated-cost-usd",
      "0.01",
      "--model-call-reserve-usd",
      "0.01",
      "--max-crg-builds",
      "0",
    ]);

    commitBootstrapScaffold(project);

    const state = JSON.parse(readFileSync(join(project, ".codexlooper", "install-state.json"), "utf8"));
    assert.equal(state.runtime.source_commit, sourceCommit);
    assert.equal(state.runtime.id, installed.runtimeId);
    assert.equal(state.runtime.manifest_sha256, installed.runtimeManifestSha256);
    assert.ok(installed.receipt.visible_changes.some((path) => path.startsWith(".mex/")));

    for (const wrapper of [
      installed.runCommand,
      installed.controlledCodex,
      installed.terraExecutor,
      installed.solReviewer,
      installed.ralphexVcsGuard,
    ]) {
      const content = readFileSync(wrapper, "utf8");
      assert.match(content, new RegExp(installed.runtimeDirectory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(
        content,
        new RegExp(`${REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?:src|bin|scripts)/`),
      );
    }

    const branch = git(project, ["branch", "--show-current"]);
    const startSha = git(project, ["rev-parse", "HEAD"]);
    const runtimeEnv = {
      ...process.env,
      CODEXLOOPER_RUNTIME_DIR: installed.runtimeDirectory,
      CODEXLOOPER_RUNTIME_MANIFEST: installed.runtimeManifest,
      CODEXLOOPER_RUNTIME_MANIFEST_SHA256: installed.runtimeManifestSha256,
    };

    assert.equal(
      runPreflight(preflightArgs(project, tools, installed, branch, startSha)),
      "CODEXLOOPER_PREFLIGHT=PASS",
    );

    git(project, ["switch", "-c", "runtime-a-unauthorised"]);
    assert.throws(
      () =>
        assertGitAuthority({
          projectRoot: project,
          expectedProjectRoot: project,
          expectedBranch: branch,
          runStartSha: startSha,
          sourceEnv: runtimeEnv,
          label: "Runtime A branch proof",
        }),
      (error) => error.code === "CODEXLOOPER_GIT_BRANCH_CHANGED",
    );
    git(project, ["switch", branch]);

    const tamperPath = join(installed.runtimeDirectory, "src", "run-policy.mjs");
    chmodSync(installed.runtimeDirectory, 0o700);
    chmodSync(join(installed.runtimeDirectory, "src"), 0o700);
    chmodSync(tamperPath, 0o600);
    appendFileSync(tamperPath, "\n// runtime-a-proof-tamper\n");
    assert.throws(
      () => runPreflight(preflightArgs(project, tools, installed, branch, startSha)),
      tamperWasRejected,
    );

    const evidence = {
      schema: "codexlooper.runtime-a-local-proof.v1",
      status: "PASS",
      created_at: now().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      source_commit: sourceCommit,
      runtime_id: installed.runtimeId,
      runtime_manifest_sha256: installed.runtimeManifestSha256,
      tools: {
        codex: { path: state.real_codex, version: state.codex_version },
        mex: { path: state.mex_command, version: state.mex_version },
        ralphex: { path: state.ralphex_command, version: state.ralphex_version },
      },
      checks: {
        source_checkout_clean: true,
        mex_scaffold_initialized: true,
        wrappers_use_immutable_runtime: true,
        initial_preflight: "PASS",
        branch_drift_rejected: true,
        runtime_tamper_rejected: true,
        paid_model_calls: 0,
        crg_builds: 0,
      },
    };

    if (outputPath) {
      const target = resolve(outputPath);
      writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    }
    return evidence;
  } finally {
    removeFixture(root);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const evidence = proveRuntimeA({
      codex: resolveCommand("codex", args["--real-codex"]),
      mex: resolveCommand("mex", args["--mex-command"]),
      ralphex: resolveCommand("ralphex", args["--ralphex-command"]),
      outputPath: args["--output"],
    });
    process.stdout.write("CODEXLOOPER_RUNTIME_A_PROOF=PASS\n");
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`CODEXLOOPER_RUNTIME_A_PROOF=BLOCK: ${error.message}\n`);
    process.exitCode = 1;
  }
}
