import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../scripts/install.mjs";
import { runPreflight } from "../scripts/preflight.mjs";
import { initializeRunBudget, readRunBudget } from "../src/run-budget.mjs";
import { removeTree } from "../test/helpers/remove-tree.mjs";

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function git(project, args) {
  const result = spawnSync("/usr/bin/git", ["-C", project, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createFixture(codexVersion = "0.130.0", ralphexVersion = "1.6.0", mexVersion = "0.6.3") {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-fixture-"));
  const project = join(root, "project with spaces");
  const tools = join(root, "tools");
  mkdirSync(join(project, "docs", "plans"), { recursive: true });
  mkdirSync(tools, { recursive: true });
  git(project, ["init", "-b", "main"]);
  git(project, ["config", "user.name", "CodexLooper Fixture"]);
  git(project, ["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(project, "AGENTS.md"), "# Agent anchor\n");
  writeFileSync(join(project, "ROUTER.md"), "# Router\n");
  writeFileSync(
    join(project, "docs", "plans", "fixture.md"),
    "# Plan: Fixture\n\n## Allowed paths\n- `result.txt`\n- `this plan file`\n\n## Validation Commands\n- `test -f docs/plans/fixture.md`\n\n### Task 1: Result\n- [ ] Create result.txt\n",
  );

  const fakeCodexSource = join(tools, "fake-codex.mjs");
  writeFileSync(
    fakeCodexSource,
    `import { readFileSync } from "node:fs";

if (process.argv[2] === "--version") {
  console.log("codex-cli ${codexVersion}");
  process.exit(0);
}
if (!process.env.CLOSEROUTER_API_KEY) process.exit(31);
if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GITHUB_TOKEN) process.exit(32);
const args = process.argv.slice(2);
const modelArg = args.find((value) => value.startsWith('model="')) || "model=unknown";
let text;
if (modelArg.includes("gpt-5.6-sol")) {
  text = "NO ISSUES FOUND";
} else if (readFileSync("docs/plans/fixture.md", "utf8").includes("- [ ]")) {
  const patch = [
    "diff --git a/result.txt b/result.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/result.txt",
    "@@ -0,0 +1 @@",
    "+fixture-pass",
    "diff --git a/docs/plans/fixture.md b/docs/plans/fixture.md",
    "--- a/docs/plans/fixture.md",
    "+++ b/docs/plans/fixture.md",
    "@@ -10,2 +10,2 @@",
    " ### Task 1: Result",
    "-- [ ] Create result.txt",
    "+- [x] Create result.txt",
    "",
  ].join("\\n");
  text = JSON.stringify({ patch, signal: "<<<RALPHEX:ALL_TASKS_DONE>>>", summary: "Completed fixture through trusted host." });
} else {
  text = JSON.stringify({ patch: "", signal: "<<<RALPHEX:ALL_TASKS_DONE>>>", summary: "Fixture already complete." });
}
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 50 } }));
`,
  );
  const codex = executable(
    join(tools, "codex"),
    `#!/bin/sh
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeCodexSource)} "$@"
`,
  );
  const mex = executable(
    join(tools, "mex"),
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then echo 'mex ${mexVersion}'; exit 0; fi
if [ "\${1:-}" = "check" ] && [ "\${2:-}" = "--json" ]; then echo '{"score":100}'; exit 0; fi
exit 2
`,
  );
  const ralphex = executable(
    join(tools, "ralphex"),
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then echo 'ralphex ${ralphexVersion}'; exit 0; fi
[ -n "\${CLOSEROUTER_API_KEY:-}" ]
[ -n "\${CODEXLOOPER_RUN_DIR:-}" ]
[ -n "\${CODEXLOOPER_RUN_POLICY:-}" ]
[ -n "\${CODEXLOOPER_BUDGET_PATH:-}" ]
[ -n "\${CODEXLOOPER_EXPECTED_BRANCH:-}" ]
terra="$(sed -n 's/^claude_command = //p' .ralphex/config)"
sol="$(sed -n 's/^custom_review_script = //p' .ralphex/config)"
printf '%s\n' 'Read the plan file at docs/plans/fixture.md and complete the current task.' | "$terra" --print --output-format stream-json --verbose --dangerously-skip-permissions
prompt="\${TMPDIR:-/tmp}/ralphex-custom-prompt-$$.txt"
umask 077
printf '%s\n' 'Review the committed fixture changes.' > "$prompt"
"$sol" "$prompt"
rm -f "$prompt"
`,
  );
  git(project, ["add", "."]);
  git(project, ["commit", "-m", "chore: initialize fixture"]);
  return { root, project, codex, mex, ralphex };
}

function installFixture(fixture, extra = []) {
  return install([
    "--project",
    fixture.project,
    "--real-codex",
    fixture.codex,
    "--mex-command",
    fixture.mex,
    "--ralphex-command",
    fixture.ralphex,
    ...extra,
  ]);
}

function modelEnv(extra = {}) {
  return {
    ...process.env,
    CLOSEROUTER_API_KEY: "closerouter_test_secret",
    OPENAI_API_KEY: "must-be-stripped",
    ANTHROPIC_API_KEY: "must-be-stripped",
    GITHUB_TOKEN: "must-be-stripped",
    ...extra,
  };
}

function onlyRunDirectory(project) {
  const root = join(project, ".codexlooper", "runs");
  const entries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.equal(entries.length, 1);
  return join(root, entries[0].name);
}

test("installs isolated Terra, Sol, VCS guard and immutable runner", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const ralphexConfig = readFileSync(result.ralphexConfig, "utf8");
    assert.ok(ralphexConfig.includes(`claude_command = ${result.terraExecutor}`));
    assert.match(ralphexConfig, /external_review_tool = custom/);
    assert.ok(ralphexConfig.includes(`custom_review_script = ${result.solReviewer}`));
    assert.ok(ralphexConfig.includes(`vcs_command = ${result.ralphexVcsGuard}`));
    assert.match(ralphexConfig, /move_plan_on_completion = false/);
    assert.match(ralphexConfig, /max_iterations = 12/);

    const codexConfig = readFileSync(join(fixture.project, ".codexlooper", "codex-home", "config.toml"), "utf8");
    assert.match(codexConfig, /base_url = "https:\/\/api\.closerouter\.dev\/v1"/);
    assert.match(codexConfig, /wire_api = "responses"/);
    for (const path of [
      result.controlledCodex,
      result.terraExecutor,
      result.solReviewer,
      result.ralphexVcsGuard,
      result.runCommand,
    ]) {
      assert.equal(statSync(path).mode & 0o777, 0o500);
    }
    assert.equal(statSync(result.runtimeDirectory).mode & 0o777, 0o500);
    assert.equal(statSync(result.runtimeManifest).mode & 0o777, 0o400);
    const runtimeEntries = JSON.parse(readFileSync(result.runtimeManifest, "utf8")).files;
    assert.ok(runtimeEntries.some((entry) => entry.path === "src/run-hardened.mjs"));
    assert.ok(runtimeEntries.some((entry) => entry.path === "bin/terra-runtime.mjs"));
    for (const entry of runtimeEntries) {
      assert.equal(statSync(join(result.runtimeDirectory, entry.path)).mode & 0o777, 0o400);
    }

    const state = readFileSync(join(fixture.project, ".codexlooper", "install-state.json"), "utf8");
    assert.doesNotMatch(state, /API_KEY|closerouter_test_secret/);
    assert.match(state, /implementation_and_fixes/);
    assert.match(state, /read_only_findings/);
    const parsed = JSON.parse(state);
    assert.equal(parsed.runtime.id, result.runtimeId);
    assert.equal(parsed.budgets.max_builder_calls, 12);
  } finally {
    removeTree(fixture.root);
  }
});

test("preflight validates immutable runtime, MEX, Codex and Ralphex", () => {
  const fixture = createFixture();
  try {
    const installed = installFixture(fixture);
    assert.equal(
      runPreflight([
        "--project",
        fixture.project,
        "--mex-command",
        fixture.mex,
        "--real-codex",
        fixture.codex,
        "--ralphex-command",
        fixture.ralphex,
        "--runtime-manifest",
        installed.runtimeManifest,
        "--runtime-manifest-sha256",
        installed.runtimeManifestSha256,
      ]),
      "CODEXLOOPER_PREFLIGHT=PASS",
    );
  } finally {
    removeTree(fixture.root);
  }
});

test("runtime tampering blocks preflight before any model execution", () => {
  const fixture = createFixture();
  try {
    const installed = installFixture(fixture);
    const target = join(installed.runtimeDirectory, "src", "run.mjs");
    chmodSync(join(installed.runtimeDirectory, "src"), 0o700);
    chmodSync(installed.runtimeDirectory, 0o700);
    chmodSync(target, 0o600);
    writeFileSync(target, "export const compromised = true;\n");
    assert.throws(
      () =>
        runPreflight([
          "--project",
          fixture.project,
          "--mex-command",
          fixture.mex,
          "--real-codex",
          fixture.codex,
          "--ralphex-command",
          fixture.ralphex,
          "--runtime-manifest",
          installed.runtimeManifest,
          "--runtime-manifest-sha256",
          installed.runtimeManifestSha256,
        ]),
      /Runtime file mode changed|Runtime file hash changed/,
    );
  } finally {
    removeTree(fixture.root);
  }
});

test("controlled launcher preserves stdin and strips unrelated secrets", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const invocation = spawnSync(
      result.controlledCodex,
      [
        "exec",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "-c",
        'model="openai/gpt-5.6-terra"',
        "-c",
        "model_reasoning_effort=medium",
        "-c",
        "stream_idle_timeout_ms=3600000",
      ],
      { cwd: fixture.project, encoding: "utf8", input: "bounded task prompt", env: modelEnv() },
    );
    assert.equal(invocation.status, 0, invocation.stderr);
  } finally {
    removeTree(fixture.root);
  }
});

test("Terra and Sol wrappers remain separate budgeted read-only invocations", () => {
  const fixture = createFixture();
  const promptFile = join(tmpdir(), `ralphex-custom-prompt-${process.pid}-${Date.now()}.txt`);
  try {
    const result = installFixture(fixture);
    const runDirectory = join(fixture.project, ".codexlooper", "runs", "direct-test");
    mkdirSync(runDirectory, { recursive: true });
    const policyPath = join(runDirectory, "policy.json");
    writeFileSync(
      policyPath,
      `${JSON.stringify({
        schema: "codexlooper.run-policy.v1",
        plan: "docs/plans/fixture.md",
        allowed_paths: [
          { type: "exact", value: "result.txt" },
          { type: "exact", value: "docs/plans/fixture.md" },
        ],
        validation_commands: ["test -f docs/plans/fixture.md"],
      })}\n`,
      { mode: 0o600 },
    );
    const budget = initializeRunBudget({
      runDirectory,
      projectRoot: fixture.project,
      limits: result.budgets,
    });
    writeFileSync(promptFile, "Review the current diff and report verified findings.\n", { mode: 0o600 });
    const directEnv = modelEnv({
      CODEXLOOPER_RUN_ID: "direct-test",
      CODEXLOOPER_RUN_DIR: runDirectory,
      CODEXLOOPER_RUN_POLICY: policyPath,
      CODEXLOOPER_BUDGET_PATH: budget.statePath,
    });

    const terra = spawnSync(result.terraExecutor, ["--print"], {
      cwd: fixture.project,
      encoding: "utf8",
      input: "task execution prompt",
      env: directEnv,
    });
    assert.equal(terra.status, 0, terra.stderr);
    assert.match(terra.stdout, /RALPHEX:ALL_TASKS_DONE/);
    assert.equal(readFileSync(join(fixture.project, "result.txt"), "utf8"), "fixture-pass\n");

    const sol = spawnSync(result.solReviewer, [promptFile], {
      cwd: fixture.project,
      encoding: "utf8",
      env: directEnv,
    });
    assert.equal(sol.status, 0, sol.stderr);
    assert.equal(sol.stdout, "NO ISSUES FOUND\n");
    const usage = readFileSync(join(runDirectory, "usage.jsonl"), "utf8");
    assert.match(usage, /"profile":"builder"/);
    assert.match(usage, /"profile":"reviewer"/);
    const budgetState = readRunBudget({ budgetPath: budget.statePath, projectRoot: fixture.project });
    assert.deepEqual(budgetState.attempts, { builder: 1, reviewer: 1 });
    assert.ok(budgetState.actual_estimated_cost_usd > 0);
  } finally {
    rmSync(promptFile, { force: true });
    removeTree(fixture.root);
  }
});

test("generated runner preserves branch, enforces budgets and archives plan through host", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /CODEXLOOPER_PREFLIGHT=PASS/);
    assert.match(run.stdout, /CODEXLOOPER_RUN=PASS/);
    assert.equal(readFileSync(join(fixture.project, "result.txt"), "utf8"), "fixture-pass\n");
    assert.equal(git(fixture.project, ["branch", "--show-current"]), "main");
    assert.ok(existsSync(join(fixture.project, "docs", "plans", "completed", "fixture.md")));
    assert.equal(existsSync(join(fixture.project, "docs", "plans", "fixture.md")), false);

    const runDirectory = onlyRunDirectory(fixture.project);
    const receipt = JSON.parse(readFileSync(join(runDirectory, "receipt.json"), "utf8"));
    assert.equal(receipt.schema, "codexlooper.run.v2");
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.branch_before, "main");
    assert.equal(receipt.branch_after, "main");
    assert.equal(receipt.ancestry_ok, true);
    assert.ok(receipt.commits_created >= 2);
    assert.equal(receipt.checks.plan_completed, true);
    assert.equal(receipt.checks.runtime_integrity, true);
    assert.equal(receipt.checks.branch_locked, true);
    assert.equal(receipt.checks.ancestry_monotonic, true);
    assert.equal(receipt.checks.builder_usage_present, true);
    assert.equal(receipt.checks.reviewer_usage_present, true);
    assert.equal(receipt.budgets.state.attempts.builder, 1);
    assert.equal(receipt.budgets.state.attempts.reviewer, 1);
    assert.ok(receipt.budgets.state.actual_estimated_cost_usd > 0);
    assert.ok(receipt.usage.totals.estimated_cost_usd > 0);
    assert.doesNotMatch(JSON.stringify(receipt), /closerouter_test_secret|OPENAI_API_KEY|GITHUB_TOKEN/);
    const hostEvents = readFileSync(join(runDirectory, "host-commits.jsonl"), "utf8");
    assert.match(hostEvents, /"transport":"structured_patch"/);
    assert.match(hostEvents, /"transport":"host_plan_archive"/);
  } finally {
    removeTree(fixture.root);
  }
});

test("generated runner rejects nested plans before Ralphex can collide completion filenames", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const nestedDirectory = join(fixture.project, "docs", "plans", "feature");
    mkdirSync(nestedDirectory);
    writeFileSync(
      join(nestedDirectory, "fixture.md"),
      "# Nested Plan\n\n## Allowed paths\n- `result.txt`\n\n## Validation Commands\n- `test -f result.txt`\n\n### Task 1: Result\n- [ ] Create result.txt\n",
    );
    git(fixture.project, ["add", "docs/plans/feature/fixture.md"]);
    git(fixture.project, ["commit", "-m", "test: add nested plan"]);

    const run = spawnSync(result.runCommand, ["docs/plans/feature/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /CODEXLOOPER_PLAN_INVALID: Plan must be a direct file inside docs\/plans/);
    assert.equal(existsSync(join(fixture.project, ".codexlooper", "runs")), false);
  } finally {
    removeTree(fixture.root);
  }
});

test("installer rejects obsolete tools, unsafe budgets and unknown arguments", () => {
  const oldCodex = createFixture("0.129.0");
  try {
    assert.throws(() => installFixture(oldCodex), /0\.130\.0 or newer/);
  } finally {
    removeTree(oldCodex.root);
  }
  const oldRalphex = createFixture("0.130.0", "1.5.1");
  try {
    assert.throws(() => installFixture(oldRalphex), /Ralphex 1\.6\.0 or newer/);
  } finally {
    removeTree(oldRalphex.root);
  }
  const oldMex = createFixture("0.130.0", "1.6.0", "0.6.2");
  try {
    assert.throws(() => installFixture(oldMex), /MEX 0\.6\.3 or newer/);
  } finally {
    removeTree(oldMex.root);
  }
  const invalidBudget = createFixture();
  try {
    assert.throws(
      () => installFixture(invalidBudget, ["--max-builder-calls", "0"]),
      /Maximum builder calls is outside the allowed range/,
    );
  } finally {
    removeTree(invalidBudget.root);
  }
  assert.throws(() => install(["--surprise", "value"]), /Unknown argument/);
  assert.throws(() => runPreflight(["--surprise", "value"]), /Unknown argument/);
});
