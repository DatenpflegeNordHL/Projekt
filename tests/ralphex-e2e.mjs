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
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";\nimport { spawnSync } from "node:child_process";\nimport { join } from "node:path";\n\nif (process.argv[2] === "--version") { console.log("codex-cli 0.130.0"); process.exit(0); }\nif (!process.env.CLOSEROUTER_API_KEY) process.exit(31);\nif (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GITHUB_TOKEN) process.exit(32);\nconst args = process.argv.slice(2);\nconst prompt = readFileSync(0, "utf8");\nconst modelArg = args.find((value) => value.startsWith("model=\"")) || "model=unknown";\nconst sandboxIndex = args.indexOf("--sandbox");\nconst sandbox = sandboxIndex >= 0 ? args[sandboxIndex + 1] : "missing";\nappendFileSync(join(process.cwd(), "model-runs.jsonl"), JSON.stringify({ modelArg, sandbox, json: args.includes("--json") }) + "\\n");\n\nif (!args.includes("--json")) { console.log("NO ISSUES FOUND"); process.exit(0); }\nlet signal;\nif (prompt.includes("Read the plan file at")) {\n  const planPath = join(process.cwd(), "docs", "plans", "fixture.md");\n  writeFileSync(join(process.cwd(), "result.txt"), "fixture-pass\\n");\n  writeFileSync(planPath, readFileSync(planPath, "utf8").replace("- [ ] Create", "- [x] Create"));\n  for (const command of [\n    ["add", "result.txt", "docs/plans/fixture.md"],\n    ["commit", "-m", "feat: complete offline fixture"],\n  ]) {\n    const result = spawnSync("/usr/bin/git", command, { cwd: process.cwd(), encoding: "utf8" });\n    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(33); }\n  }\n  signal = "<<<RALPHEX:ALL_TASKS_DONE>>>";\n} else if (prompt.includes("External code review evaluation")) {\n  signal = "<<<RALPHEX:CODEX_REVIEW_DONE>>>";\n} else {\n  signal = "<<<RALPHEX:REVIEW_DONE>>>";\n}\nconsole.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: signal } }));\nconsole.log(JSON.stringify({ type: "turn.completed" }));\n`,
  );
  const fakeCodex = executable(
    join(tools, "codex"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeCodexSource)} "$@"\n`,
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
