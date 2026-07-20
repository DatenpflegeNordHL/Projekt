import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  aggregateUsage,
  parseCodexUsageLine,
  readUsageEvents,
  recordCodexUsageLine,
} from "../src/telemetry.mjs";

test("parses official Codex turn.completed usage", () => {
  const usage = parseCodexUsageLine(
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 400,
        cache_write_input_tokens: 100,
        output_tokens: 200,
        reasoning_output_tokens: 50,
      },
    }),
  );
  assert.deepEqual(usage, {
    input_tokens: 1000,
    cached_input_tokens: 400,
    cache_write_input_tokens: 100,
    output_tokens: 200,
    reasoning_output_tokens: 50,
  });
});

test("records secret-free usage and calculates pinned model costs", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-telemetry-"));
  const project = join(root, "project");
  const runDirectory = resolve(project, ".codexlooper", "runs", "run-1");
  try {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 1000,
        cached_input_tokens: 400,
        cache_write_input_tokens: 100,
        output_tokens: 200,
        reasoning_output_tokens: 50,
      },
    });
    assert.equal(
      recordCodexUsageLine(
        line,
        {
          profile: "builder",
          model: "openai/gpt-5.6-terra",
          reasoning: "medium",
          sandbox: "workspace-write",
        },
        {
          sourceEnv: {
            CODEXLOOPER_RUN_ID: "run-1",
            CODEXLOOPER_RUN_DIR: runDirectory,
          },
          projectRoot: project,
          now: () => new Date("2026-07-20T17:00:00.000Z"),
        },
      ),
      true,
    );
    const events = readUsageEvents(runDirectory);
    assert.equal(events.length, 1);
    const aggregate = aggregateUsage(events);
    assert.equal(aggregate.profiles.builder.calls, 1);
    assert.equal(aggregate.totals.input_tokens, 1000);
    assert.equal(aggregate.totals.output_tokens, 200);
    assert.equal(aggregate.totals.estimated_cost_usd, 0.0001296);
    assert.doesNotMatch(readFileSync(join(runDirectory, "usage.jsonl"), "utf8"), /API_KEY|Bearer/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects invalid and unpriced usage", () => {
  assert.throws(
    () =>
      parseCodexUsageLine(
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 1, cached_input_tokens: 2, output_tokens: 0 },
        }),
      ),
    (error) => error.code === "CODEXLOOPER_USAGE_INVALID",
  );
  assert.throws(
    () =>
      aggregateUsage([
        {
          profile: "builder",
          model: "openai/unknown",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]),
    (error) => error.code === "CODEXLOOPER_PRICE_MISSING",
  );
});
