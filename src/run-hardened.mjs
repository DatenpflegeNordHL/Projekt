import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
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
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { runPreflight } from "../scripts/preflight.mjs";
import { assertGitAuthority, readGitAuthority } from "./git-authority.mjs";
import { ensurePrivateDirectoryChain } from "./runtime-paths.mjs";
import { parseBudgetLimits, initializeRunBudget, readRunBudget } from "./run-budget.mjs";
import { parseRunPolicy } from "./run-policy.mjs";
import { verifyRuntimeManifest } from "./runtime-integrity.mjs";
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

function requiredString(env, key) {
  const value = env[key];
  if (typeof value !== "string" || !value || value.includes("\0")) {
    fail("CODEXLOOPER_RUN_CONFIG_INVALID", `${key} is required`);
  }
  return value;
}

function requiredAbsoluteExecutable(env, key) {
  const value = requiredString(env, key);
  if (!isAbsolute(value)) {
    fail("CODEXLOOPER_RUN_CONFIG_INVALID", `${key} must be an absolute executable path`);
  }
  return value;
}

function safeGitEnv(sourceEnv = process.env) {
  return Object.fromEntries(
    ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE"].flatMap((key) =>
      sourceEnv[key] === undefined ? [] : [[key, sourceEnv[key]]],
    ),
  );
}

function git(projectRoot, args, label, sourceEnv = process.env) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: safeGitEnv(sourceEnv),
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail("CODEXLOOPER_GIT_FAILED", `${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function gitStatus(projectRoot, label, sourceEnv = process.env) {
  return git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=normal"], label, sourceEnv);
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
  if (relToPlans.includes(sep)) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan must be a direct file inside docs/plans");
  }
  if (!planPath.endsWith(".md")) fail("CODEXLOOPER_PLAN_INVALID", "Plan must be a Markdown file");
  const stat = lstatSync(planPath);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_PLAN_BYTES) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan must be a bounded regular non-symlink file");
  }
  if (realpathSync(planPath) !== planPath) {
    fail("CODEXLOOPER_PLAN_INVALID", "Plan path must not traverse symlinks");
  }
  const content = readFileSync(planPath, "utf8");
  if (!content.includes("- [ ]")) fail("CODEXLOOPER_PLAN_INVALID", "Plan has no incomplete checklist item");
  return {
    absolute: planPath,
    relative: relative(root, planPath).split(sep).join("/"),
    completedRelative: `docs/plans/completed/${basename(planPath)}`,
    content,
  };
}

function ensureCleanTrackedPlan(projectRoot, planRelative, sourceEnv) {
  git(projectRoot, ["ls-files", "--error-unmatch", "--", planRelative], "Tracked plan check", sourceEnv);
  const status = gitStatus(projectRoot, "Git status check", sourceEnv);
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

async function spawnRalphex(command, plan, { cwd, env, timeoutMs }) {
  const child = spawn(command, [plan], { cwd, env, stdio: "inherit" });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      if (!child.killed) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (!child.killed) child.kill("SIGTERM");
  }, timeoutMs);
  timer.unref?.();
  try {
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (code, signal) => {
        if (timedOut) {
          const error = new Error("Run duration budget expired while Ralphex was active");
          error.code = "CODEXLOOPER_BUDGET_DURATION_EXCEEDED";
          rejectExit(error);
          return;
        }
        if (signal) {
          rejectExit(new Error(`Ralphex terminated by ${signal}`));
          return;
        }
        resolveExit(code ?? 1);
      });
    });
    return exitCode;
  } finally {
    clearTimeout(timer);
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

function countCommits(projectRoot, before, after, sourceEnv) {
  if (before === after) return 0;
  const raw = git(projectRoot, ["rev-list", "--count", `${before}..${after}`], "Commit count", sourceEnv);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) fail("CODEXLOOPER_GIT_FAILED", "Commit count was invalid");
  return value;
}

function recordLifecycleCommit(runDirectory, event) {
  const path = resolve(runDirectory, "host-commits.jsonl");
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function archiveCompletedPlan({
  projectRoot,
  plan,
  branch,
  startSha,
  runDirectory,
  sourceEnv,
  now,
}) {
  assertGitAuthority({
    projectRoot,
    expectedProjectRoot: projectRoot,
    expectedBranch: branch,
    runStartSha: startSha,
    sourceEnv,
    label: "Before plan archive",
  });
  if (!existsSync(plan.absolute)) {
    fail("CODEXLOOPER_PLAN_ARCHIVE_INVALID", "Ralphex moved or removed the active plan unexpectedly");
  }
  const content = readFileSync(plan.absolute, "utf8");
  if (content.includes("- [ ]")) {
    fail("CODEXLOOPER_PLAN_ARCHIVE_INVALID", "Active plan still contains incomplete tasks");
  }
  if (gitStatus(projectRoot, "Pre-archive Git status check", sourceEnv)) {
    fail("CODEXLOOPER_PLAN_ARCHIVE_INVALID", "Worktree must be clean before host plan archive");
  }
  const completed = resolve(projectRoot, plan.completedRelative);
  if (existsSync(completed)) {
    fail("CODEXLOOPER_PLAN_ARCHIVE_COLLISION", "Completed plan target already exists");
  }
  mkdirSync(dirname(completed), { recursive: true, mode: 0o755 });
  renameSync(plan.absolute, completed);
  git(projectRoot, ["add", "--all", "--", plan.relative, plan.completedRelative], "Host plan archive staging", sourceEnv);
  assertGitAuthority({
    projectRoot,
    expectedProjectRoot: projectRoot,
    expectedBranch: branch,
    runStartSha: startSha,
    sourceEnv,
    label: "Before plan archive commit",
  });
  git(
    projectRoot,
    ["commit", "--no-gpg-sign", "-m", "chore: archive completed CodexLooper plan"],
    "Host plan archive commit",
    sourceEnv,
  );
  const authority = assertGitAuthority({
    projectRoot,
    expectedProjectRoot: projectRoot,
    expectedBranch: branch,
    runStartSha: startSha,
    sourceEnv,
    label: "After plan archive commit",
  });
  recordLifecycleCommit(runDirectory, {
    schema: "codexlooper.host-commit.v3",
    created_at: now().toISOString(),
    run_id: sourceEnv.CODEXLOOPER_RUN_ID || null,
    phase: "lifecycle",
    transport: "host_plan_archive",
    commit: authority.head,
    changed_paths: [plan.relative, plan.completedRelative],
    validation: [],
    branch,
    run_start_sha: startSha,
  });
  return authority.head;
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
  const runtimeManifest = requiredString(env, "CODEXLOOPER_RUNTIME_MANIFEST");
  const runtimeManifestSha256 = requiredString(env, "CODEXLOOPER_RUNTIME_MANIFEST_SHA256");
  const runtimeDirectory = requiredString(env, "CODEXLOOPER_RUNTIME_DIR");
  const secret = env.CLOSEROUTER_API_KEY;
  if (typeof secret !== "string" || secret.length < 8 || secret.includes("\0")) {
    fail("CODEXLOOPER_CREDENTIAL_MISSING", "CLOSEROUTER_API_KEY is required");
  }

  const runtime = verifyRuntimeManifest({
    manifestPath: runtimeManifest,
    expectedManifestSha256: runtimeManifestSha256,
    expectedRuntimeDirectory: runtimeDirectory,
    expectedNodeExecutable: process.execPath,
  });
  const budgets = parseBudgetLimits(env);
  const plan = validatePlan(projectRoot, argv[0]);
  const policy = parseRunPolicy(plan.relative, plan.content);
  ensureCleanTrackedPlan(projectRoot, plan.relative, env);

  const initialAuthority = readGitAuthority(projectRoot, env);
  const branch = initialAuthority.branch;
  const headBefore = initialAuthority.head;
  const id = runId(now, randomBytesImpl);
  const runDirectory = privateRunDirectory(projectRoot, id);
  const policyPath = resolve(runDirectory, "policy.json");
  const receiptPath = resolve(runDirectory, "receipt.json");
  writeAtomic(policyPath, `${JSON.stringify(policy, null, 2)}\n`, 0o600);
  const budget = initializeRunBudget({
    runDirectory,
    projectRoot,
    limits: budgets,
    now: () => now().getTime(),
  });
  const started = now();
  const receipt = {
    schema: "codexlooper.run.v2",
    run_id: id,
    status: "running",
    plan: plan.relative,
    completed_plan: plan.completedRelative,
    started_at: started.toISOString(),
    finished_at: null,
    duration_ms: null,
    branch_before: branch,
    branch_after: null,
    head_before: headBefore,
    head_after: null,
    ancestry_ok: false,
    commits_created: 0,
    ralphex_exit_code: null,
    runtime: {
      id: runtime.manifest.runtime_id,
      directory: runtime.runtimeDirectory,
      manifest: runtime.manifestPath,
      manifest_sha256: runtime.manifestSha256,
      source_commit: runtime.manifest.source_commit,
      node: runtime.manifest.node,
      integrity_verified: true,
    },
    budgets: { limits: budgets, state: budget.state },
    policy: {
      allowed_paths: policy.allowed_paths,
      validation_commands: policy.validation_commands,
    },
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
      clean_before_archive: false,
      clean_after: false,
      plan_completed: false,
      builder_usage_present: false,
      reviewer_usage_present: false,
      runtime_integrity: true,
      branch_locked: false,
      ancestry_monotonic: false,
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
      "--runtime-manifest",
      runtimeManifest,
      "--runtime-manifest-sha256",
      runtimeManifestSha256,
      "--expected-branch",
      branch,
      "--run-start-sha",
      headBefore,
      "--expected-project-root",
      projectRoot,
    ]);
    receipt.checks.preflight = preflight === "CODEXLOOPER_PREFLIGHT=PASS";
    process.stdout.write(`${preflight}\n`);
    const postPreflight = assertGitAuthority({
      projectRoot,
      expectedProjectRoot: projectRoot,
      expectedBranch: branch,
      runStartSha: headBefore,
      sourceEnv: env,
      label: "After preflight",
    });
    receipt.checks.branch_locked = postPreflight.branch === branch;
    receipt.checks.ancestry_monotonic = postPreflight.ancestry_ok;
    const postPreflightStatus = gitStatus(projectRoot, "Post-preflight Git status check", env);
    receipt.checks.clean_after_preflight = postPreflightStatus.length === 0;
    if (!receipt.checks.clean_after_preflight) {
      fail("CODEXLOOPER_PREFLIGHT_DIRTY", "Preflight modified the project worktree");
    }

    const childEnv = ralphexEnvironment(env, {
      CLOSEROUTER_API_KEY: secret,
      CODEXLOOPER_RUN_ID: id,
      CODEXLOOPER_RUN_DIR: runDirectory,
      CODEXLOOPER_RUN_POLICY: policyPath,
      CODEXLOOPER_BUDGET_PATH: budget.statePath,
      CODEXLOOPER_PROJECT: projectRoot,
      CODEXLOOPER_EXPECTED_PROJECT_ROOT: projectRoot,
      CODEXLOOPER_EXPECTED_BRANCH: branch,
      CODEXLOOPER_RUN_START_SHA: headBefore,
    });
    const remainingMs = Math.max(1, budget.state.deadline_at_ms - Date.now());
    const exitCode = await spawnRalphex(ralphexCommand, plan.relative, {
      cwd: projectRoot,
      env: childEnv,
      timeoutMs: remainingMs,
    });
    receipt.ralphex_exit_code = exitCode;
    if (exitCode !== 0) fail("CODEXLOOPER_RALPHEX_FAILED", `Ralphex exited with status ${exitCode}`);

    const afterRalphex = assertGitAuthority({
      projectRoot,
      expectedProjectRoot: projectRoot,
      expectedBranch: branch,
      runStartSha: headBefore,
      sourceEnv: env,
      label: "After Ralphex",
    });
    receipt.checks.branch_locked = afterRalphex.branch === branch;
    receipt.checks.ancestry_monotonic = afterRalphex.ancestry_ok;
    receipt.checks.clean_before_archive = gitStatus(projectRoot, "Pre-archive Git status check", env).length === 0;
    if (!receipt.checks.clean_before_archive) {
      fail("CODEXLOOPER_RUN_INCOMPLETE", "Worktree is dirty before host plan archive");
    }

    archiveCompletedPlan({
      projectRoot,
      plan,
      branch,
      startSha: headBefore,
      runDirectory,
      sourceEnv: { ...env, CODEXLOOPER_RUN_ID: id },
      now,
    });

    const finalAuthority = assertGitAuthority({
      projectRoot,
      expectedProjectRoot: projectRoot,
      expectedBranch: branch,
      runStartSha: headBefore,
      sourceEnv: env,
      label: "Final run authority",
    });
    receipt.branch_after = finalAuthority.branch;
    receipt.head_after = finalAuthority.head;
    receipt.ancestry_ok = finalAuthority.ancestry_ok;
    receipt.commits_created = countCommits(projectRoot, headBefore, finalAuthority.head, env);
    receipt.checks.clean_after = gitStatus(projectRoot, "Final Git status check", env).length === 0;
    receipt.checks.plan_completed = existsSync(resolve(projectRoot, plan.completedRelative));

    const usageEvents = readUsageEvents(runDirectory);
    receipt.usage = aggregateUsage(usageEvents);
    receipt.checks.builder_usage_present = (receipt.usage.profiles.builder?.calls || 0) > 0;
    receipt.checks.reviewer_usage_present = (receipt.usage.profiles.reviewer?.calls || 0) > 0;
    receipt.budgets.state = readRunBudget({ budgetPath: budget.statePath, projectRoot });

    const failures = [];
    if (!receipt.checks.clean_after) failures.push("Worktree is dirty after the run");
    if (!receipt.checks.plan_completed) failures.push("Plan was not archived by the trusted host");
    if (receipt.commits_created < 1) failures.push("No trusted-host commit was created");
    if (!receipt.checks.builder_usage_present) failures.push("No Terra usage event was recorded");
    if (!receipt.checks.reviewer_usage_present) failures.push("No Sol usage event was recorded");
    if (!receipt.checks.branch_locked) failures.push("Authorized branch was not preserved");
    if (!receipt.checks.ancestry_monotonic) failures.push("Git ancestry was not monotonic");
    if (failures.length > 0) fail("CODEXLOOPER_RUN_INCOMPLETE", failures.join("; "));

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
    try {
      const finalAuthority = readGitAuthority(projectRoot, env);
      receipt.branch_after ||= finalAuthority.branch;
      receipt.head_after ||= finalAuthority.head;
      receipt.commits_created = countCommits(projectRoot, headBefore, finalAuthority.head, env);
      const ancestry = spawnSync("/usr/bin/git", ["merge-base", "--is-ancestor", headBefore, finalAuthority.head], {
        cwd: projectRoot,
        env: safeGitEnv(env),
      });
      receipt.ancestry_ok = ancestry.status === 0;
    } catch {
      receipt.branch_after ||= null;
      receipt.head_after ||= null;
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
    try {
      receipt.budgets.state = readRunBudget({ budgetPath: budget.statePath, projectRoot });
    } catch (error) {
      receipt.failure ||= {
        code: error.code || "CODEXLOOPER_BUDGET_INVALID",
        message: redact(error.message, secret),
      };
    }
    writeReceipt(receiptPath, receipt, secret);
  }

  return { receipt, receiptPath };
}
