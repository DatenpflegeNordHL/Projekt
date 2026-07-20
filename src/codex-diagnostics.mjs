import {
  appendFileSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const MAX_FILE_BYTES = 65_536;
const MAX_COMMAND_BYTES = 2_000;
const MAX_OUTPUT_BYTES = 4_000;

function fail(message) {
  const error = new Error(message);
  error.code = "CODEXLOOPER_DIAGNOSTIC_PATH_INVALID";
  throw error;
}

function redact(value, secret, limit) {
  let text = String(value || "");
  if (secret) text = text.replaceAll(secret, "[REDACTED]");
  text = text.replace(/authorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "[REDACTED]");
  return text.slice(-limit);
}

function runDirectory(sourceEnv, projectRoot) {
  const configured = sourceEnv.CODEXLOOPER_RUN_DIR;
  if (typeof configured !== "string" || !isAbsolute(configured) || configured.includes("\0")) {
    fail("CODEXLOOPER_RUN_DIR must be absolute for diagnostics");
  }
  const root = resolve(projectRoot, ".codexlooper", "runs");
  const target = resolve(configured);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail("Diagnostic run directory must stay inside .codexlooper/runs");
  }
  if (!existsSync(target)) mkdirSync(target, { recursive: true, mode: 0o700 });
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("Diagnostic run directory must be a real directory");
  }
  chmodSync(target, 0o700);
  return target;
}

function sanitizeChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes.slice(0, 100).map((change) => ({
    path: typeof change?.path === "string" ? change.path : null,
    kind: change?.kind ?? null,
  }));
}

export function sanitizeCodexDiagnosticLine(line, secret) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }
  if (!event || typeof event !== "object") return null;
  if (event.type === "turn.failed" || event.type === "error") {
    return {
      type: event.type,
      message: redact(event.error?.message || event.message, secret, MAX_OUTPUT_BYTES),
    };
  }
  if (!String(event.type || "").startsWith("item.")) return null;
  const item = event.item;
  if (!item || typeof item !== "object") return null;
  const itemType = item.type;
  if (itemType === "agent_message" || itemType === "reasoning" || itemType === "todo_list") {
    return null;
  }
  const base = {
    type: event.type,
    item_type: itemType || null,
    status: item.status ?? null,
  };
  if (itemType === "command_execution" || itemType === "commandExecution") {
    return {
      ...base,
      command: redact(item.command, secret, MAX_COMMAND_BYTES),
      exit_code: item.exit_code ?? item.exitCode ?? null,
      output_tail: redact(
        item.aggregated_output ?? item.aggregatedOutput,
        secret,
        MAX_OUTPUT_BYTES,
      ),
    };
  }
  if (itemType === "file_change" || itemType === "fileChange") {
    return { ...base, changes: sanitizeChanges(item.changes) };
  }
  if (itemType === "mcp_tool_call" || itemType === "mcpToolCall") {
    return {
      ...base,
      server: item.server ?? null,
      tool: item.tool ?? item.name ?? null,
      error: redact(item.error?.message || item.error, secret, MAX_OUTPUT_BYTES),
    };
  }
  if (itemType === "error") {
    return { ...base, message: redact(item.message, secret, MAX_OUTPUT_BYTES) };
  }
  return base;
}

export function recordCodexDiagnosticLine(
  line,
  { sourceEnv = process.env, projectRoot = process.cwd(), now = () => new Date() } = {},
) {
  if (sourceEnv.CODEXLOOPER_CAPTURE_DIAGNOSTICS !== "1") return false;
  const sanitized = sanitizeCodexDiagnosticLine(line, sourceEnv.CLOSEROUTER_API_KEY);
  if (!sanitized) return false;
  const directory = runDirectory(sourceEnv, projectRoot);
  const path = resolve(directory, "builder-diagnostics.jsonl");
  if (existsSync(path) && statSync(path).size >= MAX_FILE_BYTES) return false;
  const event = {
    schema: "codexlooper.builder-diagnostic.v1",
    created_at: now().toISOString(),
    run_id: sourceEnv.CODEXLOOPER_RUN_ID || null,
    ...sanitized,
  };
  const payload = `${JSON.stringify(event)}\n`;
  if ((existsSync(path) ? statSync(path).size : 0) + Buffer.byteLength(payload) > MAX_FILE_BYTES) {
    return false;
  }
  appendFileSync(path, payload, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return true;
}
