import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crgCacheDataDirectory, crgCacheKey, readCrgBuildCache, writeCrgBuildCache } from "../src/crg-cache.mjs";

const identity = { config_sha256: "a".repeat(64), environment_sha256: "b".repeat(64), sandbox_sha256: "c".repeat(64), profile_sha256: "d".repeat(64), current_trusted_head: "e".repeat(40) };
test("CRG cache reuses only an exact trusted identity key and fails closed on tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-cache-"));
  try {
    const key = crgCacheKey({ projectRoot: root, identity });
    assert.equal(readCrgBuildCache({ projectRoot: root, key }), null);
    const data = crgCacheDataDirectory({ projectRoot: root, key, create: true });
    writeCrgBuildCache({ projectRoot: root, key, version: "2.3.6" });
    assert.equal(readCrgBuildCache({ projectRoot: root, key }).version, "2.3.6");
    assert.equal(crgCacheDataDirectory({ projectRoot: root, key }), data);
    assert.notEqual(key, crgCacheKey({ projectRoot: root, identity: { ...identity, current_trusted_head: "f".repeat(40) } }));
    const path = join(root, ".codexlooper", "crg-cache", `${key}.json`);
    writeFileSync(path, "{}", { mode: 0o600 }); chmodSync(path, 0o600);
    assert.throws(() => readCrgBuildCache({ projectRoot: root, key }), /does not match/);
    const partialKey = crgCacheKey({ projectRoot: root, identity: { ...identity, current_trusted_head: "c".repeat(40) } });
    crgCacheDataDirectory({ projectRoot: root, key: partialKey, create: true });
    assert.throws(() => crgCacheDataDirectory({ projectRoot: root, key: partialKey, create: true }), /without a committed marker/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
