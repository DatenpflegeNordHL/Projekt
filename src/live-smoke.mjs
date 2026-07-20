import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { prepareProfileLaunch } from "./profiles.mjs";

const DEFAULT_BASE_URL = "https://api.closerouter.dev/v1";
const DEFAULT_MAX_OUTPUT_TOKENS = 64;
const MAX_MAX_OUTPUT_TOKENS = 128;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireSecret(env) {
  const secret = env.CLOSEROUTER_API_KEY;
  if (typeof secret !== "string" || secret.length < 8 || secret.includes("\0")) {
    fail("CODEXLOOPER_CREDENTIAL_MISSING", "CLOSEROUTER_API_KEY is required");
  }
  return secret;
}

function requireModel(model, label) {
  if (typeof model !== "string" || !/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(model)) {
    fail("CODEXLOOPER_MODEL_INVALID", `${label} must use provider/model format`);
  }
  return model;
}

function maxOutputTokens(env) {
  const raw = env.CODEXLOOPER_LIVE_MAX_OUTPUT_TOKENS || String(DEFAULT_MAX_OUTPUT_TOKENS);
  if (!/^\d+$/.test(raw)) fail("CODEXLOOPER_SMOKE_LIMIT_INVALID", "Live max output tokens must be an integer");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 16 || value > MAX_MAX_OUTPUT_TOKENS) {
    fail("CODEXLOOPER_SMOKE_LIMIT_INVALID", `Live max output tokens must be between 16 and ${MAX_MAX_OUTPUT_TOKENS}`);
  }
  return value;
}

function extractText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  if (Array.isArray(response.output)) {
    const parts = [];
    for (const item of response.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (content && typeof content.text === "string") parts.push(content.text);
      }
    }
    if (parts.length > 0) return parts.join("");
  }
  if (Array.isArray(response.choices)) {
    const content = response.choices[0]?.message?.content;
    if (typeof content === "string") return content;
  }
  return "";
}

function verifyIdentity(requestedModel, response) {
  const [requestedProvider, requestedName] = requestedModel.split("/", 2);
  const actualModel = response.model;
  const actualProvider = response.provider;
  if (typeof actualModel !== "string" || actualModel.length === 0) {
    fail("CODEXLOOPER_IDENTITY_MISSING", `CloseRouter omitted model identity for ${requestedModel}`);
  }
  const exact = actualModel === requestedModel;
  const separated = actualModel === requestedName && actualProvider === requestedProvider;
  if (!exact && !separated) {
    fail(
      "CODEXLOOPER_IDENTITY_MISMATCH",
      `Requested ${requestedModel}, received provider=${actualProvider ?? "missing"} model=${actualModel}`,
    );
  }
  if (actualProvider !== undefined && actualProvider !== requestedProvider) {
    fail(
      "CODEXLOOPER_IDENTITY_MISMATCH",
      `Requested provider ${requestedProvider}, received ${actualProvider}`,
    );
  }
  return {
    requested_model: requestedModel,
    response_model: actualModel,
    response_provider: actualProvider ?? requestedProvider,
  };
}

function requestId(headers) {
  return headers?.get?.("x-request-id") || headers?.get?.("request-id") || null;
}

function safeErrorBody(body, secret) {
  return String(body || "")
    .replaceAll(secret, "[REDACTED]")
    .replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]")
    .slice(0, 500);
}

async function responseSmoke({ profile, model, secret, baseUrl, tokens, fetchImpl, nonce }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: `Return this token exactly once: ${nonce}`,
        max_output_tokens: tokens,
        reasoning: { effort: "low" },
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    fail("CODEXLOOPER_LIVE_REQUEST_FAILED", `${profile} request failed: ${safeErrorBody(error?.message, secret)}`);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  if (!response.ok) {
    fail(
      "CODEXLOOPER_LIVE_HTTP_ERROR",
      `${profile} returned HTTP ${response.status}, request_id=${requestId(response.headers) ?? "missing"}: ${safeErrorBody(raw, secret)}`,
    );
  }

  let decoded;
  try {
    decoded = JSON.parse(raw);
  } catch {
    fail("CODEXLOOPER_LIVE_INVALID_JSON", `${profile} returned invalid JSON`);
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    fail("CODEXLOOPER_LIVE_INVALID_JSON", `${profile} returned a non-object response`);
  }

  const identity = verifyIdentity(model, decoded);
  const text = extractText(decoded);
  if (!text.includes(nonce)) {
    fail("CODEXLOOPER_LIVE_NONCE_MISSING", `${profile} did not return the smoke nonce`);
  }

  const usage = decoded.usage && typeof decoded.usage === "object" ? decoded.usage : {};
  return {
    profile,
    transport: "responses-api",
    ...identity,
    request_id: requestId(response.headers) || decoded.request_id || null,
    nonce_verified: true,
    usage: {
      input_tokens: usage.input_tokens ?? usage.prompt_tokens ?? null,
      output_tokens: usage.output_tokens ?? usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      cost_usd: usage.cost_usd ?? null,
    },
  };
}

function cliSmoke({ profile, nonce, env, projectRoot, spawnImpl }) {
  const launch = prepareProfileLaunch(profile, {
    json: false,
    sandbox: "read-only",
    sourceEnv: env,
    projectRoot,
  });
  const result = spawnImpl(launch.command, launch.args, {
    cwd: projectRoot,
    env: launch.env,
    input: `Return this token exactly once: ${nonce}`,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail("CODEXLOOPER_CLI_SMOKE_FAILED", `${profile} Codex smoke exited with status ${result.status ?? "unknown"}`);
  }
  if (!String(result.stdout || "").includes(nonce)) {
    fail("CODEXLOOPER_CLI_NONCE_MISSING", `${profile} Codex smoke did not return the nonce`);
  }
  return {
    profile,
    transport: "codex-cli-responses",
    configured_model: launch.metadata.model,
    configured_reasoning: launch.metadata.reasoning,
    configured_sandbox: launch.metadata.sandbox,
    nonce_verified: true,
  };
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export async function runLiveSmoke({
  env = process.env,
  projectRoot = process.cwd(),
  fetchImpl = globalThis.fetch,
  spawnImpl = spawnSync,
  randomBytesImpl = randomBytes,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") fail("CODEXLOOPER_FETCH_MISSING", "A Fetch implementation is required");
  const secret = requireSecret(env);
  const root = resolve(projectRoot);
  const baseUrl = (env.CLOSEROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  if (baseUrl !== DEFAULT_BASE_URL) fail("CODEXLOOPER_BASE_URL_REJECTED", "Only the official CloseRouter base URL is allowed");

  const profiles = [
    ["builder", requireModel(env.CODEXLOOPER_BUILDER_MODEL || "openai/gpt-5.6-terra", "Builder model")],
    ["reviewer", requireModel(env.CODEXLOOPER_REVIEW_MODEL || "openai/gpt-5.6-sol", "Reviewer model")],
  ];
  if (profiles[0][1] === profiles[1][1]) fail("CODEXLOOPER_MODEL_SEPARATION_REQUIRED", "Builder and reviewer models must differ");

  const tokens = maxOutputTokens(env);
  const results = [];
  for (const [profile, model] of profiles) {
    const nonce = `CODEXLOOPER_${profile.toUpperCase()}_${randomBytesImpl(12).toString("hex")}`;
    results.push(await responseSmoke({ profile, model, secret, baseUrl, tokens, fetchImpl, nonce }));
  }

  if (env.CODEXLOOPER_RUN_CLI_SMOKE === "1") {
    for (const [profile] of profiles) {
      const nonce = `CODEXLOOPER_CLI_${profile.toUpperCase()}_${randomBytesImpl(12).toString("hex")}`;
      results.push(cliSmoke({ profile, nonce, env, projectRoot: root, spawnImpl }));
    }
  }

  const receipt = {
    schema: "codexlooper.live-smoke.v1",
    created_at: now().toISOString(),
    base_url: baseUrl,
    max_output_tokens: tokens,
    results,
  };
  const receiptPath = resolve(root, env.CODEXLOOPER_SMOKE_RECEIPT || ".codexlooper/live-smoke-receipt.json");
  const receiptRelative = relative(root, receiptPath);
  if (!receiptRelative || receiptRelative.startsWith("..") || isAbsolute(receiptRelative)) {
    fail("CODEXLOOPER_RECEIPT_PATH_REJECTED", "Smoke receipt must be a file inside the project root");
  }
  writeAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, receiptPath };
}
