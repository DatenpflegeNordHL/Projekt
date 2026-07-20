import { accessSync, constants } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const DEFAULT_MODELS = [
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol",
];

const SAFE_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

const ALLOWED_SANDBOXES = new Set(["read-only", "workspace-write"]);
const ALLOWED_REASONING = new Set(["low", "medium", "high"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseJsonString(raw, label) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("CODEXLOOPER_INVALID_OVERRIDE", `${label} must be a quoted string`);
  }
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\n")) {
    fail("CODEXLOOPER_INVALID_OVERRIDE", `${label} is invalid`);
  }
  return value;
}

function allowedModels(sourceEnv) {
  const configured = sourceEnv.CODEXLOOPER_ALLOWED_MODELS;
  const values = configured
    ? configured.split(",").map((value) => value.trim()).filter(Boolean)
    : DEFAULT_MODELS;
  if (values.length === 0) {
    fail("CODEXLOOPER_MODEL_POLICY_EMPTY", "No models are allowed");
  }
  return new Set(values);
}

function ensureWithinProject(candidate, projectRoot, label) {
  const root = resolve(projectRoot);
  const target = resolve(root, candidate);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    fail("CODEXLOOPER_PATH_OUTSIDE_PROJECT", `${label} must stay inside the project root`);
  }
  return target;
}

function validateOverride(raw, state, sourceEnv, projectRoot) {
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    fail("CODEXLOOPER_INVALID_OVERRIDE", "Codex -c overrides must use key=value");
  }

  const key = raw.slice(0, separator);
  const value = raw.slice(separator + 1);
  if (state.keys.has(key)) {
    fail("CODEXLOOPER_DUPLICATE_OVERRIDE", `Duplicate Codex override: ${key}`);
  }
  state.keys.add(key);

  switch (key) {
    case "model": {
      const model = parseJsonString(value, "model");
      if (!allowedModels(sourceEnv).has(model)) {
        fail("CODEXLOOPER_MODEL_REJECTED", `Model is not allowed: ${model}`);
      }
      state.model = model;
      return;
    }
    case "model_reasoning_effort":
      if (!ALLOWED_REASONING.has(value)) {
        fail("CODEXLOOPER_REASONING_REJECTED", `Reasoning effort is not allowed: ${value}`);
      }
      state.reasoning = value;
      return;
    case "stream_idle_timeout_ms": {
      if (!/^\d+$/.test(value)) {
        fail("CODEXLOOPER_INVALID_OVERRIDE", "stream_idle_timeout_ms must be an integer");
      }
      const timeout = Number(value);
      if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 7_200_000) {
        fail("CODEXLOOPER_INVALID_OVERRIDE", "stream_idle_timeout_ms is outside the allowed range");
      }
      state.timeout = timeout;
      return;
    }
    case "features.multi_agent":
      if (value !== "true") {
        fail("CODEXLOOPER_INVALID_OVERRIDE", "features.multi_agent may only be true");
      }
      state.multiAgent = true;
      return;
    case "agents.reviewer.description": {
      const description = parseJsonString(value, "reviewer description");
      if (description.length > 500 || !/^[\x20-\x7E]+$/.test(description)) {
        fail("CODEXLOOPER_INVALID_OVERRIDE", "Reviewer description must be short printable ASCII");
      }
      state.reviewerDescription = description;
      return;
    }
    case "project_doc_fallback_filenames":
      if (value !== '["CLAUDE.md"]') {
        fail("CODEXLOOPER_INVALID_OVERRIDE", "Only CLAUDE.md fallback is allowed");
      }
      state.projectDocFallback = true;
      return;
    case "project_doc": {
      const projectDoc = parseJsonString(value, "project_doc");
      ensureWithinProject(projectDoc, projectRoot, "project_doc");
      state.projectDoc = projectDoc;
      return;
    }
    default:
      fail("CODEXLOOPER_OVERRIDE_REJECTED", `Codex override is not allowed: ${key}`);
  }
}

export function parseCodexArgs(args, sourceEnv = process.env, projectRoot = process.cwd()) {
  if (!Array.isArray(args) || args[0] !== "exec") {
    fail("CODEXLOOPER_ARGUMENTS_REJECTED", "Only `codex exec` is allowed");
  }

  const state = {
    keys: new Set(),
    sandbox: undefined,
    ephemeral: false,
    model: undefined,
    reasoning: undefined,
    timeout: undefined,
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--ephemeral") {
      if (state.ephemeral) {
        fail("CODEXLOOPER_ARGUMENTS_REJECTED", "--ephemeral may be specified only once");
      }
      state.ephemeral = true;
      continue;
    }

    if (arg === "--sandbox") {
      if (state.sandbox !== undefined || index + 1 >= args.length) {
        fail("CODEXLOOPER_ARGUMENTS_REJECTED", "Sandbox must be specified exactly once");
      }
      state.sandbox = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--sandbox=")) {
      if (state.sandbox !== undefined) {
        fail("CODEXLOOPER_ARGUMENTS_REJECTED", "Sandbox must be specified exactly once");
      }
      state.sandbox = arg.slice("--sandbox=".length);
      continue;
    }

    if (arg === "-c") {
      if (index + 1 >= args.length) {
        fail("CODEXLOOPER_ARGUMENTS_REJECTED", "-c requires one override");
      }
      validateOverride(args[index + 1], state, sourceEnv, projectRoot);
      index += 1;
      continue;
    }

    fail("CODEXLOOPER_ARGUMENTS_REJECTED", `Codex argument is not allowed: ${arg}`);
  }

  if (!ALLOWED_SANDBOXES.has(state.sandbox)) {
    fail("CODEXLOOPER_SANDBOX_REJECTED", `Sandbox is not allowed: ${state.sandbox ?? "missing"}`);
  }
  if (!state.model || !state.reasoning || state.timeout === undefined) {
    fail("CODEXLOOPER_REQUIRED_OVERRIDE_MISSING", "Model, reasoning and timeout overrides are required");
  }
  if (state.reviewerDescription && !state.multiAgent) {
    fail("CODEXLOOPER_INVALID_OVERRIDE", "Reviewer registration requires multi-agent mode");
  }

  return {
    args: [...args],
    model: state.model,
    reasoning: state.reasoning,
    sandbox: state.sandbox,
    multiAgent: Boolean(state.multiAgent),
  };
}

export function buildChildEnv(sourceEnv = process.env, projectRoot = process.cwd()) {
  const secret = sourceEnv.CLOSEROUTER_API_KEY;
  if (typeof secret !== "string" || secret.length < 8 || secret.includes("\0")) {
    fail("CODEXLOOPER_CREDENTIAL_MISSING", "CLOSEROUTER_API_KEY is required");
  }

  const codeHome = sourceEnv.CODEX_HOME
    ? ensureWithinProject(sourceEnv.CODEX_HOME, projectRoot, "CODEX_HOME")
    : resolve(projectRoot, ".codexlooper", "codex-home");

  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) {
      env[key] = sourceEnv[key];
    }
  }

  env.CLOSEROUTER_API_KEY = secret;
  env.CODEX_HOME = codeHome;
  env.DO_NOT_TRACK = "1";

  return env;
}

export function resolveRealCodex(sourceEnv = process.env) {
  const realCodex = sourceEnv.CODEXLOOPER_REAL_CODEX;
  if (typeof realCodex !== "string" || !isAbsolute(realCodex)) {
    fail("CODEXLOOPER_REAL_CODEX_INVALID", "CODEXLOOPER_REAL_CODEX must be an absolute path");
  }
  try {
    accessSync(realCodex, constants.X_OK);
  } catch {
    fail("CODEXLOOPER_REAL_CODEX_INVALID", "Configured Codex CLI is not executable");
  }
  return realCodex;
}

export function prepareLaunch(args, sourceEnv = process.env, projectRoot = process.cwd()) {
  const parsed = parseCodexArgs(args, sourceEnv, projectRoot);
  return {
    command: resolveRealCodex(sourceEnv),
    args: parsed.args,
    env: buildChildEnv(sourceEnv, projectRoot),
    metadata: {
      model: parsed.model,
      reasoning: parsed.reasoning,
      sandbox: parsed.sandbox,
      multi_agent: parsed.multiAgent,
    },
  };
}
