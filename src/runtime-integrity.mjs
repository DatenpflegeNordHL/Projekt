import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const RUNTIME_FILES = Object.freeze([
  "bin/codex-closerouter.mjs",
  "bin/terra-as-claude.mjs",
  "bin/sol-review.mjs",
  "scripts/preflight.mjs",
  "scripts/run.mjs",
  "src/launcher.mjs",
  "src/profiles.mjs",
  "src/claude-stream.mjs",
  "src/runtime-paths.mjs",
  "src/run-policy.mjs",
  "src/builder-envelope.mjs",
  "src/builder-snapshot.mjs",
  "src/git-supervisor.mjs",
  "src/codex-diagnostics.mjs",
  "src/telemetry.mjs",
  "src/runtime-integrity.mjs",
  "src/run.mjs",
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    isAbsolute(value) ||
    value.split(/[\\/]/).includes("..")
  ) {
    fail("CODEXLOOPER_RUNTIME_PATH_INVALID", `${label} is unsafe: ${value}`);
  }
  return value.split(sep).join("/");
}

function safeGitEnv(sourceEnv = process.env) {
  return Object.fromEntries(
    ["HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE"].flatMap((key) =>
      sourceEnv[key] === undefined ? [] : [[key, sourceEnv[key]]],
    ),
  );
}

function git(root, args, label, sourceEnv = process.env) {
  const result = spawnSync("/usr/bin/git", args, {
    cwd: root,
    encoding: "utf8",
    env: safeGitEnv(sourceEnv),
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
    fail("CODEXLOOPER_RUNTIME_SOURCE_INVALID", `${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout || "").trim();
}

function assertRegularNonSymlink(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("CODEXLOOPER_RUNTIME_PATH_INVALID", `${label} must be a regular non-symlink file: ${path}`);
  }
  if (realpathSync(path) !== path) {
    fail("CODEXLOOPER_RUNTIME_PATH_INVALID", `${label} must use its canonical path: ${path}`);
  }
  return stat;
}

export function canonicalExecutable(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    fail("CODEXLOOPER_RUNTIME_EXECUTABLE_INVALID", `${label} must be an absolute executable path`);
  }
  let canonical;
  try {
    canonical = realpathSync(path);
    accessSync(canonical, constants.X_OK);
  } catch {
    fail("CODEXLOOPER_RUNTIME_EXECUTABLE_INVALID", `${label} is not executable: ${path}`);
  }
  const stat = assertRegularNonSymlink(canonical, label);
  return {
    path: canonical,
    sha256: sha256(readFileSync(canonical)),
    mode: stat.mode & 0o777,
  };
}

function sourceFileRecord(sourceRoot, relativePath) {
  const safe = safeRelativePath(relativePath, "Runtime source path");
  const path = resolve(sourceRoot, safe);
  const rel = relative(sourceRoot, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    fail("CODEXLOOPER_RUNTIME_PATH_INVALID", `Runtime source escapes checkout: ${safe}`);
  }
  const stat = assertRegularNonSymlink(path, `Runtime source ${safe}`);
  return {
    path: safe,
    source_mode: stat.mode & 0o777,
    runtime_mode: 0o400,
    sha256: sha256(readFileSync(path)),
  };
}

function chmodDirectoriesReadOnly(root) {
  const directories = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isSymbolicLink()) {
        fail("CODEXLOOPER_RUNTIME_PATH_INVALID", `Runtime contains a symlink: ${child}`);
      }
      if (entry.isDirectory()) {
        visit(child);
        directories.push(child);
      }
    }
  };
  visit(root);
  for (const path of directories.reverse()) chmodSync(path, 0o500);
  chmodSync(root, 0o500);
}

function runtimeSeed({ sourceCommit, node, externalTools, budgets, files }) {
  return {
    schema: "codexlooper.runtime-seed.v1",
    source_commit: sourceCommit,
    node,
    external_tools: externalTools,
    budgets,
    files,
  };
}

function parseManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail("CODEXLOOPER_RUNTIME_MANIFEST_INVALID", "Runtime manifest is invalid JSON");
  }
  if (manifest?.schema !== "codexlooper.runtime.v1" || !Array.isArray(manifest.files)) {
    fail("CODEXLOOPER_RUNTIME_MANIFEST_INVALID", "Runtime manifest schema is invalid");
  }
  return manifest;
}

function assertPrivateReadOnlyDirectory(path, label) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", `${label} must be a real directory`);
  }
  if ((stat.mode & 0o277) !== 0) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", `${label} has unsafe write or public permissions`);
  }
}

export function verifyRuntimeManifest({
  manifestPath,
  expectedManifestSha256,
  expectedRuntimeDirectory,
  expectedNodeExecutable = process.execPath,
} = {}) {
  if (typeof manifestPath !== "string" || !isAbsolute(manifestPath) || manifestPath.includes("\0")) {
    fail("CODEXLOOPER_RUNTIME_MANIFEST_INVALID", "Runtime manifest path must be absolute");
  }
  const canonicalManifest = realpathSync(manifestPath);
  if (canonicalManifest !== manifestPath) {
    fail("CODEXLOOPER_RUNTIME_MANIFEST_INVALID", "Runtime manifest path must be canonical and non-symlinked");
  }
  const manifestStat = assertRegularNonSymlink(canonicalManifest, "Runtime manifest");
  if ((manifestStat.mode & 0o777) !== 0o400) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Runtime manifest mode must be 0400");
  }
  const manifestBytes = readFileSync(canonicalManifest);
  const manifestSha256 = sha256(manifestBytes);
  if (expectedManifestSha256 && manifestSha256 !== expectedManifestSha256) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Runtime manifest SHA-256 mismatch");
  }
  const manifest = parseManifest(canonicalManifest);
  const runtimeDirectory = realpathSync(dirname(canonicalManifest));
  if (expectedRuntimeDirectory && runtimeDirectory !== realpathSync(expectedRuntimeDirectory)) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Runtime directory does not match installed state");
  }
  if (manifest.runtime_directory !== runtimeDirectory) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Runtime manifest records a different runtime directory");
  }
  assertPrivateReadOnlyDirectory(runtimeDirectory, "Runtime directory");

  const currentNode = canonicalExecutable(expectedNodeExecutable, "Node.js executable");
  if (manifest.node?.path !== currentNode.path) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Runtime Node.js executable changed");
  }
  if (manifest.node?.major !== Number(process.versions.node.split(".")[0])) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Runtime Node.js major version changed");
  }
  if (manifest.node?.sha256 !== currentNode.sha256) {
    fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Runtime Node.js executable hash changed");
  }

  for (const record of manifest.files) {
    const safe = safeRelativePath(record.path, "Runtime manifest file path");
    const filePath = resolve(runtimeDirectory, safe);
    const rel = relative(runtimeDirectory, filePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", `Runtime file escapes runtime: ${safe}`);
    }
    const stat = assertRegularNonSymlink(filePath, `Runtime file ${safe}`);
    if ((stat.mode & 0o777) !== record.runtime_mode || record.runtime_mode !== 0o400) {
      fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", `Runtime file mode changed: ${safe}`);
    }
    if (sha256(readFileSync(filePath)) !== record.sha256) {
      fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", `Runtime file hash changed: ${safe}`);
    }
    let parent = dirname(filePath);
    while (parent !== runtimeDirectory) {
      assertPrivateReadOnlyDirectory(parent, `Runtime parent ${relative(runtimeDirectory, parent)}`);
      parent = dirname(parent);
    }
  }

  for (const [name, tool] of Object.entries(manifest.external_tools || {})) {
    const current = canonicalExecutable(tool.path, `${name} executable`);
    if (current.sha256 !== tool.sha256) {
      fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", `${name} executable hash changed`);
    }
  }

  return { manifest, manifestPath: canonicalManifest, manifestSha256, runtimeDirectory };
}

export function installImmutableRuntime({
  sourceRoot,
  projectRoot,
  nodeExecutable = process.execPath,
  externalTools,
  budgets,
  sourceEnv = process.env,
} = {}) {
  const source = realpathSync(sourceRoot);
  const project = realpathSync(projectRoot);
  const trackedStatus = git(source, ["status", "--porcelain=v1", "--untracked-files=no"], "Runtime source status", sourceEnv);
  if (trackedStatus) {
    fail("CODEXLOOPER_RUNTIME_SOURCE_DIRTY", "Tracked CodexLooper runtime source files must be clean before install");
  }
  const sourceCommit = git(source, ["rev-parse", "HEAD"], "Runtime source commit", sourceEnv);
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    fail("CODEXLOOPER_RUNTIME_SOURCE_INVALID", "Runtime source commit is not a full Git SHA");
  }

  const node = {
    ...canonicalExecutable(nodeExecutable, "Node.js executable"),
    version: process.version,
    major: Number(process.versions.node.split(".")[0]),
  };
  const tools = Object.fromEntries(
    Object.entries(externalTools || {}).map(([name, value]) => [
      name,
      { ...canonicalExecutable(value.path, `${name} executable`), version: value.version },
    ]),
  );
  const files = RUNTIME_FILES.map((path) => sourceFileRecord(source, path));
  const seed = runtimeSeed({ sourceCommit, node, externalTools: tools, budgets, files });
  const runtimeId = sha256(JSON.stringify(seed));
  const runtimeRoot = resolve(project, ".codexlooper", "runtime");
  const runtimeDirectory = resolve(runtimeRoot, runtimeId);
  const manifestPath = resolve(runtimeDirectory, "manifest.json");
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  chmodSync(runtimeRoot, 0o700);

  if (existsSync(runtimeDirectory)) {
    const verified = verifyRuntimeManifest({
      manifestPath,
      expectedRuntimeDirectory: runtimeDirectory,
      expectedNodeExecutable: node.path,
    });
    if (verified.manifest.runtime_id !== runtimeId) {
      fail("CODEXLOOPER_RUNTIME_INTEGRITY_FAILED", "Existing runtime ID does not match its content seed");
    }
    return { ...verified, runtimeId, sourceCommit };
  }

  const temporary = resolve(runtimeRoot, `.tmp-${runtimeId}-${process.pid}`);
  rmSync(temporary, { recursive: true, force: true });
  mkdirSync(temporary, { recursive: false, mode: 0o700 });
  try {
    for (const record of files) {
      const sourcePath = resolve(source, record.path);
      const targetPath = resolve(temporary, record.path);
      mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
      writeFileSync(targetPath, readFileSync(sourcePath), { mode: record.runtime_mode, flag: "wx" });
      chmodSync(targetPath, record.runtime_mode);
    }
    const manifest = {
      schema: "codexlooper.runtime.v1",
      runtime_id: runtimeId,
      runtime_directory: runtimeDirectory,
      source_commit: sourceCommit,
      node,
      external_tools: tools,
      budgets,
      files,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(resolve(temporary, "manifest.json"), manifestBytes, { mode: 0o400, flag: "wx" });
    chmodSync(resolve(temporary, "manifest.json"), 0o400);
    chmodDirectoriesReadOnly(temporary);
    renameSync(temporary, runtimeDirectory);
    const manifestSha256 = sha256(manifestBytes);
    return { manifest, manifestPath, manifestSha256, runtimeDirectory, runtimeId, sourceCommit };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
