import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { install } from "../scripts/install.mjs";

const REQUIRED_ARGUMENTS = ["--project", "--real-codex", "--mex-command", "--ralphex-command"];
const OPTIONAL_ARGUMENTS = new Set([
  "--project-name",
  "--builder-model",
  "--review-model",
  "--builder-reasoning",
  "--review-reasoning",
]);
const ALLOWED_ARGUMENTS = new Set([...REQUIRED_ARGUMENTS, ...OPTIONAL_ARGUMENTS]);
const MAX_TOOL_OUTPUT = 12_000;
const TOOL_TIMEOUT_MS = 180_000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!ALLOWED_ARGUMENTS.has(key)) fail("CODEXLOOPER_BOOTSTRAP_ARGUMENT", `Unknown argument: ${key}`);
    if (values[key] !== undefined) fail("CODEXLOOPER_BOOTSTRAP_ARGUMENT", `Duplicate argument: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail("CODEXLOOPER_BOOTSTRAP_ARGUMENT", `Missing value for argument: ${key}`);
    }
    values[key] = value;
    index += 1;
  }
  for (const key of REQUIRED_ARGUMENTS) {
    if (!values[key]) fail("CODEXLOOPER_BOOTSTRAP_ARGUMENT", `Missing required argument: ${key}`);
  }
  return values;
}

function executable(path, label) {
  if (!isAbsolute(path) || path.includes("\0")) {
    fail("CODEXLOOPER_BOOTSTRAP_EXECUTABLE", `${label} must be an absolute path`);
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    fail("CODEXLOOPER_BOOTSTRAP_EXECUTABLE", `${label} is not executable: ${path}`);
  }
}

function safeEnvironment(sourceEnv = process.env) {
  const allowed = [
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
    "NO_COLOR",
    "CI",
    "TZ",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ];
  const env = {};
  for (const key of allowed) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }
  env.CI = env.CI || "1";
  env.NO_COLOR = "1";
  env.DO_NOT_TRACK = "1";
  return env;
}

function run(command, args, { cwd, label, sourceEnv = process.env, timeout = TOOL_TIMEOUT_MS } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: safeEnvironment(sourceEnv),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error")
      .trim()
      .slice(-MAX_TOOL_OUTPUT);
    fail(
      "CODEXLOOPER_BOOTSTRAP_COMMAND",
      `${label || command} failed${result.status !== null ? ` with status ${result.status}` : ""}${detail ? `: ${detail}` : ""}`,
    );
  }
  return String(result.stdout || "").trim();
}

function requireCleanExactGitRoot(project, sourceEnv) {
  const root = run("/usr/bin/git", ["rev-parse", "--show-toplevel"], {
    cwd: project,
    label: "Git root check",
    sourceEnv,
  });
  if (realpathSync(root) !== realpathSync(project)) {
    fail("CODEXLOOPER_BOOTSTRAP_GIT_ROOT", "Project must be the exact Git root");
  }
  const status = run("/usr/bin/git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
    cwd: project,
    label: "Git cleanliness check",
    sourceEnv,
  });
  if (status) fail("CODEXLOOPER_BOOTSTRAP_DIRTY", "Project worktree must be clean before bootstrap");
}

function validateProjectName(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 80 ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    fail("CODEXLOOPER_BOOTSTRAP_NAME", "Project name is invalid");
  }
  return value.trim();
}

function assertSafeParents(root, path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail("CODEXLOOPER_BOOTSTRAP_PATH", `Bootstrap path escapes project: ${path}`);
  }
  let current = root;
  for (const segment of rel.split(/[\\/]/).slice(0, -1)) {
    current = resolve(current, segment);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("CODEXLOOPER_BOOTSTRAP_PATH", `Bootstrap parent is unsafe: ${current}`);
    }
  }
}

function writeAtomic(path, content, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode });
    chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function ensureTemplate(root, relativePath, content) {
  const path = resolve(root, relativePath);
  assertSafeParents(root, path);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("CODEXLOOPER_BOOTSTRAP_PATH", `Existing bootstrap target is unsafe: ${relativePath}`);
    }
    return { path: relativePath, status: "preserved" };
  }
  writeAtomic(path, content);
  return { path: relativePath, status: "created" };
}

function templates(projectName) {
  return new Map([
    [
      "AGENTS.md",
      `# Agent Instructions\n\nWork only from the active plan under \`docs/plans/\`. Read \`ROUTER.md\` before loading additional context. Do not push, merge, deploy, publish, spend money, or perform external actions without explicit authorization.\n`,
    ],
    [
      "ROUTER.md",
      `# Context Router\n\nAlways load \`AGENTS.md\`, this router, and the active plan. Load \`PROJECT_SPEC.md\` and \`context/project-state.md\` for project-level decisions. Load individual files from \`patterns/\` only when the active task requires them.\n`,
    ],
    [
      "PROJECT_SPEC.md",
      `# ${projectName}\n\n## Purpose\n\nDescribe the product, users, constraints, and non-goals here. Keep this file factual and update it when the project contract changes.\n`,
    ],
    [
      "context/project-state.md",
      `# Project State\n\n## Working\n\n- Initial CodexLooper and MEX scaffold created.\n\n## Next\n\n- Add a bounded plan under \`docs/plans/\`.\n\n## Known Issues\n\n- None recorded yet.\n`,
    ],
    ["patterns/INDEX.md", "# Pattern Index\n\nNo reusable task patterns recorded yet.\n"],
    [
      "docs/plans/README.md",
      `# Plan Contract\n\nEvery executable plan must contain:\n\n- a clear goal;\n- \`## Allowed paths\` with code-formatted path bullets;\n- \`## Validation Commands\` with code-formatted command bullets;\n- actionable checkbox tasks.\n\nCodexLooper blocks changes outside the declared paths.\n`,
    ],
  ]);
}

function changedPaths(project, sourceEnv) {
  const output = run("/usr/bin/git", ["status", "--porcelain=v1", "-z", "--untracked-files=normal"], {
    cwd: project,
    label: "Git bootstrap path inspection",
    sourceEnv,
  });
  if (!output) return [];
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3).replaceAll("\\", "/"))
    .sort();
}

function allowedBootstrapPath(path) {
  return (
    ["AGENTS.md", "ROUTER.md", "PROJECT_SPEC.md", "docs/plans/README.md"].includes(path) ||
    path.startsWith("context/") ||
    path.startsWith("patterns/") ||
    path.startsWith(".mex/")
  );
}

function parseMexCheck(raw) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    fail("CODEXLOOPER_BOOTSTRAP_MEX", "MEX check returned invalid JSON");
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    fail("CODEXLOOPER_BOOTSTRAP_MEX", "MEX check returned an invalid report");
  }
  return report;
}

function writeReceipt(project, receipt) {
  const path = resolve(project, ".codexlooper", "bootstrap.json");
  writeAtomic(path, `${JSON.stringify(receipt, null, 2)}\n`, 0o600);
  return path;
}

export function bootstrap(argv = process.argv.slice(2), { sourceEnv = process.env, now = () => new Date() } = {}) {
  const args = parseArgs(argv);
  const project = realpathSync(resolve(args["--project"]));
  const projectName = validateProjectName(args["--project-name"] || basename(project));
  const realCodex = args["--real-codex"];
  const mexCommand = args["--mex-command"];
  const ralphexCommand = args["--ralphex-command"];

  for (const [command, label] of [
    [realCodex, "Codex command"],
    [mexCommand, "MEX command"],
    [ralphexCommand, "Ralphex command"],
  ]) {
    executable(command, label);
  }
  requireCleanExactGitRoot(project, sourceEnv);

  const files = [...templates(projectName)].map(([path, content]) => ensureTemplate(project, path, content));
  run(mexCommand, ["setup"], { cwd: project, label: "MEX setup", sourceEnv });
  const mexReport = parseMexCheck(
    run(mexCommand, ["check", "--json"], { cwd: project, label: "MEX check", sourceEnv }),
  );

  const changed = changedPaths(project, sourceEnv);
  const rejected = changed.filter((path) => !allowedBootstrapPath(path));
  if (rejected.length > 0) {
    fail(
      "CODEXLOOPER_BOOTSTRAP_PATH",
      `Bootstrap changed paths outside the approved scaffold: ${rejected.join(", ")}`,
    );
  }

  const installArgs = [
    "--project",
    project,
    "--real-codex",
    realCodex,
    "--mex-command",
    mexCommand,
    "--ralphex-command",
    ralphexCommand,
  ];
  for (const key of OPTIONAL_ARGUMENTS) {
    if (key !== "--project-name" && args[key] !== undefined) installArgs.push(key, args[key]);
  }
  const installed = install(installArgs);
  const receipt = {
    schema: "codexlooper.bootstrap.v1",
    status: "completed",
    created_at: now().toISOString(),
    project,
    project_name: projectName,
    files,
    visible_changes: changed,
    mex_score: Number.isFinite(Number(mexReport.score)) ? Number(mexReport.score) : null,
    run_command: installed.runCommand,
    secret_free: true,
  };
  const receiptPath = writeReceipt(project, receipt);
  return { receipt, receiptPath, ...installed };
}
