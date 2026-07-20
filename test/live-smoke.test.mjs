import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLiveSmoke } from "../src/live-smoke.mjs";

function headers(values = {}) {
  const normalized = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (key) => normalized.get(String(key).toLowerCase()) || null };
}

function response(body, { status = 200, responseHeaders = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(responseHeaders),
    text: async () => JSON.stringify(body),
  };
}

function baseEnv(project, overrides = {}) {
  return {
    CLOSEROUTER_API_KEY: "closerouter_test_secret",
    CODEX_HOME: join(project, ".codexlooper", "codex-home"),
    CODEXLOOPER_ALLOWED_MODELS: "openai/gpt-5.6-terra,openai/gpt-5.6-sol",
    ...overrides,
  };
}

test("live smoke verifies Terra and Sol identities and writes a secret-free receipt", async () => {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-live-"));
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    const [provider, model] = request.model.split("/");
    const nonce = request.input.match(/CODEXLOOPER_[A-Z]+_[a-f0-9]+/)[0];
    return response(
      {
        id: `resp_${calls.length}`,
        model,
        provider,
        output_text: nonce,
        usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12, cost_usd: 0.0001 },
      },
      { responseHeaders: { "x-request-id": `req_${calls.length}` } },
    );
  };

  try {
    const result = await runLiveSmoke({
      env: baseEnv(project),
      projectRoot: project,
      fetchImpl,
      randomBytesImpl: () => Buffer.from("0123456789ab", "hex"),
      now: () => new Date("2026-07-20T16:00:00.000Z"),
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.model), ["openai/gpt-5.6-terra", "openai/gpt-5.6-sol"]);
    assert.equal(result.receipt.results.length, 2);
    assert.equal(result.receipt.results[0].request_id, "req_1");
    const stored = readFileSync(result.receiptPath, "utf8");
    assert.doesNotMatch(stored, /closerouter_test_secret|Authorization|Bearer/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("live smoke blocks a model identity mismatch", async () => {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-live-"));
  try {
    await assert.rejects(
      () => runLiveSmoke({
        env: baseEnv(project),
        projectRoot: project,
        fetchImpl: async () => response({
          model: "gpt-5.4-mini",
          provider: "openai",
          output_text: "CODEXLOOPER_BUILDER_0123456789ab",
        }),
        randomBytesImpl: () => Buffer.from("0123456789ab", "hex"),
      }),
      (error) => error.code === "CODEXLOOPER_IDENTITY_MISMATCH",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("optional Codex CLI smoke uses both controlled profiles", async () => {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-live-"));
  const tools = join(project, "tools");
  mkdirSync(tools, { recursive: true });
  const codex = join(tools, "codex");
  writeFileSync(codex, "#!/bin/sh\ncat\n", { mode: 0o700 });
  chmodSync(codex, 0o700);

  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    const [provider, model] = request.model.split("/");
    const nonce = request.input.match(/CODEXLOOPER_[A-Z]+_[a-f0-9]+/)[0];
    return response({ model, provider, output_text: nonce });
  };

  try {
    const result = await runLiveSmoke({
      env: baseEnv(project, {
        CODEXLOOPER_REAL_CODEX: codex,
        CODEXLOOPER_RUN_CLI_SMOKE: "1",
      }),
      projectRoot: project,
      fetchImpl,
      randomBytesImpl: () => Buffer.from("0123456789ab", "hex"),
    });
    assert.equal(result.receipt.results.length, 4);
    assert.deepEqual(
      result.receipt.results.filter((entry) => entry.transport === "codex-cli-responses").map((entry) => entry.profile),
      ["builder", "reviewer"],
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
