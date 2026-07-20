import test from "node:test";
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
import { join } from "node:path";
import { bootstrap } from "../src/bootstrap.mjs";

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

function fixture({ customAgents = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-bootstrap-"));
  const project = join(root, "target-project");
  const tools = join(root, "tools");
  mkdirSync(project, { recursive: true });
  mkdirSync(tools, { recursive: true });
  run("/usr/bin/git", ["init", "-b", "main", project]);
  run("/usr/bin/git", ["-C", project, "config", "user.name", "Bootstrap Fixture"]);
  run("/usr/bin/git", ["-C", project, "config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(project, "README.md"), "# Existing project\n");
  if (customAgents) writeFileSync(join(project, "AGENTS.md"), "# Custom agent contract\n");
  run("/usr/bin/git", ["-C", project, "add", "."]);
  run("/usr/bin/git", ["-C", project, "commit", "-m", "chore: initialize target"]);

  const codex = executable(
    join(tools, "codex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then echo 'codex-cli 0.144.6'; exit 0; fi\nexit 2\n",
  );
  const ralphex = executable(
    join(tools, "ralphex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then echo 'ralphex v1.6.0'; exit 0; fi\nexit 2\n",
  );
  const mex = executable(
    join(tools, "mex"),
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "setup" ]; then
  mkdir -p .mex/events
  if [ ! -f .mex/events/decisions.jsonl ]; then
    printf '%s\\n' '{"type":"decision","id":"bootstrap","summary":"Initialized by CodexLooper"}' > .mex/events/decisions.jsonl
  fi
  exit 0
fi
if [ "\${1:-}" = "check" ] && [ "\${2:-}" = "--json" ]; then
  echo '{"score":100,"issues":[]}'
  exit 0
fi
exit 2
`,
  );

  return { root, project, codex, mex, ralphex };
}

function args(current) {
  return [
    "--project",
    current.project,
    "--real-codex",
    current.codex,
    "--mex-command",
    current.mex,
    "--ralphex-command",
    current.ralphex,
  ];
}

test("bootstraps a clean Git project without replacing existing project files", () => {
  const current = fixture({ customAgents: true });
  try {
    const result = bootstrap(args(current), {
      now: () => new Date("2026-07-20T20:00:00.000Z"),
    });
    assert.equal(readFileSync(join(current.project, "README.md"), "utf8"), "# Existing project\n");
    assert.equal(readFileSync(join(current.project, "AGENTS.md"), "utf8"), "# Custom agent contract\n");
    assert.ok(existsSync(join(current.project, "ROUTER.md")));
    assert.ok(existsSync(join(current.project, "PROJECT_SPEC.md")));
    assert.ok(existsSync(join(current.project, "context", "project-state.md")));
    assert.ok(existsSync(join(current.project, "patterns", "INDEX.md")));
    assert.ok(existsSync(join(current.project, "docs", "plans", "README.md")));
    assert.ok(existsSync(join(current.project, ".mex", "events", "decisions.jsonl")));
    assert.ok(existsSync(result.runCommand));
    assert.equal(result.receipt.status, "completed");
    assert.equal(result.receipt.project_name, "target-project");
    assert.equal(result.receipt.mex_score, 100);
    assert.equal(result.receipt.secret_free, true);
    assert.equal(
      result.receipt.files.find((entry) => entry.path === "AGENTS.md")?.status,
      "preserved",
    );
    const rawReceipt = readFileSync(result.receiptPath, "utf8");
    assert.doesNotMatch(rawReceipt, /CLOSEROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN/);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("bootstrap is idempotent after committing its visible scaffold", () => {
  const current = fixture();
  try {
    const first = bootstrap(args(current));
    run("/usr/bin/git", ["-C", current.project, "add", "."]);
    run("/usr/bin/git", ["-C", current.project, "commit", "-m", "chore: add agent scaffold"]);
    const second = bootstrap(args(current));
    assert.equal(second.receipt.visible_changes.length, 0);
    assert.ok(second.receipt.files.every((entry) => entry.status === "preserved"));
    assert.equal(second.runCommand, first.runCommand);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});

test("bootstrap blocks a dirty worktree before writing files", () => {
  const current = fixture();
  try {
    writeFileSync(join(current.project, "README.md"), "dirty\n");
    assert.throws(
      () => bootstrap(args(current)),
      (error) => error.code === "CODEXLOOPER_BOOTSTRAP_DIRTY",
    );
    assert.equal(existsSync(join(current.project, "ROUTER.md")), false);
  } finally {
    rmSync(current.root, { recursive: true, force: true });
  }
});
