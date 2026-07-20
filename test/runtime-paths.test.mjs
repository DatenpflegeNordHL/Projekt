import test from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePrivateDirectoryChain } from "../src/runtime-paths.mjs";

test("creates private runtime directories", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-runtime-"));
  try {
    const target = ensurePrivateDirectoryChain(root, [".codexlooper", "runs", "run-1"]);
    assert.equal(lstatSync(target).isDirectory(), true);
    assert.equal(lstatSync(target).mode & 0o777, 0o700);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a symlinked .codexlooper directory", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-runtime-"));
  const outside = mkdtempSync(join(tmpdir(), "codexlooper-outside-"));
  try {
    symlinkSync(outside, join(root, ".codexlooper"));
    assert.throws(
      () => ensurePrivateDirectoryChain(root, [".codexlooper", "runs"]),
      (error) => error.code === "CODEXLOOPER_RUNTIME_PATH_INVALID",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects a symlinked runs directory", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-runtime-"));
  const outside = mkdtempSync(join(tmpdir(), "codexlooper-outside-"));
  try {
    mkdirSync(join(root, ".codexlooper"));
    symlinkSync(outside, join(root, ".codexlooper", "runs"));
    assert.throws(
      () => ensurePrivateDirectoryChain(root, [".codexlooper", "runs"]),
      (error) => error.code === "CODEXLOOPER_RUNTIME_PATH_INVALID",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
