import test from "node:test";
import assert from "node:assert/strict";
import { buildChildEnv, parseCodexArgs } from "../src/launcher.mjs";

const projectRoot = "/tmp/codexlooper-project";
const baseEnv = {
  CODEXLOOPER_ALLOWED_MODELS: "openai/gpt-5.6-terra,openai/gpt-5.6-sol",
};

function taskArgs(model = "openai/gpt-5.6-terra") {
  return [
    "exec",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    "-c",
    `model=${JSON.stringify(model)}`,
    "-c",
    "model_reasoning_effort=medium",
    "-c",
    "stream_idle_timeout_ms=3600000",
  ];
}

test("accepts the bounded Ralphex task invocation", () => {
  const parsed = parseCodexArgs(taskArgs(), baseEnv, projectRoot);
  assert.equal(parsed.model, "openai/gpt-5.6-terra");
  assert.equal(parsed.reasoning, "medium");
  assert.equal(parsed.sandbox, "workspace-write");
  assert.equal(parsed.multiAgent, false);
});

test("accepts the separate Sol multi-agent review invocation", () => {
  const args = [
    "exec",
    "--ephemeral",
    "-c",
    "features.multi_agent=true",
    "-c",
    `agents.reviewer.description=${JSON.stringify("general code review specialist; behavior driven by the task argument")}`,
    "-c",
    `model=${JSON.stringify("openai/gpt-5.6-sol")}`,
    "-c",
    "model_reasoning_effort=high",
    "-c",
    "stream_idle_timeout_ms=3600000",
    "--sandbox=read-only",
  ];
  const parsed = parseCodexArgs(args, baseEnv, projectRoot);
  assert.equal(parsed.model, "openai/gpt-5.6-sol");
  assert.equal(parsed.reasoning, "high");
  assert.equal(parsed.multiAgent, true);
});

test("allows only project-local project documentation", () => {
  const args = [...taskArgs(), "-c", `project_doc=${JSON.stringify("AGENTS.md")}`];
  assert.doesNotThrow(() => parseCodexArgs(args, baseEnv, projectRoot));

  const outside = [...taskArgs(), "-c", `project_doc=${JSON.stringify("../outside.md")}`];
  assert.throws(
    () => parseCodexArgs(outside, baseEnv, projectRoot),
    (error) => error.code === "CODEXLOOPER_PATH_OUTSIDE_PROJECT",
  );
});

test("rejects unknown overrides and dangerous flags", () => {
  assert.throws(
    () => parseCodexArgs([...taskArgs(), "-c", "approval_policy=never"], baseEnv, projectRoot),
    (error) => error.code === "CODEXLOOPER_OVERRIDE_REJECTED",
  );
  assert.throws(
    () => parseCodexArgs([...taskArgs(), "--dangerously-bypass-approvals-and-sandbox"], baseEnv, projectRoot),
    (error) => error.code === "CODEXLOOPER_ARGUMENTS_REJECTED",
  );
});

test("rejects unapproved models, duplicate overrides and missing required overrides", () => {
  assert.throws(
    () => parseCodexArgs(taskArgs("openai/gpt-5.4-mini"), baseEnv, projectRoot),
    (error) => error.code === "CODEXLOOPER_MODEL_REJECTED",
  );
  assert.throws(
    () => parseCodexArgs([...taskArgs(), "-c", "model_reasoning_effort=high"], baseEnv, projectRoot),
    (error) => error.code === "CODEXLOOPER_DUPLICATE_OVERRIDE",
  );
  assert.throws(
    () => parseCodexArgs(["exec", "--ephemeral", "--sandbox", "workspace-write"], baseEnv, projectRoot),
    (error) => error.code === "CODEXLOOPER_REQUIRED_OVERRIDE_MISSING",
  );
});

test("rejects non-ephemeral executions", () => {
  const args = taskArgs().filter((value) => value !== "--ephemeral");
  assert.throws(
    () => parseCodexArgs(args, baseEnv, projectRoot),
    (error) => error.code === "CODEXLOOPER_EPHEMERAL_REQUIRED",
  );
});

test("passes only the allowlisted child environment and the CloseRouter credential", () => {
  const child = buildChildEnv(
    {
      HOME: "/home/tester",
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      CLOSEROUTER_API_KEY: "closerouter_test_secret",
      CODEX_HOME: `${projectRoot}/.codexlooper/codex-home`,
      OPENAI_API_KEY: "must-not-pass",
      ANTHROPIC_API_KEY: "must-not-pass",
      GITHUB_TOKEN: "must-not-pass",
      NODE_OPTIONS: "--require evil.js",
    },
    projectRoot,
  );

  assert.equal(child.CLOSEROUTER_API_KEY, "closerouter_test_secret");
  assert.equal(child.CODEX_HOME, `${projectRoot}/.codexlooper/codex-home`);
  assert.equal(child.OPENAI_API_KEY, undefined);
  assert.equal(child.ANTHROPIC_API_KEY, undefined);
  assert.equal(child.GITHUB_TOKEN, undefined);
  assert.equal(child.NODE_OPTIONS, undefined);
});

test("requires the CloseRouter credential", () => {
  assert.throws(
    () => buildChildEnv({ HOME: "/home/tester" }, projectRoot),
    (error) => error.code === "CODEXLOOPER_CREDENTIAL_MISSING",
  );
});
