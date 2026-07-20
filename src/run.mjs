import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { runPreflight } from "../scripts/preflight.mjs";
import { ensurePrivateDirectoryChain } from "./runtime-paths.mjs";
import { aggregateUsage, readUsageEvents } from "./telemetry.mjs";

const MAX_PLAN_BYTES = 2_000_000;
const SAFE_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function redact(value, secret) {
  let text = String(value || "");
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  return text
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]")
    .slice(0, 1000);
}

function requiredAbsoluteExecutable(env, key) {
  const value = env[key];
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) {
    fail("CODEXLOOPER_RUN_CONFIG_INVALID", `${key} must be an absolute executable path`);
  }
  return value;
}

function git(projectRoot, args, label) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: Object.fromEntries(
      ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE"].flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    ),
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail("CODEXLOOPER_GIT_FAILED", `${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function gitStatus(projectRoot, label) {
  return git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=normal"], label);
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

function writeReceipt(path, receipt, secret) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (secret && serialized.includes(secret)) {
    fail("CODEXLOOPER_RECEIPT_SECRET_REJECTED", "Receipt contained the CloseRouter credential");
  }
  writeAtomic(path, serialized, 0o600);
}

function runId(now, randomBytesImpl) {
  const timestamp = now().toISOString().replace(/[-:.]/g, "");
  return `${timestamp}-${randomBytesImpl(6).toString("hex")}`;
}

function validatePlan(projectRoot, supplied) {
  if (typeof supplied !== "string" || !supplied || supplied.includes("\0")) {
    fail("CODEXLOOPER_PLAN_INVALID", "Exactly one plan path is required");
  }
  const root = realpathSync(projectRoot);
  const planPath = resolve(root, supplied);
  const plansRoot = resolve(root, "docs", "plans");
  const relToPlans = relative(plansRoot, planPath);
  if (!relToPlans || relToPlans.startsWith("..") || isAbsolute(relToPlans)) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan must be a file inside docs/plans");
  }
  if (relToPlans.split(sep).includes("completed")) {
    fail("CODEXLOOPER_PLAN_INVALID", "Completed plans cannot be executed again");
  }
  if (!planPath.endsWith(".md")) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan must be a Markdown file");
  }
  const stat = lstatSync(planPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_PLAN_BYTES) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan must be a bounded regular non-symlink file");
  }
  const realPlan = realpathSync(planPath);
  if (realPlan !== planPath) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan path must not traverse symlinks");
  }
  const content = readFileSync(planPath, "utf8");
  if (!content.includes("- [ ]")) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan has no incomplete checklist item");
  }
  return {
    absolute: planPath,
    relative: relative(root, planPath).split(sep).join("/"),
    completedRelative: `docs/plans/completed/${basename(planPath)}`,
  };
}

function ensureCleanTrackedPlan(projectRoot, planRelative) {
  git(projectRoot, ["ls-files", "--error-unmatch", "--", planRelative], "Tracked plan check");
  const status = gitStatus(projectRoot, "Git status check");
  if (status) fail("CODEXLOOPER_WORKTREE_DIRTY", "Project worktree must be clean before a run");
}

function privateRunDirectory(projectRoot, id) {
  const runsRoot = ensurePrivateDirectoryChain(projectRoot, [".codexlooper", "runs"]);
  const target = resolve(runsRoot, id);
  if (existsSync(target)) fail("CODEXLOOPER_RUN_ID_COLLISION", "Run directory already exists");
  return ensurePrivateDirectoryChain(projectRoot, [".codexlooper", "runs", id]);
}

function ralphexEnvironment(sourceEnv, values) {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }
  for (const [key, value] of Object.entries(values)) env[key] = value;
  env.DO_NOT_TRACK = "1";
  return env;
}

async function spawnRalphex(command, plan, options) {
  const child = spawn(command, [plan], {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      if (!child.killed) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  try {
    return await new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        if (signal) {
          rejectExit(new Error(`Ralphex terminated by ${signal}`));
          return;
        }
        resolveExit(code ?? 1);
      });
    });
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

function countCommits(projectRoot, before, after) {
  if (before === after) return 0;
  const raw = git(projectRoot, ["rev-list", "--count", `${before}..${after}`], "Commit count");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("CODEXLOOPER_GIT_FAILED", "Commit count was invalid");
  }
  return value;
}

export async function runProject({
  argv = process.argv.slice(2),
  env = process.env,
  now = () => new Date(),
  randomBytesImpl = randomBytes,
} = {}) {
  if (argv.length !== 1) fail("CODEXLOOPER_PLAN_INVALID", "Exactly one plan path is required");
  const projectRoot = realpathSync(env.CODEXLOOPER_PROJECT || process.cwd());
  const mexCommand = requiredAbsoluteExecutable(env, "CODEXLOOPER_MEX_COMMAND");
  const realCodex = requiredAbsoluteExecutable(env, "CODEXLOOPER_REAL_CODEX");
  const ralphexCommand = requiredAbsoluteExecutable(env, "CODEXLOOPER_RALPHEX_COMMAND");
  const secret = env.CLOSEROUTER_API_KEY;
  if (typeof secret !== "string" || secret.length < 8 || secret.includes("\0")) {
    fail("CODEXLOOPER_CREDENTIAL_MISSING", "CLOSEROUTER_API_KEY is required");
  }
  const plan = validatePlan(projectRoot, argv[0]);
  ensureCleanTrackedPlan(projectRoot, plan.relative);

  const id = runId(now, randomBytesImpl);
  const runDirectory = privateRunDirectory(projectRoot, id);
  const receiptPath = resolve(runDirectory, "receipt.json");
  const started = now();
  const headBefore = git(projectRoot, ["rev-parse", "HEAD"], "Head check");
  const branch = git(projectRoot, ["branch", "--show-current"], "Branch check");
  const receipt = {
    schema: "codexlooper.run.v1",
    run_id: id,
    status: "running",
    plan: plan.relative,
    completed_plan: plan.completedRelative,
    started_at: started.toISOString(),
    finished_at: null,
    duration_ms: null,
    branch,
    head_before: headBefore,
    head_after: null,
    commits_created: 0,
    ralphex_exit_code: null,
    models: {
      builder: {
        id: env.CODEXLOOPER_BUILDER_MODEL || "openai/gpt-5.6-terra",
        reasoning: env.CODEXLOOPER_BUILDER_REASONING || "medium",
      },
      reviewer: {
        id: env.CODEXLOOPER_REVIEW_MODEL || "openai/gpt-5.6-sol",
        reasoning: env.CODEXLOOPER_REVIEW_REASONING || "medium",
      },
    },
    usage: null,
    checks: {
      preflight: false,
      clean_before: true,
      clean_after_preflight: false,
      clean_after: false,
      plan_completed: false,
      builder_usage_present: false,
      reviewer_usage_present: false,
    },
    failure: null,
    secret_free: true,
  };
  writeReceipt(receiptPath, receipt, secret);

  try {
    const preflight = runPreflight([
      "--project",
      projectRoot,
      "--mex-command",
      mexCommand,
      "--real-codex",
      realCodex,
      "--ralphex-command",
      ralphexCommand,
    ]);
    receipt.checks.preflight = preflight === "CODEXLOOPER_PREFLIGHT=PASS";
    process.stdout.write(`${preflight}\n`);
    const postPreflightStatus = gitStatus(projectRoot, "Post-preflight Git status check");
    receipt.checks.clean_after_preflight = postPreflightStatus.length === 0;
    if (!receipt.checks.clean_after_preflight) {
      fail("CODEXLOOPER_PREFLIGHT_DIRTY", "Preflight modified the project worktree");
    }

    const childEnv = ralphexEnvironment(env, {
      CLOSEROUTER_API_KEY: secret,
      CODEXLOOPER_RUN_ID: id,
      CODEXLOOPER_RUN_DIR: runDirectory,
      CODEXLOOPER_PROJECT: projectRoot,
    });
    const exitCode = await spawnRalphex(ralphexCommand, plan.relative, {
      cwd: projectRoot,
      env: childEnv,
    });
    receipt.ralphex_exit_code = exitCode;

    const headAfter = git(projectRoot, ["rev-parse", "HEAD"], "Final head check");
    receipt.head_after = headAfter;
    receipt.commits_created = countCommits(projectRoot, headBefore, headAfter);
    const finalStatus = gitStatus(projectRoot, "Final Git status check");
    receipt.checks.clean_after = finalStatus.length === 0;
    receipt.checks.plan_completed = existsSync(resolve(projectRoot, plan.completedRelative));

    const usageEvents = readUsageEvents(runDirectory);
    receipt.usage = aggregateUsage(usageEvents);
    receipt.checks.builder_usage_present = (receipt.usage.profiles.builder?.calls || 0) > 0;
    receipt.checks.reviewer_usage_present = (receipt.usage.profiles.reviewer?.calls || 0) > 0;

    const failures = [];
    if (exitCode !== 0) failures.push(`Ralphex exited with status ${exitCode}`);
    if (!receipt.checks.clean_after) failures.push("Worktree is dirty after the run");
    if (!receipt.checks.plan_completed) failures.push("Plan was not moved to completed");
    if (receipt.commits_created < 1) failures.push("No task or review commit was created");
    if (!receipt.checks.builder_usage_present) failures.push("No Terra usage event was recorded");
    if (!receipt.checks.reviewer_usage_present) failures.push("No Sol usage event was recorded");
    if (failures.length > 0) {
      fail("CODEXLOOPER_RUN_INCOMPLETE", failures.join("; "));
    }

    receipt.status = "completed";
  } catch (error) {
    receipt.status = "failed";
    receipt.failure = {
      code: error.code || "CODEXLOOPER_RUN_FAILED",
      message: redact(error.message, secret),
    };
  } finally {
    const finished = now();
    receipt.finished_at = finished.toISOString();
    receipt.duration_ms = Math.max(0, finished.getTime() - started.getTime());
    if (!receipt.head_after) {
      try {
        receipt.head_after = git(projectRoot, ["rev-parse", "HEAD"], "Final head check");
        receipt.commits_created = countCommits(projectRoot, headBefore, receipt.head_after);
      } catch {
        receipt.head_after = null;
      }
    }
    if (!receipt.usage) {
      try {
        receipt.usage = aggregateUsage(readUsageEvents(runDirectory));
      } catch (error) {
        receipt.failure ||= {
          code: error.code || "CODEXLOOPER_USAGE_FAILED",
          message: redact(error.message, secret),
        };
      }
    }
    writeReceipt(receiptPath, receipt, secret);
  }

  return { receipt, receiptPath };
}
