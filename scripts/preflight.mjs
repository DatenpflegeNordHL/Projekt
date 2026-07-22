import { accessSync, constants, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertGitAuthority } from "../src/git-authority.mjs";
import { verifyRuntimeManifest } from "../src/runtime-integrity.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const REQUIRED_ARGUMENTS = ["--project", "--mex-command", "--real-codex", "--ralphex-command"];
const OPTIONAL_ARGUMENTS = new Set([
  "--runtime-manifest",
  "--runtime-manifest-sha256",
  "--expected-branch",
  "--run-start-sha",
  "--expected-project-root",
]);
const ALLOWED_ARGUMENTS = new Set([...REQUIRED_ARGUMENTS, ...OPTIONAL_ARGUMENTS]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!ALLOWED_ARGUMENTS.has(key)) fail(`Unknown argument: ${key}`);
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      fail(`Missing value for argument: ${key}`);
    }
    if (values[key] !== undefined) fail(`Duplicate argument: ${key}`);
    values[key] = argv[index + 1];
    index += 1;
  }
  for (const key of REQUIRED_ARGUMENTS) {
    if (!values[key]) fail(`Missing required argument: ${key}`);
  }
  return values;
}

function requireExecutable(command, label) {
  if (!isAbsolute(command)) fail(`${label} must be an absolute path`);
  try {
    accessSync(command, constants.X_OK);
  } catch {
    fail(`${label} is not executable: ${command}`);
  }
}

function safeProbeEnv() {
  const env = { DO_NOT_TRACK: "1" };
  for (const key of ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: safeProbeEnv(),
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function parseVersion(output, label) {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) fail(`Unable to parse ${label} version`);
  return match.slice(1).map(Number);
}

function atLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function optionalAuthority(args, project) {
  const expectedBranch = args["--expected-branch"] || process.env.CODEXLOOPER_EXPECTED_BRANCH;
  const runStartSha = args["--run-start-sha"] || process.env.CODEXLOOPER_RUN_START_SHA;
  const expectedProjectRoot =
    args["--expected-project-root"] || process.env.CODEXLOOPER_EXPECTED_PROJECT_ROOT;
  const configured = [expectedBranch, runStartSha, expectedProjectRoot].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) fail("Git authority evidence is incomplete");
  return assertGitAuthority({
    projectRoot: project,
    expectedProjectRoot,
    expectedBranch,
    runStartSha,
    sourceEnv: process.env,
    label: "Preflight Git authority",
  });
}

function verifiedRuntime(manifestPath, manifestSha256) {
  try {
    return verifyRuntimeManifest({
      manifestPath,
      expectedManifestSha256: manifestSha256,
      expectedRuntimeDirectory: process.env.CODEXLOOPER_RUNTIME_DIR,
      expectedNodeExecutable: process.execPath,
    });
  } catch (error) {
    fail(`Runtime file mode changed or integrity verification failed: ${error.message}`);
  }
}

export function runPreflight(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const project = resolve(args["--project"]);
  const mex = args["--mex-command"];
  const codex = args["--real-codex"];
  const ralphex = args["--ralphex-command"];
  const manifestPath = args["--runtime-manifest"] || process.env.CODEXLOOPER_RUNTIME_MANIFEST;
  const manifestSha256 =
    args["--runtime-manifest-sha256"] || process.env.CODEXLOOPER_RUNTIME_MANIFEST_SHA256;
  if (!manifestPath || !manifestSha256) fail("Immutable runtime manifest evidence is required");

  const runtime = verifiedRuntime(manifestPath, manifestSha256);
  const expectedSourceCommit = process.env.CODEXLOOPER_RUNTIME_SOURCE_COMMIT;
  if (expectedSourceCommit && runtime.manifest.source_commit !== expectedSourceCommit) {
    fail("Runtime source commit does not match the installed launcher");
  }

  optionalAuthority(args, project);
  requireExecutable(mex, "MEX command");
  requireExecutable(codex, "Codex command");
  requireExecutable(ralphex, "Ralphex command");

  const gitRoot = run("/usr/bin/git", ["rev-parse", "--show-toplevel"], project, "Git root check");
  if (resolve(gitRoot) !== project) fail("Project must be the exact Git root");

  const agentAnchorExists =
    existsSync(resolve(project, "AGENTS.md")) || existsSync(resolve(project, ".mex", "AGENTS.md"));
  const routerExists =
    existsSync(resolve(project, "ROUTER.md")) || existsSync(resolve(project, ".mex", "ROUTER.md"));
  if (!agentAnchorExists || !routerExists) {
    fail("MEX scaffold is incomplete: AGENTS.md and ROUTER.md are required");
  }

  const mexJson = run(mex, ["check", "--json"], project, "MEX check");
  let mexReport;
  try {
    mexReport = JSON.parse(mexJson);
  } catch {
    fail("MEX check did not return valid JSON");
  }
  if (!mexReport || typeof mexReport !== "object" || Array.isArray(mexReport)) {
    fail("MEX check returned an invalid report object");
  }

  const mexVersion = parseVersion(run(mex, ["--version"], project, "MEX version check"), "MEX");
  if (!atLeast(mexVersion, [0, 6, 3])) fail("MEX 0.6.3 or newer is required");

  const codexVersion = parseVersion(run(codex, ["--version"], project, "Codex version check"), "Codex");
  if (!atLeast(codexVersion, [0, 130, 0])) fail("Codex CLI 0.130.0 or newer is required");

  const ralphexVersion = parseVersion(
    run(ralphex, ["--version"], project, "Ralphex version check"),
    "Ralphex",
  );
  if (!atLeast(ralphexVersion, [1, 6, 0])) fail("Ralphex 1.6.0 or newer is required");
  optionalAuthority(args, project);
  return "CODEXLOOPER_PREFLIGHT=PASS";
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  try {
    process.stdout.write(`${runPreflight()}\n`);
  } catch (error) {
    process.stderr.write(`CODEXLOOPER_PREFLIGHT=BLOCK: ${error.message}\n`);
    process.exitCode = 1;
  }
}
