import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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

function createFixture(
  codexVersion = "0.130.0",
  ralphexVersion = "1.6.0",
  mexVersion = "0.6.3",
  {
    ralphexExitAfterBuilder = false,
    ralphexExitBeforeBuilder = false,
    taskCount = 1,
    repeatBuilderAfterCommit = false,
    canonicalTaskCompletion = true,
    candidateCheck = "node --check check.mjs",
    candidateCheckReplacement = null,
  } = {},
) {
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
    join(project, "package.json"),
    `${JSON.stringify({ private: true, scripts: { check: candidateCheck } })}\n`,
  );
  writeFileSync(join(project, "check.mjs"), "export const fixtureCheck = true;\n");
  const extraTasks = Array.from({ length: taskCount - 1 }, (_, index) => {
    const task = index + 2;
    return `\n### Task ${task}: Must not run\n- [ ] Task ${task} complete.\n`;
  }).join("");
  writeFileSync(
    join(project, "docs", "plans", "fixture.md"),
    `# Plan: Fixture\n\n## Allowed paths\n- \`result.txt\`\n${candidateCheckReplacement ? "- `package.json`\\n" : ""}- \`this plan file\`\n\n## Validation Commands\n- \`test -f docs/plans/fixture.md\`\n\n### Task 1: Result\n- [ ] Create result.txt\n- [ ] Task 1 complete.\n${extraTasks}`,
  );

  const fakeCodexSource = join(tools, "fake-codex.mjs");
  writeFileSync(
    fakeCodexSource,
    `import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

if (process.argv[2] === "--version") {
  console.log("codex-cli ${codexVersion}");
  process.exit(0);
}
if (!process.env.CLOSEROUTER_API_KEY) process.exit(31);
if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GITHUB_TOKEN) process.exit(32);
const args = process.argv.slice(2);
const modelArg = args.find((value) => value.startsWith('model="')) || "model=unknown";
const prompt = readFileSync(0, "utf8");
const singleTask = /\\.codexlooper\\/runs\\/.*\\/task-1\\.md/.test(prompt);
let text;
if (modelArg.includes("gpt-5.6-sol")) {
  text = "NO ISSUES FOUND";
} else if (readFileSync("docs/plans/fixture.md", "utf8").includes("- [ ]")) {
  const plan = readFileSync("docs/plans/fixture.md", "utf8");
  const oldText = singleTask
    ? ${canonicalTaskCompletion ? '"- [ ] Task 1 complete."' : '"### Task 1: Result"'}
    : "- [ ] Create result.txt\\n- [ ] Task 1 complete.";
  const newText = singleTask
    ? ${canonicalTaskCompletion ? '"- [x] Task 1 complete."' : '"### Task 1: Result (attempted)"'}
    : "- [x] Create result.txt\\n- [x] Task 1 complete.";
  text = JSON.stringify({
    version: 2,
    operations: [
      {
        type: "create_file",
        path: "result.txt",
        content: "fixture-pass\\n",
        expected_absent: true,
      },
${canonicalTaskCompletion ? `      {
        type: "replace_exact",
        path: "docs/plans/fixture.md",
        expected_file_sha256: createHash("sha256").update(plan, "utf8").digest("hex"),
        old_text: oldText,
        new_text: newText,
        expected_occurrences: 1,
      },` : ""}
${candidateCheckReplacement ? `      {
        type: "replace_exact",
        path: "package.json",
        expected_file_sha256: createHash("sha256").update(readFileSync("package.json", "utf8"), "utf8").digest("hex"),
        old_text: ${JSON.stringify(candidateCheck)},
        new_text: ${JSON.stringify(candidateCheckReplacement)},
        expected_occurrences: 1,
      },` : ""}
    ],
  });
} else {
  text = "<<<RALPHEX:ALL_TASKS_DONE>>>";
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
[ "\$#" -eq 1 ]
printf '%s\n' "\$1" > "\${CODEXLOOPER_RUN_DIR}/ralphex-plan-path"
if [ -n "\${CODEXLOOPER_CANONICAL_PLAN_PATH:-}" ] || [ -n "\${CODEXLOOPER_CANONICAL_PLAN_SHA256:-}" ]; then
  [ -n "\${CODEXLOOPER_CANONICAL_PLAN_PATH:-}" ]
  [ -n "\${CODEXLOOPER_CANONICAL_PLAN_SHA256:-}" ]
  printf '%s\n%s\n' "\$CODEXLOOPER_CANONICAL_PLAN_PATH" "\$CODEXLOOPER_CANONICAL_PLAN_SHA256" > "\${CODEXLOOPER_RUN_DIR}/canonical-plan-context"
fi
terra="$(sed -n 's/^claude_command = //p' .ralphex/config)"
sol="$(sed -n 's/^custom_review_script = //p' .ralphex/config)"
plan_path="\$1"
builder_calls="\${CODEXLOOPER_RUN_DIR}/builder-calls"
${ralphexExitBeforeBuilder ? "exit 23" : ""}
run_builder() {
  printf 'call\n' >> "$builder_calls"
  printf 'Read the plan file at %s and complete the current task.\n' "$plan_path" | "$terra" --print --output-format stream-json --verbose --dangerously-skip-permissions
}
run_builder
${ralphexExitAfterBuilder ? "exit 23" : ""}
${repeatBuilderAfterCommit ? "while :; do sleep 1; run_builder; done" : ""}
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

function createCrgFixture(fixture) {
  const root = realpathSync(fixture.root);
  const environment = join(root, "crg-environment");
  mkdirSync(join(environment, "bin"), { recursive: true });
  const interpreter = executable(join(environment, "bin", "python"), "#!/bin/sh\nexit 0\n");
  const command = executable(join(environment, "bin", "crg"), "#!/bin/sh\nexit 0\n");
  const sandbox = executable(join(root, "sandbox-exec"), `#!/bin/sh
set -eu
case "$*" in
  *detect-changes*) test -f "\${CRG_DATA_DIR}/graph"; printf '%s' 'No changes detected.' ;;
  *build*) mkdir -p "\${CRG_DATA_DIR}"; : > "\${CRG_DATA_DIR}/graph" ;;
  *) echo 'code-review-graph 2.3.6' ;;
esac
`);
  return ["--crg-environment", environment, "--crg-interpreter", interpreter, "--crg-command", command, "--crg-sandbox", sandbox];
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

test("configured CRG is sealed for the runner only and preflight rejects tampering", () => {
  const fixture = createFixture();
  const priorConfig = process.env.CODEXLOOPER_CRG_CONFIG;
  const priorDigest = process.env.CODEXLOOPER_CRG_CONFIG_SHA256;
  try {
    const installed = installFixture(fixture, createCrgFixture(fixture));
    assert.equal(installed.crg.status, "configured");
    const runWrapper = readFileSync(installed.runCommand, "utf8");
    assert.match(runWrapper, /CODEXLOOPER_CRG_CONFIG=/);
    for (const path of [installed.controlledCodex, installed.terraExecutor, installed.solReviewer, installed.ralphexVcsGuard]) {
      assert.doesNotMatch(readFileSync(path, "utf8"), /CODEXLOOPER_CRG_CONFIG/);
    }
    process.env.CODEXLOOPER_CRG_CONFIG = join(fixture.project, ".codexlooper", "crg-runtime-config.json");
    process.env.CODEXLOOPER_CRG_CONFIG_SHA256 = installed.crg.configSha256;
    assert.equal(runPreflight([
      "--project", fixture.project,
      "--mex-command", fixture.mex,
      "--real-codex", fixture.codex,
      "--ralphex-command", fixture.ralphex,
      "--runtime-manifest", installed.runtimeManifest,
      "--runtime-manifest-sha256", installed.runtimeManifestSha256,
    ]), "CODEXLOOPER_PREFLIGHT=PASS");
    writeFileSync(process.env.CODEXLOOPER_CRG_CONFIG, "tampered\n");
    assert.throws(() => runPreflight([
      "--project", fixture.project,
      "--mex-command", fixture.mex,
      "--real-codex", fixture.codex,
      "--ralphex-command", fixture.ralphex,
      "--runtime-manifest", installed.runtimeManifest,
      "--runtime-manifest-sha256", installed.runtimeManifestSha256,
    ]), /CRG config digest/);
  } finally {
    if (priorConfig === undefined) delete process.env.CODEXLOOPER_CRG_CONFIG;
    else process.env.CODEXLOOPER_CRG_CONFIG = priorConfig;
    if (priorDigest === undefined) delete process.env.CODEXLOOPER_CRG_CONFIG_SHA256;
    else process.env.CODEXLOOPER_CRG_CONFIG_SHA256 = priorDigest;
    removeTree(fixture.root);
  }
});

test("preflight rejects executable paths that differ from the immutable runtime manifest", () => {
  const fixture = createFixture();
  try {
    const installed = installFixture(fixture);
    const substitute = executable(
      join(fixture.root, "substitute-tool"),
      "#!/bin/sh\necho substitute 0.0.0\n",
    );
    for (const [flag, label] of [
      ["--mex-command", "mex"],
      ["--real-codex", "codex"],
      ["--ralphex-command", "ralphex"],
    ]) {
      const args = [
        "--project", fixture.project,
        "--mex-command", fixture.mex,
        "--real-codex", fixture.codex,
        "--ralphex-command", fixture.ralphex,
        "--runtime-manifest", installed.runtimeManifest,
        "--runtime-manifest-sha256", installed.runtimeManifestSha256,
      ];
      args[args.indexOf(flag) + 1] = substitute;
      assert.throws(
        () => runPreflight(args),
        (error) => error.code === "CODEXLOOPER_RUNTIME_INTEGRITY_FAILED" && error.message.includes(label),
      );
    }
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
        "stream_idle_timeout_ms=600000",
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
    const projectRoot = realpathSync(fixture.project);
    const runDirectory = join(projectRoot, ".codexlooper", "runs", "direct-test");
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
        full_project_check: {
          package_json_sha256: createHash("sha256").update(readFileSync(join(projectRoot, "package.json"), "utf8"), "utf8").digest("hex"),
          check_script: "node --check check.mjs",
        },
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
      cwd: projectRoot,
      encoding: "utf8",
      input: "task execution prompt",
      env: directEnv,
    });
    assert.equal(terra.status, 0, terra.stderr);
    assert.match(terra.stdout, /RALPHEX:ALL_TASKS_DONE/);
    assert.equal(readFileSync(join(projectRoot, "result.txt"), "utf8"), "fixture-pass\n");

    const sol = spawnSync(result.solReviewer, [promptFile], {
      cwd: projectRoot,
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
    assert.match(hostEvents, /"transport":"builder_envelope_v2_host_generated_diff"/);
    assert.match(hostEvents, /"completion_gates":\{"required":true/);
    assert.match(hostEvents, /"gate":"plan_validation"/);
    assert.match(hostEvents, /"command":"npm run check"/);
    assert.match(hostEvents, /"gate":"full_project_check"/);
    assert.doesNotMatch(hostEvents, /"command":"runtime-integrity verification"/);
    assert.match(hostEvents, /"command":"branch-lock and ancestry verification","status":"PASS"/);
    assert.match(hostEvents, /"command":"clean-worktree verification","status":"PASS"/);
    assert.match(hostEvents, /"transport":"host_plan_archive"/);
  } finally {
    removeTree(fixture.root);
  }
});

test("configured runner records only sealed CRG identity and does not execute CRG", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture, createCrgFixture(fixture));
    const run = spawnSync(result.runCommand, ["docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.equal(run.status, 0, run.stderr);
    const receipt = JSON.parse(readFileSync(join(onlyRunDirectory(fixture.project), "receipt.json"), "utf8"));
    assert.equal(receipt.crg.status, "configured");
    assert.equal(receipt.crg.reason, "budget_zero");
    assert.equal(receipt.crg.builds, 0);
    assert.equal(receipt.crg.max_builds, 0);
    assert.match(receipt.crg.identity.run_start_sha, /^[a-f0-9]{40}$/);
    assert.match(receipt.crg.identity.current_trusted_head, /^[a-f0-9]{40}$/);
    assert.match(receipt.crg.identity.config_sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.crg.identity.profile_sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.crg.identity.launch_sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(receipt), /crg-runtime-config\.json|crg-environment|sandbox-exec|closerouter_test_secret|crg-report/);
  } finally {
    removeTree(fixture.root);
  }
});

test("configured runner publishes one private CRG graph build before advisory detection", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture, [...createCrgFixture(fixture), "--max-crg-builds", "1"]);
    const run = spawnSync(result.runCommand, ["docs/plans/fixture.md"], { cwd: fixture.project, encoding: "utf8", env: modelEnv(), timeout: 120_000 });
    assert.equal(run.status, 0, run.stderr);
    const receipt = JSON.parse(readFileSync(join(onlyRunDirectory(fixture.project), "receipt.json"), "utf8"));
    assert.equal(receipt.crg.builds, 1);
    assert.equal(receipt.crg.result.status, "available");
    assert.equal(receipt.crg.result.report_path, null);
    assert.match(receipt.sol.advisory_sha256, /^[a-f0-9]{64}$/);
  } finally { removeTree(fixture.root); }
});

test("configured runner reuses sealed graph data on an independent same-HEAD retry", () => {
  const fixture = createFixture("0.130.0", "1.6.0", "0.6.3", { ralphexExitBeforeBuilder: true });
  try {
    const result = installFixture(fixture, [...createCrgFixture(fixture), "--max-crg-builds", "1"]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = spawnSync(result.runCommand, ["docs/plans/fixture.md"], { cwd: fixture.project, encoding: "utf8", env: modelEnv(), timeout: 120_000 });
      assert.notEqual(run.status, 0);
    }
    const runs = readdirSync(join(fixture.project, ".codexlooper", "runs"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
    assert.equal(runs.length, 2);
    const receipts = runs.map((entry) => JSON.parse(readFileSync(join(fixture.project, ".codexlooper", "runs", entry.name, "receipt.json"), "utf8")));
    assert.deepEqual(receipts.map((receipt) => receipt.crg.builds).sort(), [0, 1]);
    assert.ok(receipts.every((receipt) => receipt.crg.result.status === "available"));
  } finally { removeTree(fixture.root); }
});

test("configured runner selects a distinct sealed CRG cache entry after the trusted HEAD changes", () => {
  const fixture = createFixture("0.130.0", "1.6.0", "0.6.3", { ralphexExitBeforeBuilder: true });
  try {
    const result = installFixture(fixture, [...createCrgFixture(fixture), "--max-crg-builds", "2"]);
    const first = spawnSync(result.runCommand, ["docs/plans/fixture.md"], { cwd: fixture.project, encoding: "utf8", env: modelEnv(), timeout: 120_000 });
    assert.notEqual(first.status, 0);
    git(fixture.project, ["commit", "--allow-empty", "-m", "chore: change trusted head"]);
    const second = spawnSync(result.runCommand, ["docs/plans/fixture.md"], { cwd: fixture.project, encoding: "utf8", env: modelEnv(), timeout: 120_000 });
    assert.notEqual(second.status, 0);
    const runs = readdirSync(join(fixture.project, ".codexlooper", "runs"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
    const receipts = runs.map((entry) => JSON.parse(readFileSync(join(fixture.project, ".codexlooper", "runs", entry.name, "receipt.json"), "utf8")));
    assert.equal(runs.length, 2);
    assert.deepEqual(receipts.map((receipt) => receipt.crg.builds).sort(), [1, 1]);
    assert.notEqual(receipts[0].crg.identity.current_trusted_head, receipts[1].crg.identity.current_trusted_head);
    assert.ok(receipts.every((receipt) => receipt.crg.result.status === "available"));
    const cache = readdirSync(join(fixture.project, ".codexlooper", "crg-cache")).filter((name) => name.endsWith(".data"));
    assert.equal(cache.length, 2);
  } finally { removeTree(fixture.root); }
});

test("generated runner exposes only a private selected-task plan to Ralphex", () => {
  const fixture = createFixture(
    "0.130.0",
    "1.6.0",
    "0.6.3",
    { taskCount: 2 },
  );
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["--task", "1", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /CODEXLOOPER_RUN=PASS/);
    assert.equal(readFileSync(join(fixture.project, "result.txt"), "utf8"), "fixture-pass\n");
    const originalPlan = readFileSync(join(fixture.project, "docs", "plans", "fixture.md"), "utf8");
    assert.match(originalPlan, /- \[x\] Task 1 complete\./);
    assert.match(originalPlan, /- \[ \] Task 2 complete\./);
    assert.equal(existsSync(join(fixture.project, "docs", "plans", "completed", "fixture.md")), false);

    const runDirectory = onlyRunDirectory(fixture.project);
    const receipt = JSON.parse(readFileSync(join(runDirectory, "receipt.json"), "utf8"));
    const policy = JSON.parse(readFileSync(join(runDirectory, "policy.json"), "utf8"));
    const derivedPlanPath = readFileSync(join(runDirectory, "ralphex-plan-path"), "utf8").trim();
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.single_task, true);
    assert.equal(receipt.selected_task, 1);
    assert.equal(receipt.original_plan, "docs/plans/fixture.md");
    assert.equal(receipt.checks.plan_completed, true);
    assert.equal(policy.single_task, true);
    assert.equal(policy.selected_task, 1);
    assert.equal(policy.original_plan, "docs/plans/fixture.md");
    assert.equal(realpathSync(derivedPlanPath), realpathSync(join(runDirectory, "task-1.md")));
    assert.notEqual(derivedPlanPath, "docs/plans/fixture.md");
    const derivedPlan = readFileSync(derivedPlanPath, "utf8");
    const sha256 = (content) => createHash("sha256").update(content, "utf8").digest("hex");
    const originalPlanBeforeTask = originalPlan.replace("- [x] Task 1 complete.", "- [ ] Task 1 complete.");
    assert.equal(receipt.original_plan_sha256, sha256(originalPlanBeforeTask));
    assert.equal(receipt.derived_plan_sha256, sha256(derivedPlan));
    assert.equal(policy.original_plan_sha256, receipt.original_plan_sha256);
    assert.equal(policy.derived_plan_sha256, receipt.derived_plan_sha256);
    assert.equal(policy.selected_task_completed_plan_sha256, sha256(originalPlan));
    assert.deepEqual(
      readFileSync(join(runDirectory, "canonical-plan-context"), "utf8").trim().split("\n"),
      [policy.original_plan, policy.original_plan_sha256],
    );
    assert.equal(statSync(derivedPlanPath).mode & 0o777, 0o400);
    assert.match(derivedPlan, /### Task 1: Result/);
    assert.doesNotMatch(derivedPlan, /### Task 2: Must not run/);
    assert.match(derivedPlan, /## Single-task execution contract/);
    assert.match(derivedPlan, /execution-only input/i);
    assert.match(derivedPlan, /Never patch, modify, add, delete, or rename this derived file/i);
    assert.match(derivedPlan, /including `task-1\.md`/);
    assert.match(derivedPlan, /only permitted plan-file patch target is the canonical original plan: `docs\/plans\/fixture\.md`/i);
    assert.match(derivedPlan, /## Allowed paths/);
    assert.match(derivedPlan, /## Validation Commands/);
    assert.equal(git(fixture.project, ["status", "--porcelain=v1"]), "");
  } finally {
    removeTree(fixture.root);
  }
});

test("selected-task completion stops a stale derived-plan loop after one trusted host commit", () => {
  const fixture = createFixture(
    "0.130.0",
    "1.6.0",
    "0.6.3",
    { taskCount: 5, repeatBuilderAfterCommit: true },
  );
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["--task", "1", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.equal(run.status, 0, run.stderr);
    const plan = readFileSync(join(fixture.project, "docs", "plans", "fixture.md"), "utf8");
    assert.match(plan, /- \[x\] Task 1 complete\./);
    for (const task of [2, 3, 4, 5]) {
      assert.match(plan, new RegExp(`- \\[ \\] Task ${task} complete\\.`));
    }
    const runDirectory = onlyRunDirectory(fixture.project);
    assert.deepEqual(
      readFileSync(join(runDirectory, "builder-calls"), "utf8").trim().split("\n"),
      ["call"],
    );
    const derivedPlanPath = readFileSync(join(runDirectory, "ralphex-plan-path"), "utf8").trim();
    assert.match(readFileSync(derivedPlanPath, "utf8"), /- \[ \] Task 1 complete\./);
    assert.equal(statSync(derivedPlanPath).mode & 0o777, 0o400);
    const receipt = JSON.parse(readFileSync(join(runDirectory, "receipt.json"), "utf8"));
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.selected_task, 1);
    assert.equal(receipt.selected_task_commit, receipt.head_after);
    assert.equal(receipt.commits_created, 1);
    assert.equal(receipt.checks.plan_completed, true);
    assert.equal(receipt.ralphex_exit_code, 0);
    assert.equal(
      receipt.budgets.state.actual_estimated_cost_usd,
      receipt.usage.totals.estimated_cost_usd,
    );
    assert.equal(git(fixture.project, ["status", "--porcelain=v1"]), "");
  } finally {
    removeTree(fixture.root);
  }
});

test("a failing pinned full-project candidate check creates no host commit", () => {
  const fixture = createFixture(
    "0.130.0",
    "1.6.0",
    "0.6.3",
    { candidateCheck: "node -e process.exit(17)" },
  );
  try {
    const result = installFixture(fixture);
    const start = git(fixture.project, ["rev-parse", "HEAD"]);
    const run = spawnSync(result.runCommand, ["--task", "1", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.notEqual(run.status, 0);
    assert.equal(git(fixture.project, ["rev-parse", "HEAD"]), start);
    assert.equal(git(fixture.project, ["status", "--porcelain=v1"]), "");
    assert.equal(existsSync(join(fixture.project, "result.txt")), false);
    assert.match(readFileSync(join(fixture.project, "docs", "plans", "fixture.md"), "utf8"), /- \[ \] Task 1 complete\./);
    const runDirectory = onlyRunDirectory(fixture.project);
    assert.equal(existsSync(join(runDirectory, "host-commits.jsonl")), false);
  } finally {
    removeTree(fixture.root);
  }
});

test("full-project candidate validation runs from a clean private commit", () => {
  const fixture = createFixture("0.130.0", "1.6.0", "0.6.3", { candidateCheck: "node check.mjs" });
  try {
    writeFileSync(
      join(fixture.project, "check.mjs"),
      `import { execFileSync } from "node:child_process";
const run = (args) => execFileSync("/usr/bin/git", args, { encoding: "utf8" });
if (run(["status", "--porcelain=v1", "--ignored"]) || run(["remote"])) process.exit(41);
const parents = run(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ");
const identity = run(["show", "-s", "--format=%an%n%ae%n%cn%n%ce", "HEAD"]);
const forbidden = Object.keys(process.env).filter((key) => key === "CLOSEROUTER_API_KEY" || key === "CODEX_HOME" || key.startsWith("CODEXLOOPER_") || key.startsWith("RALPHEX_") || key.startsWith("MEX_") || key.startsWith("GIT_AUTHOR_") || key.startsWith("GIT_COMMITTER_") || key.startsWith("GIT_CONFIG_"));
if (parents.length !== 2 || identity !== "CodexLooper Candidate\\ncandidate@codexlooper.invalid\\nCodexLooper Candidate\\ncandidate@codexlooper.invalid\\n" || forbidden.length) process.exit(42);
`,
    );
    git(fixture.project, ["add", "check.mjs"]);
    git(fixture.project, ["commit", "-m", "test: require clean candidate check source"]);
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["--task", "1", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(git(fixture.project, ["status", "--porcelain=v1"]), "");
  } finally {
    removeTree(fixture.root);
  }
});

test("a candidate cannot replace the run-start scripts.check command", () => {
  const fixture = createFixture(
    "0.130.0",
    "1.6.0",
    "0.6.3",
    { candidateCheckReplacement: "node -e process.exit(0)" },
  );
  try {
    const result = installFixture(fixture);
    const start = git(fixture.project, ["rev-parse", "HEAD"]);
    const run = spawnSync(result.runCommand, ["--task", "1", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.notEqual(run.status, 0);
    assert.equal(git(fixture.project, ["rev-parse", "HEAD"]), start);
    assert.equal(git(fixture.project, ["status", "--porcelain=v1"]), "");
    assert.match(readFileSync(join(fixture.project, "package.json"), "utf8"), /node --check check\.mjs/);
    const runDirectory = onlyRunDirectory(fixture.project);
    assert.equal(existsSync(join(runDirectory, "host-commits.jsonl")), false);
  } finally {
    removeTree(fixture.root);
  }
});

test("selected-task canonical completion evidence remains fail-closed", () => {
  const fixture = createFixture(
    "0.130.0",
    "1.6.0",
    "0.6.3",
    { taskCount: 2, canonicalTaskCompletion: false },
  );
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["--task", "1", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.notEqual(run.status, 0);
    const runDirectory = onlyRunDirectory(fixture.project);
    const receipt = JSON.parse(readFileSync(join(runDirectory, "receipt.json"), "utf8"));
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.failure.code, "CODEXLOOPER_SINGLE_TASK_INCOMPLETE");
    assert.equal(receipt.checks.plan_completed, false);
    assert.equal(receipt.selected_task_commit, null);
    assert.match(
      readFileSync(join(fixture.project, "docs", "plans", "fixture.md"), "utf8"),
      /- \[ \] Task 1 complete\./,
    );
  } finally {
    removeTree(fixture.root);
  }
});

test("full-plan runs still require every canonical task to complete", () => {
  const fixture = createFixture("0.130.0", "1.6.0", "0.6.3", { taskCount: 2 });
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
      timeout: 120_000,
    });
    assert.notEqual(run.status, 0);
    const receipt = JSON.parse(readFileSync(join(onlyRunDirectory(fixture.project), "receipt.json"), "utf8"));
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.failure.code, "CODEXLOOPER_PLAN_ARCHIVE_INVALID");
    assert.match(
      readFileSync(join(fixture.project, "docs", "plans", "fixture.md"), "utf8"),
      /- \[ \] Task 2 complete\./,
    );
  } finally {
    removeTree(fixture.root);
  }
});

test("already-completed selected tasks block before a Builder invocation", () => {
  const fixture = createFixture();
  try {
    const planPath = join(fixture.project, "docs", "plans", "fixture.md");
    writeFileSync(
      planPath,
      readFileSync(planPath, "utf8").replace("- [ ] Task 1 complete.", "- [x] Task 1 complete."),
    );
    git(fixture.project, ["add", "docs/plans/fixture.md"]);
    git(fixture.project, ["commit", "-m", "test: pre-complete task 1"]);
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["--task", "1", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /CODEXLOOPER_SINGLE_TASK_ALREADY_COMPLETED/u);
    assert.equal(existsSync(join(fixture.project, ".codexlooper", "runs")), false);
  } finally {
    removeTree(fixture.root);
  }
});

test("generated runner rejects an unknown selected task before Ralphex starts", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["--task", "2", "docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /CODEXLOOPER_SINGLE_TASK_INVALID: Task 2 does not exist/);
    assert.equal(existsSync(join(fixture.project, ".codexlooper", "runs")), false);
    assert.equal(git(fixture.project, ["status", "--porcelain=v1"]), "");
  } finally {
    removeTree(fixture.root);
  }
});

test("failed runner receipts reconcile builder usage and clean final state", () => {
  const fixture = createFixture(
    "0.130.0",
    "1.6.0",
    "0.6.3",
    { ralphexExitAfterBuilder: true },
  );
  try {
    const result = installFixture(fixture);
    const run = spawnSync(
      result.runCommand,
      ["docs/plans/fixture.md"],
      {
        cwd: fixture.project,
        encoding: "utf8",
        env: modelEnv(),
        timeout: 120_000,
      },
    );

    assert.notEqual(run.status, 0);

    const runDirectory = onlyRunDirectory(fixture.project);
    const receipt = JSON.parse(
      readFileSync(join(runDirectory, "receipt.json"), "utf8"),
    );

    assert.equal(receipt.status, "failed");
    assert.equal(receipt.failure.code, "CODEXLOOPER_RALPHEX_FAILED");
    assert.equal(receipt.ralphex_exit_code, 23);
    assert.equal(receipt.checks.clean_after, true);
    assert.equal(receipt.checks.builder_usage_present, true);
    assert.equal(receipt.checks.reviewer_usage_present, false);
    assert.equal(receipt.checks.branch_locked, true);
    assert.equal(receipt.checks.ancestry_monotonic, true);
    assert.equal(receipt.usage.profiles.builder.calls, 1);
    assert.equal(receipt.budgets.state.attempts.builder, 1);
    assert.equal(receipt.budgets.state.attempts.reviewer, 0);
    assert.equal(git(fixture.project, ["status", "--porcelain=v1"]), "");
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
