import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

function fail(message) { const error = new Error(message); error.code = "CODEXLOOPER_CRG_CACHE_INTEGRITY"; throw error; }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function safe(path) { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) fail("CRG cache entry is unsafe"); }
function directory(projectRoot) {
  const path = resolve(projectRoot, ".codexlooper", "crg-cache");
  if (existsSync(path)) { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) fail("CRG cache directory is unsafe"); }
  return path;
}
function safeDirectory(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) fail("CRG cache data directory is unsafe");
  return path;
}

export function crgCacheKey({ projectRoot, identity, policyVersion = "crg-v1" } = {}) {
  if (!isAbsolute(projectRoot) || !identity?.config_sha256 || !identity?.profile_sha256 || !identity?.current_trusted_head) fail("CRG cache key inputs are invalid");
  return hash(JSON.stringify({ projectRoot, config: identity.config_sha256, environment: identity.environment_sha256, sandbox: identity.sandbox_sha256, profile: identity.profile_sha256, head: identity.current_trusted_head, policyVersion }));
}

export function readCrgBuildCache({ projectRoot, key } = {}) {
  const path = resolve(directory(projectRoot), `${key}.json`);
  if (!existsSync(path)) return null;
  safe(path);
  const raw = readFileSync(path, "utf8");
  let entry; try { entry = JSON.parse(raw); } catch { fail("CRG cache entry is malformed"); }
  if (!entry || entry.key !== key || entry.digest !== hash(JSON.stringify({ key: entry.key, version: entry.version }))) fail("CRG cache entry does not match");
  return Object.freeze(entry);
}

export function crgCacheDataDirectory({ projectRoot, key, create = false } = {}) {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) fail("CRG cache key is invalid");
  const path = resolve(directory(projectRoot), `${key}.data`);
  if (!existsSync(path)) {
    if (!create) return null;
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
  }
  return safeDirectory(path);
}

export function writeCrgBuildCache({ projectRoot, key, version } = {}) {
  const cacheDirectory = directory(projectRoot);
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 }); chmodSync(cacheDirectory, 0o700);
  const entry = { key, version, digest: hash(JSON.stringify({ key, version })) };
  const path = resolve(cacheDirectory, `${key}.json`); const temporary = `${path}.tmp-${process.pid}`;
  try { writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600, flag: "wx" }); chmodSync(temporary, 0o600); renameSync(temporary, path); } finally { rmSync(temporary, { force: true }); }
  return Object.freeze(entry);
}
