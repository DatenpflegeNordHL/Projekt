import { isAbsolute, posix } from "node:path";

const MAX_RULES = 64;
const MAX_COMMANDS = 12;
const MAX_COMMAND_LENGTH = 1000;
const VALIDATION_PATH = /^[A-Za-z0-9._@+\/-]+$/;
const TEST_OPERATORS = new Set(["-d", "-e", "-f", "-s"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sectionLines(content, heading) {
  const lines = content.split(/\r?\n/);
  const expected = heading.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === expected);
  if (start < 0) return [];
  const result = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line.trim())) break;
    result.push(line);
  }
  return result;
}

function bulletCodeValues(lines) {
  const values = [];
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+`([^`]+)`\s*(?:#.*)?$/);
    if (match) values.push(match[1].trim());
  }
  return values;
}

function normalizeRepositoryPath(value, planRelative) {
  let candidate = value.trim();
  if (/^this plan file$/i.test(candidate)) candidate = planRelative;
  candidate = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !candidate ||
    candidate.includes("\0") ||
    candidate.includes("\n") ||
    isAbsolute(candidate) ||
    candidate.startsWith("/")
  ) {
    fail("CODEXLOOPER_POLICY_PATH_INVALID", `Invalid allowed path: ${value}`);
  }
  const withoutPattern = candidate.endsWith("/**") ? candidate.slice(0, -3) : candidate;
  const normalized = posix.normalize(withoutPattern);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..") ||
    normalized.startsWith(".git/") ||
    normalized === ".git" ||
    normalized.startsWith(".codexlooper/") ||
    normalized === ".codexlooper" ||
    normalized.startsWith(".ralphex/") ||
    normalized === ".ralphex"
  ) {
    fail("CODEXLOOPER_POLICY_PATH_INVALID", `Unsafe allowed path: ${value}`);
  }
  if (candidate.endsWith("/**") || candidate.endsWith("/")) {
    return { type: "prefix", value: `${normalized.replace(/\/$/, "")}/` };
  }
  if (candidate.includes("*") || candidate.includes("?") || candidate.includes("[")) {
    fail("CODEXLOOPER_POLICY_PATH_INVALID", `Unsupported allowed-path pattern: ${value}`);
  }
  return { type: "exact", value: normalized };
}

function uniqueRules(rules) {
  const seen = new Set();
  return rules.filter((rule) => {
    const key = `${rule.type}:${rule.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validationPath(value, rules, label) {
  if (
    typeof value !== "string" ||
    !VALIDATION_PATH.test(value) ||
    value.startsWith("/") ||
    value.startsWith("-") ||
    value.split("/").includes("..")
  ) {
    fail("CODEXLOOPER_POLICY_COMMAND_REJECTED", `${label} uses an unsafe repository path`);
  }
  const normalized = posix.normalize(value.replace(/^\.\//, ""));
  if (!pathAllowed(normalized, rules)) {
    fail(
      "CODEXLOOPER_POLICY_COMMAND_REJECTED",
      `${label} may inspect only paths declared by the plan: ${normalized}`,
    );
  }
  return normalized;
}

function commandTokens(command) {
  if (
    typeof command !== "string" ||
    !command ||
    command.length > MAX_COMMAND_LENGTH ||
    command.includes("\0") ||
    command.includes("\n") ||
    command.includes("\r")
  ) {
    fail("CODEXLOOPER_POLICY_COMMAND_INVALID", "Validation command is invalid or too long");
  }
  if (/[;&|<>`$(){}\[\]"'\\]/.test(command)) {
    fail(
      "CODEXLOOPER_POLICY_COMMAND_REJECTED",
      `Validation command contains shell syntax or quoting: ${command}`,
    );
  }
  const tokens = command.trim().split(/\s+/);
  if (tokens.some((token) => !token)) {
    fail("CODEXLOOPER_POLICY_COMMAND_REJECTED", `Validation command is malformed: ${command}`);
  }
  return tokens;
}

export function validationInvocation(command, rules) {
  const tokens = commandTokens(command);

  if (tokens.length === 3 && tokens[0] === "git" && tokens[1] === "diff" && tokens[2] === "--check") {
    return { executable: "/usr/bin/git", args: ["diff", "--check"], display: command };
  }

  if (tokens.length === 3 && tokens[0] === "node" && tokens[1] === "--check") {
    const path = validationPath(tokens[2], rules, "node --check");
    if (!/\.(?:cjs|js|mjs)$/.test(path)) {
      fail("CODEXLOOPER_POLICY_COMMAND_REJECTED", "node --check accepts only JavaScript source files");
    }
    return { executable: process.execPath, args: ["--check", path], display: command };
  }

  if (tokens[0] === "test") {
    if (tokens.length === 3 && TEST_OPERATORS.has(tokens[1])) {
      const path = validationPath(tokens[2], rules, "test");
      return { executable: "/usr/bin/test", args: [tokens[1], path], display: command };
    }
    if (tokens.length === 4 && tokens[1] === "!" && tokens[2] === "-e") {
      const path = validationPath(tokens[3], rules, "test ! -e");
      return { executable: "/usr/bin/test", args: ["!", "-e", path], display: command };
    }
  }

  fail(
    "CODEXLOOPER_POLICY_COMMAND_REJECTED",
    `Validation command is not allowlisted: ${command}`,
  );
}

export function parseRunPolicy(planRelative, content) {
  if (typeof planRelative !== "string" || !planRelative || typeof content !== "string") {
    fail("CODEXLOOPER_POLICY_INVALID", "Plan path and content are required");
  }
  const rawPaths = bulletCodeValues(sectionLines(content, "## Allowed paths"));
  if (rawPaths.length === 0) {
    fail("CODEXLOOPER_POLICY_MISSING", "Plan must define `## Allowed paths` with code-formatted bullets");
  }
  if (rawPaths.length > MAX_RULES) {
    fail("CODEXLOOPER_POLICY_INVALID", `Plan exceeds ${MAX_RULES} allowed-path rules`);
  }
  const allowedPaths = uniqueRules([
    ...rawPaths.map((value) => normalizeRepositoryPath(value, planRelative)),
    normalizeRepositoryPath(planRelative, planRelative),
  ]);

  const commands = bulletCodeValues(sectionLines(content, "## Validation Commands"));
  if (commands.length === 0) {
    fail("CODEXLOOPER_POLICY_MISSING", "Plan must define at least one validation command");
  }
  if (commands.length > MAX_COMMANDS) {
    fail("CODEXLOOPER_POLICY_INVALID", `Plan exceeds ${MAX_COMMANDS} validation commands`);
  }
  for (const command of commands) validationInvocation(command, allowedPaths);

  return {
    schema: "codexlooper.run-policy.v1",
    plan: planRelative,
    allowed_paths: allowedPaths,
    validation_commands: commands,
  };
}

export function pathAllowed(path, rules) {
  if (typeof path !== "string" || !path || !Array.isArray(rules)) return false;
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("../") ||
    normalized.split("/").includes("..") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === ".codexlooper" ||
    normalized.startsWith(".codexlooper/") ||
    normalized === ".ralphex" ||
    normalized.startsWith(".ralphex/")
  ) {
    return false;
  }
  return rules.some((rule) => {
    if (rule?.type === "exact") return normalized === rule.value;
    if (rule?.type === "prefix") return normalized.startsWith(rule.value);
    return false;
  });
}
