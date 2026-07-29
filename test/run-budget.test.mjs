import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeRunBudget,
  readRunBudget,
  recordActualEstimatedCost,
  reserveModelCall,
} from "../src/run-budget.mjs";

function fixture(limits = {}) {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-budget-"));
  const runDirectory = join(project, ".codexlooper", "runs", "test-run");
  const configured = {
    max_builder_calls: 2,
    max_reviewer_calls: 1,
    max_run_duration_ms: 1000,
    max_estimated_cost_usd: 0.3,
    model_call_reserve_usd: 0.1,
    max_crg_builds: 0,
    ...limits,
  };
  const initialized = initializeRunBudget({
    runDirectory,
    projectRoot: project,
    limits: configured,
    now: () => 1000,
  });
  return {
    project,
    runDirectory,
    budgetPath: initialized.statePath,
    env: { CODEXLOOPER_BUDGET_PATH: initialized.statePath },
  };
}

test("reserves bounded builder and reviewer calls atomically", () => {
  const current = fixture();
  try {
    assert.equal(
      reserveModelCall("builder", {
        sourceEnv: current.env,
        projectRoot: current.project,
        now: () => 1100,
      }).attempt,
      1,
    );
    assert.equal(
      reserveModelCall("builder", {
        sourceEnv: current.env,
        projectRoot: current.project,
        now: () => 1200,
      }).attempt,
      2,
    );
    assert.equal(
      reserveModelCall("reviewer", {
        sourceEnv: current.env,
        projectRoot: current.project,
        now: () => 1300,
      }).attempt,
      1,
    );
    const state = readRunBudget({ budgetPath: current.budgetPath, projectRoot: current.project });
    assert.deepEqual(state.attempts, { builder: 2, reviewer: 1 });
    assert.equal(state.reserved_cost_usd, 0.3);
    assert.equal(state.actual_estimated_cost_usd, 0);
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("blocks a paid model call without a private run budget", () => {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-budget-required-"));
  try {
    assert.throws(
      () => reserveModelCall("builder", { sourceEnv: {}, projectRoot: project }),
      (error) => error.code === "CODEXLOOPER_BUDGET_REQUIRED",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("reconciles actual estimated cost monotonically", () => {
  const current = fixture();
  try {
    reserveModelCall("builder", {
      sourceEnv: current.env,
      projectRoot: current.project,
      now: () => 1100,
    });
    const first = recordActualEstimatedCost(0.012345678, {
      sourceEnv: current.env,
      projectRoot: current.project,
    });
    assert.equal(first.actual_estimated_cost_usd, 0.012345678);
    const second = recordActualEstimatedCost(0.025, {
      sourceEnv: current.env,
      projectRoot: current.project,
    });
    assert.equal(second.actual_estimated_cost_usd, 0.025);
    assert.throws(
      () =>
        recordActualEstimatedCost(0.02, {
          sourceEnv: current.env,
          projectRoot: current.project,
        }),
      (error) => error.code === "CODEXLOOPER_BUDGET_INVALID",
    );
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("blocks the next call when profile or cost budget is exhausted", () => {
  const current = fixture({ max_builder_calls: 1, max_estimated_cost_usd: 0.2 });
  try {
    reserveModelCall("builder", {
      sourceEnv: current.env,
      projectRoot: current.project,
      now: () => 1100,
    });
    assert.throws(
      () =>
        reserveModelCall("builder", {
          sourceEnv: current.env,
          projectRoot: current.project,
          now: () => 1200,
        }),
      (error) => error.code === "CODEXLOOPER_BUDGET_CALLS_EXCEEDED",
    );
    reserveModelCall("reviewer", {
      sourceEnv: current.env,
      projectRoot: current.project,
      now: () => 1300,
    });
    assert.throws(
      () =>
        reserveModelCall("reviewer", {
          sourceEnv: current.env,
          projectRoot: current.project,
          now: () => 1400,
        }),
      (error) =>
        error.code === "CODEXLOOPER_BUDGET_CALLS_EXCEEDED" ||
        error.code === "CODEXLOOPER_BUDGET_COST_EXCEEDED",
    );
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("blocks actual estimated cost above the run maximum", () => {
  const current = fixture({ max_estimated_cost_usd: 0.2 });
  try {
    assert.throws(
      () =>
        recordActualEstimatedCost(0.200000001, {
          sourceEnv: current.env,
          projectRoot: current.project,
        }),
      (error) => error.code === "CODEXLOOPER_BUDGET_COST_EXCEEDED",
    );
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("blocks calls after the run deadline", () => {
  const current = fixture({ max_run_duration_ms: 50 });
  try {
    assert.throws(
      () =>
        reserveModelCall("builder", {
          sourceEnv: current.env,
          projectRoot: current.project,
          now: () => 1051,
        }),
      (error) => error.code === "CODEXLOOPER_BUDGET_DURATION_EXCEEDED",
    );
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});
