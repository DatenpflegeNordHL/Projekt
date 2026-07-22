import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function finitePositive(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail("CODEXLOOPER_BUDGET_INVALID", `${label} must be a positive number`);
  }
  return parsed;
}

function finiteNonNegative(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail("CODEXLOOPER_BUDGET_INVALID", `${label} must be a non-negative number`);
  }
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail("CODEXLOOPER_BUDGET_INVALID", `${label} must be a non-negative integer`);
  }
  return parsed;
}

function positiveInteger(value, label) {
  const parsed = nonNegativeInteger(value, label);
  if (parsed < 1) fail("CODEXLOOPER_BUDGET_INVALID", `${label} must be at least one`);
  return parsed;
}

function requirePrivateRunPath(path, projectRoot, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    fail("CODEXLOOPER_BUDGET_INVALID", `${label} must be an absolute path`);
  }
  const root = resolve(projectRoot, ".codexlooper", "runs");
  const target = resolve(path);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail("CODEXLOOPER_BUDGET_INVALID", `${label} must stay inside .codexlooper/runs`);
  }
  return target;
}

function writeAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function parseState(path) {
  let state;
  try {
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("CODEXLOOPER_BUDGET_INVALID", "Run budget state is invalid JSON");
  }
  if (
    state?.schema !== "codexlooper.run-budget.v1" ||
    !state.limits ||
    !state.attempts ||
    typeof state.started_at_ms !== "number" ||
    typeof state.deadline_at_ms !== "number" ||
    typeof state.reserved_cost_usd !== "number" ||
    typeof state.actual_estimated_cost_usd !== "number"
  ) {
    fail("CODEXLOOPER_BUDGET_INVALID", "Run budget state schema is invalid");
  }
  return state;
}

function lock(path) {
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    fail("CODEXLOOPER_BUDGET_LOCKED", `Run budget lock is unavailable: ${error.message}`);
  }
  return () => {
    try {
      closeSync(descriptor);
    } finally {
      rmSync(path, { force: true });
    }
  };
}

function configuredBudgetPath(sourceEnv, projectRoot) {
  const configured = sourceEnv.CODEXLOOPER_BUDGET_PATH;
  if (!configured) {
    fail("CODEXLOOPER_BUDGET_REQUIRED", "A private run budget is required before a paid model call");
  }
  return requirePrivateRunPath(configured, projectRoot, "Run budget path");
}

export function parseBudgetLimits(sourceEnv = process.env) {
  const limits = {
    max_builder_calls: positiveInteger(sourceEnv.CODEXLOOPER_MAX_BUILDER_CALLS, "Maximum builder calls"),
    max_reviewer_calls: positiveInteger(sourceEnv.CODEXLOOPER_MAX_REVIEWER_CALLS, "Maximum reviewer calls"),
    max_run_duration_ms: positiveInteger(sourceEnv.CODEXLOOPER_MAX_RUN_DURATION_MS, "Maximum run duration"),
    max_estimated_cost_usd: finitePositive(
      sourceEnv.CODEXLOOPER_MAX_ESTIMATED_COST_USD,
      "Maximum estimated cost",
    ),
    model_call_reserve_usd: finitePositive(
      sourceEnv.CODEXLOOPER_MODEL_CALL_RESERVE_USD,
      "Model call reserve",
    ),
    max_crg_builds: nonNegativeInteger(sourceEnv.CODEXLOOPER_MAX_CRG_BUILDS, "Maximum CRG builds"),
  };
  if (limits.model_call_reserve_usd > limits.max_estimated_cost_usd) {
    fail("CODEXLOOPER_BUDGET_INVALID", "Model call reserve exceeds maximum estimated cost");
  }
  return limits;
}

export function initializeRunBudget({
  runDirectory,
  projectRoot = process.cwd(),
  limits,
  now = () => Date.now(),
} = {}) {
  const directory = requirePrivateRunPath(runDirectory, projectRoot, "Run directory");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const statePath = resolve(directory, "budget.json");
  if (existsSync(statePath)) {
    const stat = lstatSync(statePath);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
      fail("CODEXLOOPER_BUDGET_INVALID", "Existing run budget file is unsafe");
    }
    fail("CODEXLOOPER_BUDGET_INVALID", "Run budget was already initialized");
  }
  const startedAt = now();
  const state = {
    schema: "codexlooper.run-budget.v1",
    started_at_ms: startedAt,
    deadline_at_ms: startedAt + limits.max_run_duration_ms,
    limits,
    attempts: { builder: 0, reviewer: 0 },
    reserved_cost_usd: 0,
    actual_estimated_cost_usd: 0,
    crg_builds: 0,
  };
  writeAtomic(statePath, state);
  return { statePath, state };
}

export function readRunBudget({
  budgetPath,
  projectRoot = process.cwd(),
} = {}) {
  const path = requirePrivateRunPath(budgetPath, projectRoot, "Run budget path");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    fail("CODEXLOOPER_BUDGET_INVALID", "Run budget file is unsafe");
  }
  return parseState(path);
}

export function reserveModelCall(profile, {
  sourceEnv = process.env,
  projectRoot = process.cwd(),
  now = () => Date.now(),
} = {}) {
  if (profile !== "builder" && profile !== "reviewer") {
    fail("CODEXLOOPER_BUDGET_INVALID", `Unknown model profile: ${profile}`);
  }
  const budgetPath = configuredBudgetPath(sourceEnv, projectRoot);
  const release = lock(`${budgetPath}.lock`);
  try {
    const state = readRunBudget({ budgetPath, projectRoot });
    const currentTime = now();
    if (currentTime > state.deadline_at_ms) {
      fail("CODEXLOOPER_BUDGET_DURATION_EXCEEDED", "Run duration budget is exhausted");
    }
    const key = profile === "builder" ? "max_builder_calls" : "max_reviewer_calls";
    if (state.attempts[profile] + 1 > state.limits[key]) {
      fail("CODEXLOOPER_BUDGET_CALLS_EXCEEDED", `${profile} call budget is exhausted`);
    }
    const currentCostBasis = Math.max(
      state.reserved_cost_usd,
      state.actual_estimated_cost_usd,
    );
    const nextReserved = Number(
      (currentCostBasis + state.limits.model_call_reserve_usd).toFixed(9),
    );
    if (nextReserved > state.limits.max_estimated_cost_usd) {
      fail("CODEXLOOPER_BUDGET_COST_EXCEEDED", "Estimated CloseRouter cost budget is exhausted");
    }
    state.attempts[profile] += 1;
    state.reserved_cost_usd = nextReserved;
    writeAtomic(budgetPath, state);
    return {
      profile,
      attempt: state.attempts[profile],
      reserved_cost_usd: state.reserved_cost_usd,
      actual_estimated_cost_usd: state.actual_estimated_cost_usd,
      deadline_at_ms: state.deadline_at_ms,
    };
  } finally {
    release();
  }
}

export function recordActualEstimatedCost(costUsd, {
  sourceEnv = process.env,
  projectRoot = process.cwd(),
} = {}) {
  const actual = finiteNonNegative(costUsd, "Actual estimated cost");
  const budgetPath = configuredBudgetPath(sourceEnv, projectRoot);
  const release = lock(`${budgetPath}.lock`);
  try {
    const state = readRunBudget({ budgetPath, projectRoot });
    if (actual < state.actual_estimated_cost_usd) {
      fail("CODEXLOOPER_BUDGET_INVALID", "Actual estimated cost must be monotonic");
    }
    state.actual_estimated_cost_usd = Number(actual.toFixed(9));
    writeAtomic(budgetPath, state);
    if (state.actual_estimated_cost_usd > state.limits.max_estimated_cost_usd) {
      fail("CODEXLOOPER_BUDGET_COST_EXCEEDED", "Actual estimated CloseRouter cost exceeded the run budget");
    }
    return state;
  } finally {
    release();
  }
}
