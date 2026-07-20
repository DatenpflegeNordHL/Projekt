import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ensurePrivateDirectoryChain } from "./runtime-paths.mjs";

const MAX_PATCH_BYTES = 2_000_000;
const MAX_COMMAND_OUTPUT = 8_000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function safeEnvironment(sourceEnv = process.env) {
  const env = {};
  for (const key of ["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP"]) {
    if (sourceEnv[key] !== undefined) env[key] = sourceEnv[key];
  }
  return env;
}

function run(command, args, { cwd, env, label, encoding = "utf8", maxBuffer = 20 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env || safeEnvironment(),
    encoding,
    maxBuffer,
  });
  if (result.error || result.status !== 0) {
    const raw = result.stderr || result.stdout || result.error?.message || "unknown error";
    const detail = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
    fail(
      "CODEXLOOPER_SNAPSHOT_COMMAND_FAILED",
      `${label || command} failed${detail.trim() ? `: ${detail.trim().slice(-MAX_COMMAND_OUTPUT)}` : ""}`,
    );
  }
  return result.stdout;
}

function validateRunDirectory(sourceEnv, projectRoot) {
  const configured = sourceEnv.CODEXLOOPER_RUN_DIR;
  if (typeof configured !== "string" || !isAbsolute(configured) || configured.includes("\0")) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "CODEXLOOPER_RUN_DIR must be an absolute path");
  }
  const root = realpathSync(projectRoot);
  const expected = resolve(root, ".codexlooper", "runs", basename(configured));
  if (configured !== expected) {
    fail("CODEXLOOPER_RUN_DIR_INVALID", "Snapshot run directory must stay inside .codexlooper/runs");
  }
  return { root, runDirectory: configured, runId: basename(configured) };
}

function sanitizedProviderConfig(sourceEnv) {
  const sourceHome = sourceEnv.CODEX_HOME;
  if (typeof sourceHome !== "string" || !isAbsolute(sourceHome) || sourceHome.includes("\0")) {
    fail("CODEXLOOPER_CODEX_HOME_INVALID", "CODEX_HOME must be an absolute path");
  }
  const sourceConfig = resolve(sourceHome, "config.toml");
  const stat = lstatSync(sourceConfig);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 1_000_000) {
    fail("CODEXLOOPER_CODEX_HOME_INVALID", "Codex provider config must be a bounded regular file");
  }
  const raw = readFileSync(sourceConfig, "utf8");
  if (!raw.includes('base_url = "https://api.closerouter.dev/v1"') || !raw.includes('wire_api = "responses"')) {
    fail("CODEXLOOPER_CODEX_HOME_INVALID", "Codex provider config is not the controlled CloseRouter config");
  }
  return `${raw.replace(/\n\[sandbox_workspace_write\][\s\S]*$/u, "").trim()}\n`;
}

function writePrivate(path, content) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function validateSnapshotPath(snapshotRoot, sourceEnv, projectRoot) {
  const { root, runDirectory } = validateRunDirectory(sourceEnv, projectRoot);
  const snapshotsRoot = resolve(runDirectory, "snapshots");
  const target = realpathSync(snapshotRoot);
  const rel = relative(snapshotsRoot, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail("CODEXLOOPER_SNAPSHOT_INVALID", "Builder snapshot must stay inside the current run directory");
  }
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("CODEXLOOPER_SNAPSHOT_INVALID", "Builder snapshot must be a regular directory");
  }
  return { root, target };
}

export function createBuilderSnapshot({
  sourceEnv = process.env,
  projectRoot = process.cwd(),
  randomBytesImpl = randomBytes,
} = {}) {
  const { root, runDirectory, runId } = validateRunDirectory(sourceEnv, projectRoot);
  const snapshotsRoot = ensurePrivateDirectoryChain(root, [".codexlooper", "runs", runId, "snapshots"]);
  const id = `${Date.now()}-${process.pid}-${randomBytesImpl(6).toString("hex")}`;
  const snapshotRoot = resolve(snapshotsRoot, id);
  if (existsSync(snapshotRoot)) fail("CODEXLOOPER_SNAPSHOT_COLLISION", "Builder snapshot already exists");

  run(
    "/usr/bin/git",
    ["-c", "core.symlinks=false", "clone", "--local", "--no-hardlinks", "--no-tags", "--no-checkout", root, snapshotRoot],
    { cwd: root, env: safeEnvironment(sourceEnv), label: "Builder snapshot clone" },
  );
  run("/usr/bin/git", ["config", "core.symlinks", "false"], {
    cwd: snapshotRoot,
    env: safeEnvironment(sourceEnv),
    label: "Builder snapshot symlink policy",
  });
  const baselineHead = String(
    run("/usr/bin/git", ["rev-parse", "HEAD"], {
      cwd: root,
      env: safeEnvironment(sourceEnv),
      label: "Builder source head",
    }),
  ).trim();
  const branch = String(
    run("/usr/bin/git", ["branch", "--show-current"], {
      cwd: root,
      env: safeEnvironment(sourceEnv),
      label: "Builder source branch",
    }),
  ).trim();
  const checkoutArgs = branch
    ? ["checkout", "--force", "-B", branch, baselineHead]
    : ["checkout", "--force", "--detach", baselineHead];
  run("/usr/bin/git", checkoutArgs, {
    cwd: snapshotRoot,
    env: safeEnvironment(sourceEnv),
    label: "Builder snapshot checkout",
  });

  const excludePath = resolve(snapshotRoot, ".git", "info", "exclude");
  writePrivate(excludePath, ".codexlooper/\n.ralphex/\n.codexlooper-context/\n");
  const snapshotCodexHome = resolve(snapshotRoot, ".codexlooper", "codex-home");
  writePrivate(resolve(snapshotCodexHome, "config.toml"), sanitizedProviderConfig(sourceEnv));
  const contextRoot = resolve(snapshotRoot, ".codexlooper-context");
  mkdirSync(contextRoot, { recursive: true, mode: 0o700 });
  const commits = String(
    run("/usr/bin/git", ["log", "--oneline", "--decorate", "-20"], {
      cwd: snapshotRoot,
      env: safeEnvironment(sourceEnv),
      label: "Builder snapshot history",
    }),
  );
  writePrivate(
    resolve(contextRoot, "README.md"),
    "This is a disposable CodexLooper snapshot. Inspect and edit only this snapshot. The trusted host applies the returned patch to the real repository after policy checks.\n",
  );
  writePrivate(resolve(contextRoot, "recent-commits.txt"), commits);

  return {
    root: snapshotRoot,
    baselineHead,
    sourceRoot: root,
    env: {
      ...sourceEnv,
      CODEX_HOME: snapshotCodexHome,
      CODEXLOOPER_ISOLATED_SNAPSHOT: snapshotRoot,
    },
  };
}

export function captureBuilderSnapshotPatch({ snapshot, sourceEnv = process.env, projectRoot = process.cwd() } = {}) {
  if (!snapshot || typeof snapshot.root !== "string" || typeof snapshot.baselineHead !== "string") {
    fail("CODEXLOOPER_SNAPSHOT_INVALID", "Builder snapshot descriptor is invalid");
  }
  const { target } = validateSnapshotPath(snapshot.root, sourceEnv, projectRoot);
  run("/usr/bin/git", ["add", "-N", "--all"], {
    cwd: target,
    env: safeEnvironment(sourceEnv),
    label: "Builder snapshot intent-to-add",
  });
  const patch = String(
    run(
      "/usr/bin/git",
      ["diff", "--no-ext-diff", "--binary", "--full-index", snapshot.baselineHead, "--"],
      {
        cwd: target,
        env: safeEnvironment(sourceEnv),
        label: "Builder snapshot diff",
        maxBuffer: MAX_PATCH_BYTES + 1024,
      },
    ),
  );
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    fail("CODEXLOOPER_PATCH_INVALID", "Builder snapshot patch exceeds the bounded size");
  }
  return patch;
}

export function cleanupBuilderSnapshot({ snapshot, sourceEnv = process.env, projectRoot = process.cwd() } = {}) {
  if (!snapshot?.root || !existsSync(snapshot.root)) return;
  const { target } = validateSnapshotPath(snapshot.root, sourceEnv, projectRoot);
  rmSync(target, { recursive: true, force: true });
}
