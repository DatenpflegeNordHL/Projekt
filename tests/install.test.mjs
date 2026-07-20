import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
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
  mkdirSync(project, { recursive: true });
  mkdirSync(tools, { recursive: true });

  const git = spawnSync("/usr/bin/git", ["init", "-b", "main", project], { encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  writeFileSync(join(project, "AGENTS.md"), "# Agent anchor\n");
  writeFileSync(join(project, "ROUTER.md"), "# Router\n");

  const codex = executable(
    join(tools, "codex"),
    `#!/bin/sh\nset -eu\nif [ "\${1:-}" = "--version" ]; then echo "codex-cli ${codexVersion}"; exit 0; fi\nprintf '%s\\n' "$@" > "$(pwd)/codex-args.txt"\n[ -n "\${CLOSEROUTER_API_KEY:-}" ]\n[ -z "\${OPENAI_API_KEY:-}" ]\n[ -z "\${ANTHROPIC_API_KEY:-}" ]\n[ -z "\${GITHUB_TOKEN:-}" ]\ncat > "$(pwd)/codex-stdin.txt"\ncase " $* " in\n  *" --json "*)\n    echo '{"type":"item.completed","item":{"type":"agent_message","text":"<<<RALPHEX:ALL_TASKS_DONE>>>"}}'\n    echo '{"type":"turn.completed"}'\n    ;;\n  *)\n    echo 'NO ISSUES FOUND'\n    ;;\nesac\n`,
  );
  const mex = executable(
    join(tools, "mex"),
    "#!/bin/sh\nset -eu\nif [ \"${1:-}\" = \"check\" ] && [ \"${2:-}\" = \"--json\" ]; then echo '{\"score\":100}'; exit 0; fi\nexit 2\n",
  );
  const ralphex = executable(
    join(tools, "ralphex"),
    `#!/bin/sh\nset -eu\nif [ "\${1:-}" = "--version" ]; then echo 'ralphex ${ralphexVersion}'; exit 0; fi\nprintf '%s\\n' "$@" > "$(pwd)/ralphex-args.txt"\n`,
  );

  return { root, project, codex, mex, ralphex };
}

function installFixture(fixture) {
  return install([
    "--project", fixture.project,
    "--real-codex", fixture.codex,
    "--mex-command", fixture.mex,
    "--ralphex-command", fixture.ralphex,
  ]);
}

function modelEnv() {
  return {
    ...process.env,
    CLOSEROUTER_API_KEY: "closerouter_test_secret",
    OPENAI_API_KEY: "must-be-stripped",
    ANTHROPIC_API_KEY: "must-be-stripped",
    GITHUB_TOKEN: "must-be-stripped",
  };
}

test("installs isolated Terra executor and Sol external review configuration", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const config = readFileSync(result.ralphexConfig, "utf8");
    assert.match(config, new RegExp(`claude_command = ${result.terraExecutor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(config, /claude_args =\n/);
    assert.match(config, /external_review_tool = custom/);
    assert.match(config, new RegExp(`custom_review_script = ${result.solReviewer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.doesNotMatch(config, /executor = codex/);

    const codexConfig = readFileSync(join(fixture.project, ".codexlooper", "codex-home", "config.toml"), "utf8");
    assert.match(codexConfig, /base_url = "https:\/\/api\.closerouter\.dev\/v1"/);
    assert.match(codexConfig, /wire_api = "responses"/);
    for (const path of [result.controlledCodex, result.terraExecutor, result.solReviewer, result.runCommand]) {
      assert.equal(statSync(path).mode & 0o777, 0o700);
    }

    const state = readFileSync(join(fixture.project, ".codexlooper", "install-state.json"), "utf8");
    assert.doesNotMatch(state, /API_KEY|closerouter_test_secret/);
    assert.match(state, /"role": "implementation_and_fixes"/);
    assert.match(state, /"role": "read_only_findings"/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("preflight validates MEX, Codex and Ralphex", () => {
  const fixture = createFixture();
  try {
    installFixture(fixture);
    const result = runPreflight([
      "--project", fixture.project,
      "--mex-command", fixture.mex,
      "--real-codex", fixture.codex,
      "--ralphex-command", fixture.ralphex,
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
        "--sandbox", "workspace-write",
        "-c", 'model="openai/gpt-5.6-terra"',
        "-c", "model_reasoning_effort=medium",
        "-c", "stream_idle_timeout_ms=3600000",
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

test("Terra adapter emits Claude-compatible stream JSON", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const invocation = spawnSync(result.terraExecutor, ["--print"], {
      cwd: fixture.project,
      encoding: "utf8",
      input: "task execution prompt",
      env: modelEnv(),
    });
    assert.equal(invocation.status, 0, invocation.stderr);
    assert.match(invocation.stdout, /content_block_delta/);
    assert.match(invocation.stdout, /RALPHEX:ALL_TASKS_DONE/);
    assert.match(invocation.stdout, /"type":"result"/);
    const forwarded = readFileSync(join(fixture.project, "codex-args.txt"), "utf8");
    assert.match(forwarded, /--json/);
    assert.match(forwarded, /workspace-write/);
    assert.match(forwarded, /model="openai\/gpt-5\.6-terra"/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Sol review is a separate read-only model invocation", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const promptFile = join(fixture.project, "sol-review-prompt.txt");
    writeFileSync(promptFile, "Review the current diff and report verified findings.\n");
    const invocation = spawnSync(result.solReviewer, [promptFile], {
      cwd: fixture.project,
      encoding: "utf8",
      env: modelEnv(),
    });
    assert.equal(invocation.status, 0, invocation.stderr);
    assert.equal(invocation.stdout, "NO ISSUES FOUND\n");
    const forwarded = readFileSync(join(fixture.project, "codex-args.txt"), "utf8");
    assert.match(forwarded, /read-only/);
    assert.match(forwarded, /model="openai\/gpt-5\.6-sol"/);
    assert.doesNotMatch(forwarded, /--json/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("generated run command executes preflight before Ralphex", () => {
  const fixture = createFixture();
  try {
    const result = installFixture(fixture);
    const run = spawnSync(result.runCommand, ["docs/plans/fixture.md"], {
      cwd: fixture.project,
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /CODEXLOOPER_PREFLIGHT=PASS/);
    assert.equal(readFileSync(join(fixture.project, "ralphex-args.txt"), "utf8"), "docs/plans/fixture.md\n");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("installer rejects an obsolete Codex CLI", () => {
  const fixture = createFixture("0.129.0");
  try {
    assert.throws(() => installFixture(fixture), /0\.130\.0 or newer/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("installer rejects an obsolete Ralphex", () => {
  const fixture = createFixture("0.130.0", "1.5.1");
  try {
    assert.throws(() => installFixture(fixture), /Ralphex 1\.6\.0 or newer/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("installer and preflight reject unknown arguments", () => {
  assert.throws(() => install(["--surprise", "value"]), /Unknown argument/);
  assert.throws(() => runPreflight(["--surprise", "value"]), /Unknown argument/);
});
