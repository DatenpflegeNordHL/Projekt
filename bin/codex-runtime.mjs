#!/usr/bin/env node

import { verifyRuntimeManifest } from "../src/runtime-integrity.mjs";

verifyRuntimeManifest({
  manifestPath: process.env.CODEXLOOPER_RUNTIME_MANIFEST,
  expectedManifestSha256: process.env.CODEXLOOPER_RUNTIME_MANIFEST_SHA256,
  expectedRuntimeDirectory: process.env.CODEXLOOPER_RUNTIME_DIR,
  expectedNodeExecutable: process.execPath,
});

await import("./codex-closerouter.mjs");
