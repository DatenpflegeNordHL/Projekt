import {
  chmodSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalExecutable,
  installImmutableRuntime,
} from "../src/runtime-integrity.mjs";
import { ensurePrivateDirectoryChain } from "../src/runtime-paths.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(THIS_FILE), "..");
const ALLOWED_REASONING = new Set(["low", "medium", "high"]);
const REQUIRED_ARGUMENTS = ["--project", "--real-codex", "--mex-command", "--ralphex-command"];
const OPTIONAL_ARGUMENTS = new Set([
  "--builder-model",
  "--review-model",
  "--builder-reasoning",
  "--review-reasoning",
  "--max-builder-calls",
  "--max-reviewer-calls",
  "--max-run-seconds",
  "--max-estimated-cost-usd",
  "--model-call-reserve-usd",
  "--max-crg-builds",
]);
const ALLOWED_ARGUMENTS = new Set([...REQUIRED_ARGUMENTS, ...OPTIONAL_ARGUMENTS]);
const MODEL_ID = /^[a-z0-9._-]+\/[a-z0-9._-]+$/i;
const LOCAL_GIT_EXCLUDES = [".codexlooper/", ".ralphex/"];
const DEFAULT_BUDGETS = Object.freeze({
  max_builder_calls: 12,
  max_reviewer_calls: 3,
  max_run_duration_ms: 3_600_000,
  max_estimated_cost_usd: 0.5,
  model_call_reserve_usd: 0.05,
  max_crg_builds: 0,
});
const BRANCH_POLICY = Object.freeze({
  mode: "lock-current-branch-at-run-start",
  repository_root: "exact",
  detached_head: "reject",
  ancestry: "run-start-sha-must-remain-ancestor",
  ralphex_branch_mutation: "reject",
});

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
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!ALLOWED_ARGUMENTS.has(key)) fail(`Unknown argument: ${key}`);
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      fail(`Missing value for argument: ${key}`);
    }
    if (seen.has(key)) fail(`Duplicate argument: ${key}`);
    seen.add(key);
    values[key] = argv[index + 1];
    index += 1;
  }
  for (const key of REQUIRED_ARGUMENTS) {
    if (!values[key]) fail(`Missing required argument: ${key}`);
  }
  return values;
}

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
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

function positiveInteger(value, fallback, label, { allowZero = false } = {}) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    fail(`${label} is outside the allowed range`);
  }
  return parsed;
}

function positiveNumber(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`${label} must be a positive number`);
  return parsed;
}

function parseBudgets(args) {
  const maxEstimatedCost = positiveNumber(
    args["--max-estimated-cost-usd"],
    DEFAULT_BUDGETS.max_estimated_cost_usd,
    "Maximum estimated cost",
  );
  const callReserve = positiveNumber(
    args["--model-call-reserve-usd"],
    DEFAULT_BUDGETS.model_call_reserve_usd,
    "Model call reserve",
  );
  if (callReserve > maxEstimatedCost) {
    fail("Model call reserve cannot exceed maximum estimated cost");
  }
  return {
    max_builder_calls: positiveInteger(
      args["--max-builder-calls"],
      DEFAULT_BUDGETS.max_builder_calls,
      "Maximum builder calls",
    ),
    max_reviewer_calls: positiveInteger(
      args["--max-reviewer-calls"],
      DEFAULT_BUDGETS.max_reviewer_calls,
      "Maximum reviewer calls",
    ),
    max_run_duration_ms:
      positiveInteger(
        args["--max-run-seconds"],
        DEFAULT_BUDGETS.max_run_duration_ms / 1000,
        "Maximum run seconds",
      ) * 1000,
    max_estimated_cost_usd: maxEstimatedCost,
    model_call_reserve_usd: callReserve,
    max_crg_builds: positiveInteger(
      args["--max-crg-builds"],
      DEFAULT_BUDGETS.max_crg_builds,
      "Maximum CRG builds",
      { allowZero: true },
    ),
  };
}

function shellQuote(value) {
  if (value.includes("\0") || value.includes("\n")) fail("Unsafe path value");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function iniValue(value) {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    fail("Unsafe configuration value");
  }
  return value;
}

function tomlString(value) {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    fail("Unsafe TOML string value");
  }
  return JSON.stringify(value);
}

function writeAtomic(path, content, mode = 0o600) {
  const parent = realpathSync(dirname(path));
  const canonicalTarget = resolve(parent, basename(path));
  if (canonicalTarget !== path) fail(`Unsafe write path: ${path}`);
  const temporary = resolve(parent, `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode, flag: "wx" });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function ensureLocalGitExcludes(project) {
  const excludePath = resolve(
    project,
    run("/usr/bin/git", ["rev-parse", "--git-path", "info/exclude"], project, "Git exclude path check"),
  );
  let existing = "";
  try {
    existing = readFileSync(excludePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const missing = LOCAL_GIT_EXCLUDES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeAtomic(excludePath, `${existing}${prefix}${missing.join("\n")}\n`, 0o600);
}

function runtimeExports(runtime, budgets) {
  return [
    `export CODEXLOOPER_RUNTIME_DIR=${shellQuote(runtime.runtimeDirectory)}`,
    `export CODEXLOOPER_RUNTIME_MANIFEST=${shellQuote(runtime.manifestPath)}`,
    `export CODEXLOOPER_RUNTIME_MANIFEST_SHA256=${shellQuote(runtime.manifestSha256)}`,
    `export CODEXLOOPER_RUNTIME_SOURCE_COMMIT=${shellQuote(runtime.sourceCommit)}`,
    `export CODEXLOOPER_MAX_BUILDER_CALLS=${shellQuote(String(budgets.max_builder_calls))}`,
    `export CODEXLOOPER_MAX_REVIEWER_CALLS=${shellQuote(String(budgets.max_reviewer_calls))}`,
    `export CODEXLOOPER_MAX_RUN_DURATION_MS=${shellQuote(String(budgets.max_run_duration_ms))}`,
    `export CODEXLOOPER_MAX_ESTIMATED_COST_USD=${shellQuote(String(budgets.max_estimated_cost_usd))}`,
    `export CODEXLOOPER_MODEL_CALL_RESERVE_USD=${shellQuote(String(budgets.model_call_reserve_usd))}`,
    `export CODEXLOOPER_MAX_CRG_BUILDS=${shellQuote(String(budgets.max_crg_builds))}`,
  ].join("\n");
}

function wrapperScript({
  realCodex,
  codexHome,
  allowedModels,
  builderModel,
  reviewModel,
  builderReasoning,
  reviewReasoning,
  entrypoint,
  runtime,
  budgets,
}) {
  return `#!/bin/sh\nset -eu\nexport CODEXLOOPER_REAL_CODEX=${shellQuote(realCodex)}\nexport CODEX_HOME=${shellQuote(codexHome)}\nexport CODEXLOOPER_ALLOWED_MODELS=${shellQuote(allowedModels)}\nexport CODEXLOOPER_BUILDER_MODEL=${shellQuote(builderModel)}\nexport CODEXLOOPER_REVIEW_MODEL=${shellQuote(reviewModel)}\nexport CODEXLOOPER_BUILDER_REASONING=${shellQuote(builderReasoning)}\nexport CODEXLOOPER_REVIEW_REASONING=${shellQuote(reviewReasoning)}\n${runtimeExports(runtime, budgets)}\nexec ${shellQuote(process.execPath)} ${shellQuote(entrypoint)} "$@"\n`;
}

function runWrapperScript({
  project,
  realCodex,
  mexCommand,
  ralphexCommand,
  builderModel,
  reviewModel,
  builderReasoning,
  reviewReasoning,
  runtime,
  budgets,
}) {
  const runner = resolve(runtime.runtimeDirectory, "scripts", "run.mjs");
  return `#!/bin/sh\nset -eu\ncd ${shellQuote(project)}\nexport CODEXLOOPER_PROJECT=${shellQuote(project)}\nexport CODEXLOOPER_REAL_CODEX=${shellQuote(realCodex)}\nexport CODEXLOOPER_MEX_COMMAND=${shellQuote(mexCommand)}\nexport CODEXLOOPER_RALPHEX_COMMAND=${shellQuote(ralphexCommand)}\nexport CODEXLOOPER_BUILDER_MODEL=${shellQuote(builderModel)}\nexport CODEXLOOPER_REVIEW_MODEL=${shellQuote(reviewModel)}\nexport CODEXLOOPER_BUILDER_REASONING=${shellQuote(builderReasoning)}\nexport CODEXLOOPER_REVIEW_REASONING=${shellQuote(reviewReasoning)}\n${runtimeExports(runtime, budgets)}\nexec ${shellQuote(process.execPath)} ${shellQuote(runner)} "$@"\n`;
}

function vcsWrapperScript({ project, runtime, budgets }) {
  const guard = resolve(runtime.runtimeDirectory, "scripts", "vcs-guard.mjs");
  return `#!/bin/sh\nset -eu\nexport CODEXLOOPER_PROJECT=${shellQuote(project)}\n${runtimeExports(runtime, budgets)}\nexec ${shellQuote(process.execPath)} ${shellQuote(guard)} "$@"\n`;
}

export function install(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const project = realpathSync(resolve(args["--project"]));
  const realCodex = canonicalExecutable(args["--real-codex"], "Codex command").path;
  const mexCommand = canonicalExecutable(args["--mex-command"], "MEX command").path;
  const ralphexCommand = canonicalExecutable(args["--ralphex-command"], "Ralphex command").path;
  const builderModel = args["--builder-model"];
  const reviewModel = args["--review-model"];
  const builderReasoning = args["--builder-reasoning"];
  const reviewReasoning = args["--review-reasoning"];
  const budgets = parseBudgets(args);

  if (!ALLOWED_REASONING.has(builderReasoning) || !ALLOWED_REASONING.has(reviewReasoning)) {
    fail("Reasoning must be low, medium or high");
  }
  if (!MODEL_ID.test(builderModel) || !MODEL_ID.test(reviewModel)) {
    fail("Builder and reviewer models must use provider/model format");
  }
  if (builderModel === reviewModel) fail("Builder and reviewer must use distinct explicit model IDs");

  const gitRoot = realpathSync(
    run("/usr/bin/git", ["rev-parse", "--show-toplevel"], project, "Git root check"),
  );
  if (gitRoot !== project) fail("Project must be the exact Git root");

  const codexVersionText = run(realCodex, ["--version"], project, "Codex version check");
  const codexVersion = parseVersion(codexVersionText, "Codex");
  if (!atLeast(codexVersion, [0, 130, 0])) fail("Codex CLI 0.130.0 or newer is required");

  const mexVersionText = run(mexCommand, ["--version"], project, "MEX version check");
  const mexVersion = parseVersion(mexVersionText, "MEX");
  if (!atLeast(mexVersion, [0, 6, 3])) fail("MEX 0.6.3 or newer is required");

  const ralphexVersionText = run(ralphexCommand, ["--version"], project, "Ralphex version check");
  const ralphexVersion = parseVersion(ralphexVersionText, "Ralphex");
  if (!atLeast(ralphexVersion, [1, 6, 0])) fail("Ralphex 1.6.0 or newer is required");

  ensurePrivateDirectoryChain(project, [".codexlooper"]);
  ensurePrivateDirectoryChain(project, [".codexlooper", "runtime"]);
  const binDir = ensurePrivateDirectoryChain(project, [".codexlooper", "bin"]);
  const codexHome = ensurePrivateDirectoryChain(project, [".codexlooper", "codex-home"]);
  ensurePrivateDirectoryChain(project, [".ralphex"]);
  ensureLocalGitExcludes(project);

  const runtime = installImmutableRuntime({
    sourceRoot: REPO_ROOT,
    projectRoot: project,
    externalTools: {
      codex: { path: realCodex, version: codexVersionText },
      mex: { path: mexCommand, version: mexVersionText },
      ralphex: { path: ralphexCommand, version: ralphexVersionText },
    },
    budgets,
  });

  const home = resolve(project, ".codexlooper");
  const controlledCodex = resolve(binDir, "codex");
  const terraExecutor = resolve(binDir, "terra-executor");
  const solReviewer = resolve(binDir, "sol-review");
  const ralphexVcsGuard = resolve(binDir, "ralphex-vcs");
  const runCommand = resolve(binDir, "codexlooper");
  const ralphexConfig = resolve(project, ".ralphex", "config");

  const codexConfig = `model_provider = "closerouter"\n\n[model_providers.closerouter]\nname = "CloseRouter"\nbase_url = "https://api.closerouter.dev/v1"\nenv_key = "CLOSEROUTER_API_KEY"\nwire_api = "responses"\nrequest_max_retries = 2\nstream_max_retries = 2\nstream_idle_timeout_ms = 120000\nrequires_openai_auth = false\nsupports_websockets = false\n\n[sandbox_workspace_write]\nwritable_roots = [${tomlString(project)}]\n`;
  writeAtomic(resolve(codexHome, "config.toml"), codexConfig, 0o600);

  const allowedModels = `${builderModel},${reviewModel}`;
  const wrapperOptions = {
    realCodex,
    codexHome,
    allowedModels,
    builderModel,
    reviewModel,
    builderReasoning,
    reviewReasoning,
    runtime,
    budgets,
  };
  writeAtomic(
    controlledCodex,
    wrapperScript({
      ...wrapperOptions,
      entrypoint: resolve(runtime.runtimeDirectory, "bin", "codex-runtime.mjs"),
    }),
    0o500,
  );
  writeAtomic(
    terraExecutor,
    wrapperScript({
      ...wrapperOptions,
      entrypoint: resolve(runtime.runtimeDirectory, "bin", "terra-runtime.mjs"),
    }),
    0o500,
  );
  writeAtomic(
    solReviewer,
    wrapperScript({
      ...wrapperOptions,
      entrypoint: resolve(runtime.runtimeDirectory, "bin", "sol-runtime.mjs"),
    }),
    0o500,
  );
  writeAtomic(ralphexVcsGuard, vcsWrapperScript({ project, runtime, budgets }), 0o500);

  const config = `claude_command = ${iniValue(terraExecutor)}\nclaude_args =\ntask_model =\nreview_model =\npreserve_anthropic_api_key = false\nexternal_review_tool = custom\ncustom_review_script = ${iniValue(solReviewer)}\nfinalize_enabled = false\nmove_plan_on_completion = false\ntask_retry_count = 1\nmax_iterations = 12\nmax_external_iterations = 2\nreview_patience = 2\nsession_timeout = 1h\nidle_timeout = 10m\nplans_dir = docs/plans\nvcs_command = ${iniValue(ralphexVcsGuard)}\n`;
  writeAtomic(ralphexConfig, config, 0o600);

  writeAtomic(
    runCommand,
    runWrapperScript({
      project,
      realCodex,
      mexCommand,
      ralphexCommand,
      builderModel,
      reviewModel,
      builderReasoning,
      reviewReasoning,
      runtime,
      budgets,
    }),
    0o500,
  );

  const state = {
    version: 3,
    project,
    real_codex: realCodex,
    codex_version: codexVersionText,
    mex_command: mexCommand,
    mex_version: mexVersionText,
    ralphex_command: ralphexCommand,
    ralphex_version: ralphexVersionText,
    controlled_codex: controlledCodex,
    terra_executor: terraExecutor,
    sol_reviewer: solReviewer,
    ralphex_vcs_guard: ralphexVcsGuard,
    run_command: runCommand,
    codex_home: codexHome,
    writable_root: project,
    branch_policy: BRANCH_POLICY,
    runtime: {
      schema: runtime.manifest.schema,
      id: runtime.runtimeId,
      directory: runtime.runtimeDirectory,
      manifest: runtime.manifestPath,
      manifest_sha256: runtime.manifestSha256,
      source_commit: runtime.sourceCommit,
      node: runtime.manifest.node,
    },
    budgets,
    builder: { model: builderModel, reasoning: builderReasoning, role: "implementation_and_fixes" },
    reviewer: { model: reviewModel, reasoning: reviewReasoning, role: "read_only_findings" },
  };
  writeAtomic(resolve(home, "install-state.json"), `${JSON.stringify(state, null, 2)}\n`, 0o600);

  return {
    runCommand,
    controlledCodex,
    terraExecutor,
    solReviewer,
    ralphexVcsGuard,
    ralphexConfig,
    runtimeDirectory: runtime.runtimeDirectory,
    runtimeManifest: runtime.manifestPath,
    runtimeManifestSha256: runtime.manifestSha256,
    runtimeId: runtime.runtimeId,
    branchPolicy: BRANCH_POLICY,
    budgets,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === THIS_FILE) {
  try {
    const result = install();
    process.stdout.write(`CODEXLOOPER_INSTALL=PASS\nRUN_COMMAND=${result.runCommand}\n`);
  } catch (error) {
    process.stderr.write(`CODEXLOOPER_INSTALL=BLOCK: ${error.message}\n`);
    process.exitCode = 1;
  }
}
