import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const MODEL_PRICING = Object.freeze({
  "openai/gpt-5.6-terra": Object.freeze({
    input_usd_per_million: 0.09,
    cached_input_usd_per_million: 0.009,
    output_usd_per_million: 0.36,
    verified_at: "2026-07-20",
    source: "closerouter-catalog",
  }),
  "openai/gpt-5.6-sol": Object.freeze({
    input_usd_per_million: 0.0945,
    cached_input_usd_per_million: 0.00945,
    output_usd_per_million: 0.378,
    verified_at: "2026-07-20",
    source: "closerouter-catalog",
  }),
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function nonNegativeInteger(value, label) {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("CODEXLOOPER_USAGE_INVALID", `${label} must be a non-negative integer`);
  }
  return value;
}

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("CODEXLOOPER_USAGE_INVALID", "Codex usage must be an object");
  }
  const usage = {
    input_tokens: nonNegativeInteger(raw.input_tokens, "input_tokens"),
    cached_input_tokens: nonNegativeInteger(raw.cached_input_tokens, "cached_input_tokens"),
    cache_write_input_tokens: nonNegativeInteger(
      raw.cache_write_input_tokens,
      "cache_write_input_tokens",
    ),
    output_tokens: nonNegativeInteger(raw.output_tokens, "output_tokens"),
    reasoning_output_tokens: nonNegativeInteger(
      raw.reasoning_output_tokens,
      "reasoning_output_tokens",
    ),
  };
  if (usage.cached_input_tokens > usage.input_tokens) {
    fail("CODEXLOOPER_USAGE_INVALID", "cached_input_tokens exceeds input_tokens");
  }
  return usage;
}

export function parseCodexUsageLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (event?.type !== "turn.completed" || !event.usage) return null;
  return normalizeUsage(event.usage);
}

function requireRunDirectory(sourceEnv, projectRoot) {
  const configured = sourceEnv.CODEXLOOPER_RUN_DIR;
  if (!configured) return null;
  if (!isAbsolute(configured)) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "CODEXLOOPER_RUN_DIR must be absolute");
  }
  const root = resolve(projectRoot, ".codexlooper", "runs");
  const target = resolve(configured);
  const targetRelative = relative(root, target);
  if (!targetRelative || targetRelative.startsWith("..") || isAbsolute(targetRelative)) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "CODEXLOOPER_RUN_DIR must be inside .codexlooper/runs");
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("CODEXLOOPER_RUN_DIR_INVALID", "CODEXLOOPER_RUN_DIR must be a real directory");
    }
  } else {
    mkdirSync(target, { recursive: false, mode: 0o700 });
  }
  chmodSync(target, 0o700);
  return target;
}

export function recordCodexUsageLine(
  line,
  metadata,
  { sourceEnv = process.env, projectRoot = process.cwd(), now = () => new Date() } = {},
) {
  const usage = parseCodexUsageLine(line);
  if (!usage) return false;
  const runDirectory = requireRunDirectory(sourceEnv, projectRoot);
  if (!runDirectory) return false;
  if (!metadata || typeof metadata !== "object") {
    fail("CODEXLOOPER_USAGE_METADATA_INVALID", "Usage metadata is required");
  }
  const event = {
    schema: "codexlooper.usage.v1",
    created_at: now().toISOString(),
    run_id: sourceEnv.CODEXLOOPER_RUN_ID || null,
    profile: metadata.profile,
    model: metadata.model,
    reasoning: metadata.reasoning,
    sandbox: metadata.sandbox,
    usage,
  };
  const path = resolve(runDirectory, "usage.jsonl");
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return true;
}

export function readUsageEvents(runDirectory) {
  const path = resolve(runDirectory, "usage.jsonl");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      fail("CODEXLOOPER_USAGE_FILE_INVALID", `Usage event ${index + 1} is invalid JSON`);
    }
    if (event?.schema !== "codexlooper.usage.v1") {
      fail("CODEXLOOPER_USAGE_FILE_INVALID", `Usage event ${index + 1} has an unknown schema`);
    }
    return { ...event, usage: normalizeUsage(event.usage) };
  });
}

function pricedUsage(model, usage, pricing) {
  const rate = pricing[model];
  if (!rate) fail("CODEXLOOPER_PRICE_MISSING", `No price snapshot for model ${model}`);
  const uncachedInput = usage.input_tokens - usage.cached_input_tokens;
  const inputCost = (uncachedInput / 1_000_000) * rate.input_usd_per_million;
  const cachedCost =
    (usage.cached_input_tokens / 1_000_000) * rate.cached_input_usd_per_million;
  const outputCost = (usage.output_tokens / 1_000_000) * rate.output_usd_per_million;
  return {
    input_usd: inputCost,
    cached_input_usd: cachedCost,
    output_usd: outputCost,
    total_usd: inputCost + cachedCost + outputCost,
    rate,
  };
}

export function aggregateUsage(events, pricing = MODEL_PRICING) {
  const totals = {
    calls: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    estimated_cost_usd: 0,
  };
  const profiles = {};
  for (const event of events) {
    const usage = normalizeUsage(event.usage);
    const priced = pricedUsage(event.model, usage, pricing);
    const profile = event.profile || "unknown";
    const current = profiles[profile] || {
      calls: 0,
      models: {},
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      estimated_cost_usd: 0,
    };
    current.calls += 1;
    current.models[event.model] = (current.models[event.model] || 0) + 1;
    for (const key of [
      "input_tokens",
      "cached_input_tokens",
      "cache_write_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
    ]) {
      current[key] += usage[key];
      totals[key] += usage[key];
    }
    current.estimated_cost_usd += priced.total_usd;
    totals.estimated_cost_usd += priced.total_usd;
    profiles[profile] = current;
    totals.calls += 1;
  }
  totals.estimated_cost_usd = Number(totals.estimated_cost_usd.toFixed(9));
  for (const profile of Object.values(profiles)) {
    profile.estimated_cost_usd = Number(profile.estimated_cost_usd.toFixed(9));
  }
  return {
    pricing_unit: "usd_per_million_tokens",
    pricing_snapshot: pricing,
    totals,
    profiles,
  };
}
