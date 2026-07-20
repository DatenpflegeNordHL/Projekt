import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  recordCodexDiagnosticLine,
  sanitizeCodexDiagnosticLine,
} from "../src/codex-diagnostics.mjs";

test("keeps only bounded redacted command diagnostics", () => {
  const secret = "closerouter_secret_value";
  const value = sanitizeCodexDiagnosticLine(
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: `echo ${secret}`,
        aggregated_output: `Authorization: Bearer ${secret}\npermission denied`,
        exit_code: 1,
        status: "failed",
      },
    }),
    secret,
  );
  assert.equal(value.item_type, "command_execution");
  assert.equal(value.exit_code, 1);
  assert.doesNotMatch(JSON.stringify(value), new RegExp(secret));
  assert.match(value.output_tail, /REDACTED/);
});

test("does not retain agent messages or reasoning", () => {
  assert.equal(
    sanitizeCodexDiagnosticLine(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "private" } }),
      "secret",
    ),
    null,
  );
  assert.equal(
    sanitizeCodexDiagnosticLine(
      JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "private" } }),
      "secret",
    ),
    null,
  );
});

test("writes diagnostics only when explicitly enabled", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-diagnostic-"));
  const project = join(root, "project");
  const runDirectory = resolve(project, ".codexlooper", "runs", "run-1");
  const line = JSON.stringify({
    type: "item.completed",
    item: {
      type: "file_change",
      status: "failed",
      changes: [{ path: "src/value.mjs", kind: "update", diff: "must-not-be-kept" }],
    },
  });
  try {
    assert.equal(
      recordCodexDiagnosticLine(line, {
        sourceEnv: {
          CODEXLOOPER_CAPTURE_DIAGNOSTICS: "1",
          CODEXLOOPER_RUN_ID: "run-1",
          CODEXLOOPER_RUN_DIR: runDirectory,
        },
        projectRoot: project,
        now: () => new Date("2026-07-20T18:30:00.000Z"),
      }),
      true,
    );
    const written = readFileSync(join(runDirectory, "builder-diagnostics.jsonl"), "utf8");
    assert.match(written, /src\/value\.mjs/);
    assert.doesNotMatch(written, /must-not-be-kept/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
