import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
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
    "# Plan: Offline fixture\n\n## Allowed paths\n- `result.txt`\n- `this plan file`\n\n## Validation Commands\n- `test -f result.txt`\n\n### Task 1: Produce result\n- [ ] Create result.txt containing fixture-pass\n",
  );

  const fakeCodexSource = join(tools, "fake-codex.mjs");
  writeFileSync(
    fakeCodexSource,
    `import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

if (process.argv[2] === "--version") { console.log("codex-cli 0.130.0"); process.exit(0); }
if (!process.env.CLOSEROUTER_API_KEY) process.exit(31);
if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GITHUB_TOKEN) process.exit(32);
const args = process.argv.slice(2);
const prompt = readFileSync(0, "utf8");
const modelArg = args.find((value) => value.startsWith('model="')) || "model=unknown";
const sandboxIndex = args.indexOf("--sandbox");
const sandbox = sandboxIndex >= 0 ? args[sandboxIndex + 1] : "missing";
appendFileSync(join(process.cwd(), ".codexlooper", "model-runs.jsonl"), JSON.stringify({ modelArg, sandbox, json: args.includes("--json"), outputSchema: args.includes("--output-schema") }) + "\\n");

if (!args.includes("--json")) process.exit(34);
let text;
if (modelArg.includes("gpt-5.6-sol")) {
  text = "NO ISSUES FOUND";
} else if (prompt.includes("Read the plan file at")) {
  const patch = [
    "diff --git a/docs/plans/fixture.md b/docs/plans/fixture.md",
    "--- a/docs/plans/fixture.md",
    "+++ b/docs/plans/fixture.md",
    "@@ -8,4 +8,4 @@",
    " - " + String.fromCharCode(96) + "test -f result.txt" + String.fromCharCode(96),
    " ",
    " ### Task 1: Produce result",
    "-- [ ] Create result.txt containing fixture-pass",
    "+- [x] Create result.txt containing fixture-pass",
    "diff --git a/result.txt b/result.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/result.txt",
    "@@ -0,0 +1 @@",
    "+fixture-pass",
    "",
  ].join("\\n");
  text = JSON.stringify({ version: 1, patch, signal: "<<<RALPHEX:ALL_TASKS_DONE>>>", summary: "Completed fixture through a host-applied patch." });
} else {
  text = JSON.stringify({ version: 1, patch: "", signal: "<<<RALPHEX:REVIEW_DONE>>>", summary: "No review findings." });
}
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 0, output_tokens: 200, reasoning_output_tokens: 50 } }));
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
    "--project",
    project,
    "--real-codex",
    fakeCodex,
    "--mex-command",
    mex,
    "--ralphex-command",
    ralphex,
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

  assert.match(result.stdout + result.stderr, /CODEXLOOPER_RUN=PASS/);
  assert.equal(readFileSync(join(project, "result.txt"), "utf8"), "fixture-pass\n");
  assert.ok(existsSync(join(project, "docs", "plans", "completed", "fixture.md")));

  const runs = readFileSync(join(project, ".codexlooper", "model-runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    runs.some(
      (entry) =>
        entry.modelArg.includes("gpt-5.6-terra") &&
        entry.sandbox === "read-only" &&
        entry.outputSchema,
    ),
  );
  assert.ok(runs.some((entry) => entry.modelArg.includes("gpt-5.6-sol") && entry.sandbox === "read-only"));
  assert.ok(runs.every((entry) => entry.json === true));

  const runEntries = readdirSync(join(project, ".codexlooper", "runs"), { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  assert.equal(runEntries.length, 1);
  const runDirectory = join(project, ".codexlooper", "runs", runEntries[0].name);
  const receipt = JSON.parse(readFileSync(join(runDirectory, "receipt.json"), "utf8"));
  assert.equal(receipt.status, "completed");
  assert.ok(receipt.commits_created >= 1);
  assert.ok(receipt.usage.profiles.builder.calls >= 1);
  assert.ok(receipt.usage.profiles.reviewer.calls >= 1);
  assert.ok(receipt.usage.totals.estimated_cost_usd > 0);
  const hostEvents = readFileSync(join(runDirectory, "host-commits.jsonl"), "utf8");
  assert.match(hostEvents, /"transport":"structured_patch"/);
  assert.doesNotMatch(JSON.stringify(receipt), /closerouter_fixture_secret|GITHUB_TOKEN/);

  process.stdout.write("CODEXLOOPER_RALPHEX_E2E=PASS\n");
} finally {
  rmSync(root, { recursive: true, force: true });
}
