import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createCrgMacosSandboxLaunch, captureCrgEnvironmentIdentity, verifyCrgEnvironmentIdentity } from "./code-review-graph.mjs";
import { canonicalExecutable } from "./runtime-integrity.mjs";

export const CRG_RUNTIME_CONFIG_SCHEMA = "codexlooper.crg-runtime-config.v1";
const SHA256 = /^[a-f0-9]{64}$/u;

function fail(message) {
  const error = new Error(message);
  error.code = "CODEXLOOPER_CRG_RUNTIME_CONFIG_INVALID";
  throw error;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPrivateConfig(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) fail("CRG config path is invalid");
  const canonical = realpathSync(path);
  if (canonical !== path) fail("CRG config path must be canonical");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    fail("CRG config must be a private regular non-symlink file");
  }
  return canonical;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("CRG config must be an object");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("CRG config has unknown or missing fields");
  }
}

export function createCrgRuntimeConfig({ environmentRoot, interpreterPath, commandPath, sandboxCommand } = {}) {
  const environment = captureCrgEnvironmentIdentity({ environmentRoot, interpreterPath, commandPath });
  const sandbox = canonicalExecutable(sandboxCommand, "CRG sandbox executable");
  return Object.freeze({
    schema: CRG_RUNTIME_CONFIG_SCHEMA,
    environment,
    sandbox,
  });
}

export function serializeCrgRuntimeConfig(config) {
  exactKeys(config, ["schema", "environment", "sandbox"]);
  if (config.schema !== CRG_RUNTIME_CONFIG_SCHEMA) fail("CRG config schema is invalid");
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function readCrgRuntimeConfig({ configPath, expectedSha256 } = {}) {
  if (typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256)) fail("CRG config digest is invalid");
  const path = canonicalPrivateConfig(configPath);
  const bytes = readFileSync(path);
  if (digest(bytes) !== expectedSha256) fail("CRG config digest does not match");
  let config;
  try {
    config = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("CRG config is not valid JSON");
  }
  exactKeys(config, ["schema", "environment", "sandbox"]);
  if (config.schema !== CRG_RUNTIME_CONFIG_SCHEMA) fail("CRG config schema is invalid");
  if (!config.sandbox || typeof config.sandbox !== "object") fail("CRG sandbox identity is invalid");
  const sandbox = canonicalExecutable(config.sandbox.path, "CRG sandbox executable");
  if (JSON.stringify(sandbox) !== JSON.stringify(config.sandbox)) fail("CRG sandbox identity does not match");
  const environment = verifyCrgEnvironmentIdentity({
    environmentRoot: config.environment?.environment_root,
    interpreterPath: config.environment?.interpreter?.path,
    commandPath: config.environment?.command?.path,
    manifest: config.environment,
  });
  return Object.freeze({ path, sha256: expectedSha256, config: Object.freeze({ ...config, environment, sandbox }) });
}

export function optionalCrgRuntimeConfig(sourceEnv = process.env) {
  const configPath = sourceEnv.CODEXLOOPER_CRG_CONFIG;
  const configSha256 = sourceEnv.CODEXLOOPER_CRG_CONFIG_SHA256;
  if (!configPath && !configSha256) return Object.freeze({ status: "unconfigured" });
  if (!configPath || !configSha256) fail("CRG config binding is incomplete");
  return Object.freeze({ status: "configured", ...readCrgRuntimeConfig({ configPath, expectedSha256: configSha256 }) });
}

export function deriveCrgSandboxIdentity({ configured, projectRoot, runDirectory, runStartSha } = {}) {
  if (configured?.status !== "configured") return null;
  if (typeof runStartSha !== "string" || !/^[a-f0-9]{40}$/u.test(runStartSha)) fail("Trusted CRG run-start SHA is invalid");
  const launch = createCrgMacosSandboxLaunch({
    projectRoot: resolve(projectRoot),
    runDir: resolve(runDirectory),
    environmentRoot: configured.config.environment.environment_root,
    interpreterPath: configured.config.environment.interpreter.path,
    commandPath: configured.config.environment.command.path,
    sandboxCommand: configured.config.sandbox.path,
    operation: "build",
    baseSha: runStartSha,
  });
  return Object.freeze({ config_sha256: configured.sha256, environment_sha256: digest(JSON.stringify(configured.config.environment)), sandbox_sha256: configured.config.sandbox.sha256, profile_sha256: launch.profile_sha256, run_start_sha: runStartSha });
}
