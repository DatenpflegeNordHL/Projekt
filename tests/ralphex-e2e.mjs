import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { install } from "../scripts/install.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ralphex = process.env.RALPHEX_BIN;
if (!ralphex) throw new Error("RALPHEX_BIN is required");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
  return result;
}

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

const root = mkdtempSync(join(tmpdir(), "codexlooper-ralphex-e2e-"));
try {
  const project = join(root, "fixture");
  const tools = join(root, "tools");
  mkdirSync(join(project, "docs", "plans"), { recursive: true });
  mkdirSync(tools, { recursive: true });

  run("/usr/bin/git", ["init", "-b", "main", project]);
  run("/usr/bin/git", ["-C", project, "config", "user.name", "CodexLooper Fixture"]);
  run("/usr/bin/git", ["-C", project, "config", "user.email", "fixture@example.invalid"]);

  writeFileSync(join(project, "AGENTS.md"), "# Agent anchor\nRead ROUTER.md and only relevant context.\n");
  writeFileSync(join(project, "ROUTER.md"), "# Router\nFixture tasks require only the plan.\n");
  writeFileSync(
    join(project, "docs", "plans", "fixture.md"),
    "# Plan: Offline fixture\n\n## Validation Commands\n- `test -f result.txt`\n\n### Task 1: Produce result\n- [ ] Create result.txt containing fixture-pass\n",
  );

  const fakeCodexSource = join(tools, "fake-codex.mjs");
  writeFileSync(
    fakeCodexSource,
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

if (process.argv[2] === "--version") { console.log("codex-cli 0.130.0"); process.exit(0); }
if (!process.env.CLOSEROUTER_API_KEY) process.exit(31);
if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GITHUB_TOKEN) process.exit(32);
const args = process.argv.slice(2);
const prompt = readFileSync(0, "utf8");
const modelArg = args.find((value) => value.startsWith('model="')) || "model=unknown";
const sandboxIndex = args.indexOf("--sandbox");
const sandbox = sandboxIndex >= 0 ? args[sandboxIndex + 1] : "missing";
appendFileSync(join(process.cwd(), "model-runs.jsonl"), JSON.stringify({ modelArg, sandbox, json: args.includes("--json") }) + "\\n");

if (!args.includes("--json")) { console.log("NO ISSUES FOUND"); process.exit(0); }
let signal;
if (prompt.includes("Read the plan file at")) {
  const planPath = join(process.cwd(), "docs", "plans", "fixture.md");
  writeFileSync(join(process.cwd(), "result.txt"), "fixture-pass\\n");
  writeFileSync(planPath, readFileSync(planPath, "utf8").replace("- [ ] Create", "- [x] Create"));
  for (const command of [
    ["add", "result.txt", "docs/plans/fixture.md"],
    ["commit", "-m", "feat: complete offline fixture"],
  ]) {
    const result = spawnSync("/usr/bin/git", command, { cwd: process.cwd(), encoding: "utf8" });
    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(33); }
  }
  signal = "<<<RALPHEX:ALL_TASKS_DONE>>>";
} else if (prompt.includes("External code review evaluation")) {
  signal = "<<<RALPHEX:CODEX_REVIEW_DONE>>>";
} else {
  signal = "<<<RALPHEX:REVIEW_DONE>>>";
}
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: signal } }));
console.log(JSON.stringify({ type: "turn.completed" }));
`,
  );
  const fakeCodex = executable(
    join(tools, "codex"),
    `#!/bin/sh
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeCodexSource)} "$@"
`,
  );
  const mex = executable(
    join(tools, "mex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"check\" ] && [ \"${2:-}\" = \"--json\" ]; then echo '{\"score\":100}'; exit 0; fi\nexit 2\n",
  );

  run("/usr/bin/git", ["-C", project, "add", "."]);
  run("/usr/bin/git", ["-C", project, "commit", "-m", "chore: initialize fixture"]);

  const installed = install([
    "--project", project,
    "--real-codex", fakeCodex,
    "--mex-command", mex,
    "--ralphex-command", ralphex,
  ]);

  const result = run(installed.runCommand, ["docs/plans/fixture.md"], {
    cwd: project,
    env: {
      ...process.env,
      CLOSEROUTER_API_KEY: "closerouter_fixture_secret",
      OPENAI_API_KEY: "must-be-stripped",
      ANTHROPIC_API_KEY: "must-be-stripped",
      GITHUB_TOKEN: "must-be-stripped",
    },
    timeout: 120_000,
  });

  assert.match(result.stdout + result.stderr, /all tasks completed|completed|success/i);
  assert.equal(readFileSync(join(project, "result.txt"), "utf8"), "fixture-pass\n");
  assert.ok(
    existsSync(join(project, "docs", "plans", "completed", "fixture.md")) ||
      readFileSync(join(project, "docs", "plans", "fixture.md"), "utf8").includes("- [x]"),
  );

  const runs = readFileSync(join(project, "model-runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(runs.some((entry) => entry.modelArg.includes("gpt-5.6-terra") && entry.sandbox === "workspace-write"));
  assert.ok(runs.some((entry) => entry.modelArg.includes("gpt-5.6-sol") && entry.sandbox === "read-only"));
  assert.ok(runs.some((entry) => entry.json === true));
  assert.ok(runs.some((entry) => entry.json === false));

  process.stdout.write("CODEXLOOPER_RALPHEX_E2E=PASS\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
