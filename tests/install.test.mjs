import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "../scripts/install.mjs";
import { runPreflight } from "../scripts/preflight.mjs";

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function createFixture(codexVersion = "0.130.0", ralphexVersion = "1.6.0") {
  const root = mkdtempSync(join(tmpdir(), "codexlooper fixture "));
  const project = join(root, "project with spaces");
  const tools = join(root, "tools");
  mkdirSync(join(project, "docs", "plans"), { recursive: true });
  mkdirSync(tools, { recursive: true });

  const git = spawnSync("/usr/bin/git", ["init", "-b", "main", project], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  for (const [key, value] of [
    ["user.name", "CodexLooper Fixture"],
    ["user.email", "fixture@example.invalid"],
  ]) {
    const configured = spawnSync("/usr/bin/git", ["-C", project, "config", key, value], {
      encoding: "utf8",
    });
    assert.equal(configured.status, 0, configured.stderr);
  }
  writeFileSync(join(project, "AGENTS.md"), "# Agent anchor\n");
  writeFileSync(join(project, "ROUTER.md"), "# Router\n");
  writeFileSync(
    join(project, "docs", "plans", "fixture.md"),
    "# Plan: Fixture\n\n### Task 1: Result\n- [ ] Create result.txt\n",
  );

  const codex = executable(
    join(tools, "codex"),
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then echo "codex-cli ${codexVersion}"; exit 0; fi
printf '%s\n' "$@" > "$(pwd)/codex-args.txt"
[ -n "\${CLOSEROUTER_API_KEY:-}" ]
[ -z "\${OPENAI_API_KEY:-}" ]
[ -z "\${ANTHROPIC_API_KEY:-}" ]
[ -z "\${GITHUB_TOKEN:-}" ]
cat > "$(pwd)/codex-stdin.txt"
case " $* " in
  *" --json "*)
    case " $* " in
      *"gpt-5.6-sol"*) text='NO ISSUES FOUND' ;;
      *) text='<<<RALPHEX:ALL_TASKS_DONE>>>' ;;
    esac
    printf '{"type":"item.completed","item":{"type":"agent_message","text":"%s"}}\n' "$text"
    echo '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":400,"cache_write_input_tokens":0,"output_tokens":200,"reasoning_output_tokens":50}}'
    ;;
  *)
    echo 'NO ISSUES FOUND'
    ;;
esac
`,
  );
  const mex = executable(
    join(tools, "mex"),
    "#!/bin/sh\nset -eu\nif [ \"${1:-}\" = \"check\" ] && [ \"${2:-}\" = \"--json\" ]; then echo '{\"score\":100}'; exit 0; fi\nexit 2\n",
  );
  const ralphex = executable(
    join(tools, "ralphex"),
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then echo 'ralphex ${ralphexVersion}'; exit 0; fi
printf '%s\n' "$@" > "$(pwd)/.codexlooper/ralphex-args.txt"
[ -n "\${CLOSEROUTER_API_KEY:-}" ]
[ -n "\${CODEXLOOPER_RUN_DIR:-}" ]
plan="$1"
mkdir -p docs/plans/completed
sed 's/- \[ \]/- [x]/g' "$plan" > "docs/plans/completed/$(basename "$plan")"
rm "$plan"
printf 'fixture-pass\n' > result.txt
cat > "$CODEXLOOPER_RUN_DIR/usage.jsonl" <<'JSONL'
{"schema":"codexlooper.usage.v1","profile":"builder","model":"openai/gpt-5.6-terra","reasoning":"medium","sandbox":"workspace-write","usage":{"input_tokens":1000,"cached_input_tokens":400,"cache_write_input_tokens":0,"output_tokens":200,"reasoning_output_tokens":50}}
{"schema":"codexlooper.usage.v1","profile":"reviewer","model":"openai/gpt-5.6-sol","reasoning":"medium","sandbox":"read-only","usage":{"input_tokens":800,"cached_input_tokens":200,"cache_write_input_tokens":0,"output_tokens":100,"reasoning_output_tokens":20}}
JSONL
git add docs/plans result.txt
git commit -m 'feat: complete fixture plan' >/dev/null
`,
  );

  const initial = spawnSync("/usr/bin/git", ["-C", project, "add", "."], { encoding: "utf8" });
  assert.equal(initial.status, 0, initial.stderr);
  const committed = spawnSync(
    "/usr/bin/git",
    ["-C", project, "commit", "-m", "chore: initialize fixture"],
    { encoding: "utf8" },
  );
  assert.equal(committed.status, 0, committed.stderr);

  return { root, project, codex, mex, ralphex };
}

function installFixture(fixture) {
  return install([
    "--project",
    fixture.project,
    "--real-codex",
    fixture.codex,
    "--mex-command",
    fixture.mex,
    "--ralphex-command",
    fixture.ralphex,
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

test("installs isolated Terra executor, Sol reviewer and receipt runner", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const config = readFileSync(result.ralphexConfig, "utf8");
    assert.match(config, new RegExp(`claude_command = ${result.terraExecutor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(config, /external_review_tool = custom/);
    assert.match(config, new RegExp(`custom_review_script = ${result.solReviewer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(config, /executor = codex/);

    const codexConfig = readFileSync(
      join(fixture.project, ".codexlooper", "codex-home", "config.toml"),
      "utf8",
    );
    assert.match(codexConfig, /base_url = "https:\/\/api\.closerouter\.dev\/v1"/);
    assert.match(codexConfig, /wire_api = "responses"/);
    for (const path of [result.controlledCodex, result.terraExecutor, result.solReviewer, result.runCommand]) {
      assert.equal(statSync(path).mode & 0o777, 0o700);
    }

    const state = readFileSync(join(fixture.project, ".codexlooper", "install-state.json"), "utf8");
    assert.doesNotMatch(state, /API_KEY|closerouter_test_secret/);
    assert.match(state, /"version": 2/);
    assert.match(state, /"role": "implementation_and_fixes"/);
    assert.match(state, /"role": "read_only_findings"/);
    assert.match(readFileSync(result.runCommand, "utf8"), /scripts\/run\.mjs/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("preflight validates MEX, Codex and Ralphex", () => {
  const fixture = createFixture();
  try {
    installFixture(fixture);
    const result = runPreflight([
      "--project",
      fixture.project,
      "--mex-command",
      fixture.mex,
      "--real-codex",
      fixture.codex,
      "--ralphex-command",
      fixture.ralphex,
    ]);
    assert.equal(result, "CODEXLOOPER_PREFLIGHT=PASS");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("native controlled launcher preserves stdin and strips unrelated secrets", () => {
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
      {
        cwd: fixture.project,
        encoding: "utf8",
        input: "bounded task prompt",
        env: modelEnv(),
      },
    );
    assert.equal(invocation.status, 0, invocation.stderr);
    assert.equal(readFileSync(join(fixture.project, "codex-stdin.txt"), "utf8"), "bounded task prompt");
    const forwarded = readFileSync(join(fixture.project, "codex-args.txt"), "utf8");
    assert.match(forwarded, /^exec\n/);
    assert.match(forwarded, /--ephemeral/);
    assert.match(forwarded, /model="openai\/gpt-5\.6-terra"/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Terra adapter emits stream JSON and records usage", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const runDirectory = join(fixture.project, ".codexlooper", "runs", "terra-test");
    const invocation = spawnSync(result.terraExecutor, ["--print"], {
      cwd: fixture.project,
      encoding: "utf8",
      input: "task execution prompt",
      env: modelEnv({ CODEXLOOPER_RUN_ID: "terra-test", CODEXLOOPER_RUN_DIR: runDirectory }),
    });
    assert.equal(invocation.status, 0, invocation.stderr);
    assert.match(invocation.stdout, /content_block_delta/);
    assert.match(invocation.stdout, /RALPHEX:ALL_TASKS_DONE/);
    assert.match(invocation.stdout, /"type":"result"/);
    assert.match(readFileSync(join(runDirectory, "usage.jsonl"), "utf8"), /"profile":"builder"/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Sol review is a separate JSON-mode read-only invocation with usage", () => {
  const fixture = createFixture();
  const promptFile = join(tmpdir(), `ralphex-custom-prompt-${process.pid}-${Date.now()}.txt`);
  try {
    const result = installFixture(fixture);
    const runDirectory = join(fixture.project, ".codexlooper", "runs", "sol-test");
    writeFileSync(promptFile, "Review the current diff and report verified findings.\n", { mode: 0o600 });
    const invocation = spawnSync(result.solReviewer, [promptFile], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv({ CODEXLOOPER_RUN_ID: "sol-test", CODEXLOOPER_RUN_DIR: runDirectory }),
    });
    assert.equal(invocation.status, 0, invocation.stderr);
    assert.equal(invocation.stdout, "NO ISSUES FOUND\n");
    const forwarded = readFileSync(join(fixture.project, "codex-args.txt"), "utf8");
    assert.match(forwarded, /read-only/);
    assert.match(forwarded, /model="openai\/gpt-5\.6-sol"/);
    assert.match(forwarded, /--json/);
    assert.match(readFileSync(join(runDirectory, "usage.jsonl"), "utf8"), /"profile":"reviewer"/);
  } finally {
    rmSync(promptFile, { force: true });
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("generated one-command run produces commit, completed plan and cost receipt", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /CODEXLOOPER_PREFLIGHT=PASS/);
    assert.match(run.stdout, /CODEXLOOPER_RUN=PASS/);
    assert.equal(readFileSync(join(fixture.project, ".codexlooper", "ralphex-args.txt"), "utf8"), "docs/plans/fixture.md\n");
    assert.equal(readFileSync(join(fixture.project, "result.txt"), "utf8"), "fixture-pass\n");
    const runDirectory = onlyRunDirectory(fixture.project);
    const receipt = JSON.parse(readFileSync(join(runDirectory, "receipt.json"), "utf8"));
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.commits_created, 1);
    assert.equal(receipt.checks.plan_completed, true);
    assert.equal(receipt.checks.builder_usage_present, true);
    assert.equal(receipt.checks.reviewer_usage_present, true);
    assert.equal(receipt.usage.profiles.builder.calls, 1);
    assert.equal(receipt.usage.profiles.reviewer.calls, 1);
    assert.ok(receipt.usage.totals.estimated_cost_usd > 0);
    assert.doesNotMatch(JSON.stringify(receipt), /closerouter_test_secret|OPENAI_API_KEY|GITHUB_TOKEN/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("installer rejects obsolete tools and unknown arguments", () => {
  const oldCodex = createFixture("0.129.0");
  try {
    assert.throws(() => installFixture(oldCodex), /0\.130\.0 or newer/);
  } finally {
    rmSync(oldCodex.root, { recursive: true, force: true });
  }
  const oldRalphex = createFixture("0.130.0", "1.5.1");
  try {
    assert.throws(() => installFixture(oldRalphex), /Ralphex 1\.6\.0 or newer/);
  } finally {
    rmSync(oldRalphex.root, { recursive: true, force: true });
  }
  assert.throws(() => install(["--surprise", "value"]), /Unknown argument/);
  assert.throws(() => runPreflight(["--surprise", "value"]), /Unknown argument/);
});
