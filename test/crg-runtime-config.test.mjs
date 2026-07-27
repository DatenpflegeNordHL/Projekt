import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCrgRuntimeConfig,
  deriveCrgSandboxIdentity,
  optionalCrgRuntimeConfig,
  serializeCrgRuntimeConfig,
} from "../src/crg-runtime-config.mjs";

function executable(path) {
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

function configuredFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codexlooper-crg-config-")));
  const environment = join(root, "environment");
  mkdirSync(join(environment, "bin"), { recursive: true });
  const interpreter = executable(join(environment, "bin", "python"));
  const command = executable(join(environment, "bin", "crg"));
  const sandbox = executable(join(root, "sandbox-exec"));
  const content = serializeCrgRuntimeConfig(createCrgRuntimeConfig({ environmentRoot: environment, interpreterPath: interpreter, commandPath: command, sandboxCommand: sandbox }));
  const config = join(root, "config.json");
  writeFileSync(config, content, { mode: 0o600 });
  chmodSync(config, 0o600);
  return { root, environment, config, content };
}

test("sealed CRG config validates, produces only digests, and derives without execution", () => {
  const fixture = configuredFixture();
  try {
    const sha256 = createHash("sha256").update(fixture.content).digest("hex");
    const configured = optionalCrgRuntimeConfig({ CODEXLOOPER_CRG_CONFIG: fixture.config, CODEXLOOPER_CRG_CONFIG_SHA256: sha256 });
    assert.equal(configured.status, "configured");
    const runDirectory = join(fixture.root, "run");
    mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    const identity = deriveCrgSandboxIdentity({ configured, projectRoot: fixture.root, runDirectory, runStartSha: "a".repeat(40) });
    assert.deepEqual(Object.keys(identity).sort(), ["config_sha256", "environment_sha256", "profile_sha256", "run_start_sha", "sandbox_sha256"]);
    assert.equal(optionalCrgRuntimeConfig({}).status, "unconfigured");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("sealed CRG config fails closed for tampering, permissions, and symlinks", () => {
  const fixture = configuredFixture();
  try {
    const sha256 = createHash("sha256").update(fixture.content).digest("hex");
    writeFileSync(fixture.config, `${fixture.content} `);
    assert.throws(() => optionalCrgRuntimeConfig({ CODEXLOOPER_CRG_CONFIG: fixture.config, CODEXLOOPER_CRG_CONFIG_SHA256: sha256 }), /digest/);
    writeFileSync(fixture.config, fixture.content);
    chmodSync(fixture.config, 0o644);
    assert.throws(() => optionalCrgRuntimeConfig({ CODEXLOOPER_CRG_CONFIG: fixture.config, CODEXLOOPER_CRG_CONFIG_SHA256: sha256 }), /private regular/);
    chmodSync(fixture.config, 0o600);
    const linked = join(fixture.root, "linked.json");
    symlinkSync(fixture.config, linked);
    assert.throws(() => optionalCrgRuntimeConfig({ CODEXLOOPER_CRG_CONFIG: linked, CODEXLOOPER_CRG_CONFIG_SHA256: sha256 }), /canonical/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
