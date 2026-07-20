import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareProfileLaunch } from "../src/profiles.mjs";

function fixture() {
  const project = mkdtempSync(join(tmpdir(), "codexlooper-profile-"));
  const runDirectory = join(project, ".codexlooper", "runs", "run-1");
  const snapshot = join(runDirectory, "snapshots", "snapshot-1");
  const codexHome = join(snapshot, ".codexlooper", "codex-home");
  const codex = join(project, "codex");
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(codex, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  chmodSync(codex, 0o700);
  return {
    project,
    snapshot,
    sourceEnv: {
      HOME: project,
      PATH: process.env.PATH,
      CLOSEROUTER_API_KEY: "closerouter_test_secret",
      CODEXLOOPER_REAL_CODEX: codex,
      CODEXLOOPER_RUN_DIR: runDirectory,
      CODEXLOOPER_ISOLATED_SNAPSHOT: snapshot,
      CODEX_HOME: codexHome,
      CODEXLOOPER_ALLOWED_MODELS: "openai/gpt-5.6-terra,openai/gpt-5.6-sol",
    },
  };
}

test("Linux workspace-write snapshots force the documented Landlock fallback", () => {
  const current = fixture();
  try {
    const launch = prepareProfileLaunch("builder", {
      json: true,
      sandbox: "workspace-write",
      sourceEnv: current.sourceEnv,
      projectRoot: current.snapshot,
      platform: "linux",
    });
    assert.ok(
      launch.args.some(
        (value, index) => value === "-c" && launch.args[index + 1] === "use_legacy_landlock=true",
      ),
    );
    assert.equal(launch.metadata.sandbox_backend, "legacy_landlock");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("Landlock override is absent for read-only and non-Linux launches", () => {
  const current = fixture();
  try {
    const readOnly = prepareProfileLaunch("reviewer", {
      json: true,
      sandbox: "read-only",
      sourceEnv: current.sourceEnv,
      projectRoot: current.snapshot,
      platform: "linux",
    });
    assert.equal(readOnly.args.includes("use_legacy_landlock=true"), false);

    const darwin = prepareProfileLaunch("builder", {
      json: true,
      sandbox: "workspace-write",
      sourceEnv: current.sourceEnv,
      projectRoot: current.snapshot,
      platform: "darwin",
    });
    assert.equal(darwin.args.includes("use_legacy_landlock=true"), false);
    assert.equal(darwin.metadata.sandbox_backend, "platform_default");
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});
