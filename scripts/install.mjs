import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = resolve(REPO_ROOT, "bin", "codex-closerouter.mjs");
const PREFLIGHT = resolve(REPO_ROOT, "scripts", "preflight.mjs");
const ALLOWED_REASONING = new Set(["low", "medium", "high"]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = {
    "--builder-model": "openai/gpt-5.6-terra",
    "--review-model": "openai/gpt-5.6-sol",
    "--builder-reasoning": "medium",
    "--review-reasoning": "medium",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length) {
      fail(`Invalid argument: ${key}`);
    }
    if (Object.hasOwn(values, key) && !["--builder-model", "--review-model", "--builder-reasoning", "--review-reasoning"].includes(key)) {
      fail(`Duplicate argument: ${key}`);
    }
    values[key] = argv[index + 1];
    index += 1;
  }
  for (const key of ["--project", "--real-codex", "--mex-command", "--ralphex-command"]) {
    if (!values[key]) fail(`Missing required argument: ${key}`);
  }
  return values;
}

function requireAbsoluteExecutable(command, label) {
  if (!isAbsolute(command)) fail(`${label} must be an absolute path`);
  try {
    accessSync(command, constants.X_OK);
  } catch {
    fail(`${label} is not executable: ${command}`);
  }
}

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
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

function shellQuote(value) {
  if (value.includes("\0") || value.includes("\n")) fail("Unsafe path value");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function iniValue(value) {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) fail("Unsafe configuration value");
  return value;
}

function writeAtomic(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function install(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const project = resolve(args["--project"]);
  const realCodex = args["--real-codex"];
  const mexCommand = args["--mex-command"];
  const ralphexCommand = args["--ralphex-command"];
  const builderModel = args["--builder-model"];
  const reviewModel = args["--review-model"];
  const builderReasoning = args["--builder-reasoning"];
  const reviewReasoning = args["--review-reasoning"];

  for (const [command, label] of [
    [realCodex, "Codex command"],
    [mexCommand, "MEX command"],
    [ralphexCommand, "Ralphex command"],
  ]) {
    requireAbsoluteExecutable(command, label);
  }
  if (!ALLOWED_REASONING.has(builderReasoning) || !ALLOWED_REASONING.has(reviewReasoning)) {
    fail("Reasoning must be low, medium or high");
  }
  if (!builderModel || !reviewModel || builderModel === reviewModel) {
    fail("Builder and reviewer must use distinct explicit model IDs");
  }

  const gitRoot = run("/usr/bin/git", ["rev-parse", "--show-toplevel"], project, "Git root check");
  if (resolve(gitRoot) !== project) fail("Project must be the exact Git root");

  const codexVersionText = run(realCodex, ["--version"], project, "Codex version check");
  const codexVersion = parseVersion(codexVersionText, "Codex");
  if (!atLeast(codexVersion, [0, 130, 0])) fail("Codex CLI 0.130.0 or newer is required");
  const ralphexVersionText = run(ralphexCommand, ["--version"], project, "Ralphex version check");

  const home = resolve(project, ".codexlooper");
  const binDir = resolve(home, "bin");
  const codexHome = resolve(home, "codex-home");
  const controlledCodex = resolve(binDir, "codex");
  const runCommand = resolve(binDir, "codexlooper");
  const ralphexConfig = resolve(project, ".ralphex", "config");

  const codexConfig = `model_provider = "closerouter"\n\n[model_providers.closerouter]\nname = "CloseRouter"\nbase_url = "https://api.closerouter.dev/v1"\nenv_key = "CLOSEROUTER_API_KEY"\nwire_api = "responses"\nrequest_max_retries = 2\nstream_max_retries = 2\nstream_idle_timeout_ms = 120000\nrequires_openai_auth = false\nsupports_websockets = false\n`;
  writeAtomic(resolve(codexHome, "config.toml"), codexConfig, 0o600);

  const allowedModels = `${builderModel},${reviewModel}`;
  const launcherScript = `#!/bin/sh\nset -eu\nexport CODEXLOOPER_REAL_CODEX=${shellQuote(realCodex)}\nexport CODEX_HOME=${shellQuote(codexHome)}\nexport CODEXLOOPER_ALLOWED_MODELS=${shellQuote(allowedModels)}\nexec ${shellQuote(process.execPath)} ${shellQuote(LAUNCHER)} "$@"\n`;
  writeAtomic(controlledCodex, launcherScript, 0o700);

  const config = `executor = codex\npass_claude_md = false\ncodex_command = ${iniValue(controlledCodex)}\nplan_model = ${iniValue(`${builderModel}:${builderReasoning}`)}\ntask_model = ${iniValue(`${builderModel}:${builderReasoning}`)}\nreview_model = ${iniValue(`${reviewModel}:${reviewReasoning}`)}\ncodex_model =\ncodex_reasoning_effort =\ncodex_timeout_ms = 3600000\ncodex_sandbox = workspace-write\nexternal_review_tool = none\nfinalize_enabled = false\nmove_plan_on_completion = true\ntask_retry_count = 1\nmax_iterations = 50\nreview_patience = 2\nsession_timeout = 1h\nidle_timeout = 10m\nplans_dir = docs/plans\n`;
  writeAtomic(ralphexConfig, config, 0o600);

  const preflightArgs = [
    "--project", project,
    "--mex-command", mexCommand,
    "--real-codex", realCodex,
    "--ralphex-command", ralphexCommand,
  ].map(shellQuote).join(" ");
  const runScript = `#!/bin/sh\nset -eu\ncd ${shellQuote(project)}\n${shellQuote(process.execPath)} ${shellQuote(PREFLIGHT)} ${preflightArgs}\nexec ${shellQuote(ralphexCommand)} "$@"\n`;
  writeAtomic(runCommand, runScript, 0o700);

  const state = {
    version: 1,
    project,
    real_codex: realCodex,
    codex_version: codexVersionText,
    mex_command: mexCommand,
    ralphex_command: ralphexCommand,
    ralphex_version: ralphexVersionText,
    controlled_codex: controlledCodex,
    run_command: runCommand,
    codex_home: codexHome,
    builder: { model: builderModel, reasoning: builderReasoning },
    reviewer: { model: reviewModel, reasoning: reviewReasoning },
  };
  writeAtomic(resolve(home, "install-state.json"), `${JSON.stringify(state, null, 2)}\n`, 0o600);

  return { runCommand, controlledCodex, ralphexConfig };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = install();
    process.stdout.write(`CODEXLOOPER_INSTALL=PASS\nRUN_COMMAND=${result.runCommand}\n`);
  } catch (error) {
    process.stderr.write(`CODEXLOOPER_INSTALL=BLOCK: ${error.message}\n`);
    process.exitCode = 1;
  }
}
