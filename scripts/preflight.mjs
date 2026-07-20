import { accessSync, constants, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length) {
      fail(`Invalid argument: ${key}`);
    }
    if (values[key] !== undefined) {
      fail(`Duplicate argument: ${key}`);
    }
    values[key] = argv[index + 1];
    index += 1;
  }
  for (const key of ["--project", "--mex-command", "--real-codex", "--ralphex-command"]) {
    if (!values[key]) {
      fail(`Missing required argument: ${key}`);
    }
  }
  return values;
}

function requireExecutable(command, label) {
  if (!isAbsolute(command)) {
    fail(`${label} must be an absolute path`);
  }
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
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function parseVersion(output, label) {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    fail(`Unable to parse ${label} version`);
  }
  return match.slice(1).map(Number);
}

function atLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

export function runPreflight(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const project = resolve(args["--project"]);
  const mex = args["--mex-command"];
  const codex = args["--real-codex"];
  const ralphex = args["--ralphex-command"];

  requireExecutable(mex, "MEX command");
  requireExecutable(codex, "Codex command");
  requireExecutable(ralphex, "Ralphex command");

  const gitRoot = run("/usr/bin/git", ["rev-parse", "--show-toplevel"], project, "Git root check");
  if (resolve(gitRoot) !== project) {
    fail("Project must be the exact Git root");
  }

  const agentAnchorExists = existsSync(resolve(project, "AGENTS.md")) || existsSync(resolve(project, ".mex", "AGENTS.md"));
  const routerExists = existsSync(resolve(project, "ROUTER.md")) || existsSync(resolve(project, ".mex", "ROUTER.md"));
  if (!agentAnchorExists || !routerExists) {
    fail("MEX scaffold is incomplete: AGENTS.md and ROUTER.md are required");
  }

  const mexJson = run(mex, ["check", "--json"], project, "MEX check");
  try {
    JSON.parse(mexJson);
  } catch {
    fail("MEX check did not return valid JSON");
  }

  const codexVersion = parseVersion(run(codex, ["--version"], project, "Codex version check"), "Codex");
  if (!atLeast(codexVersion, [0, 130, 0])) {
    fail("Codex CLI 0.130.0 or newer is required");
  }

  run(ralphex, ["--version"], project, "Ralphex version check");
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
