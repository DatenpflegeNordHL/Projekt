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

function hasLandlockOverride(launch) {
  return launch.args.some(
    (value, index) => value === "-c" && launch.args[index + 1] === "use_legacy_landlock=true",
  );
}

test("Linux read-only and workspace-write launches force the Landlock fallback", () => {
  const current = fixture();
  try {
    for (const sandbox of ["read-only", "workspace-write"]) {
      const launch = prepareProfileLaunch(sandbox === "read-only" ? "reviewer" : "builder", {
        json: true,
        sandbox,
        sourceEnv: current.sourceEnv,
        projectRoot: current.snapshot,
        platform: "linux",
      });
      assert.equal(hasLandlockOverride(launch), true);
      assert.equal(launch.metadata.sandbox_backend, "legacy_landlock");
    }
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});

test("Landlock override is absent on non-Linux launches", () => {
  const current = fixture();
  try {
    for (const sandbox of ["read-only", "workspace-write"]) {
      const launch = prepareProfileLaunch(sandbox === "read-only" ? "reviewer" : "builder", {
        json: true,
        sandbox,
        sourceEnv: current.sourceEnv,
        projectRoot: current.snapshot,
        platform: "darwin",
      });
      assert.equal(hasLandlockOverride(launch), false);
      assert.equal(launch.metadata.sandbox_backend, "platform_default");
    }
  } finally {
    rmSync(current.project, { recursive: true, force: true });
  }
});
