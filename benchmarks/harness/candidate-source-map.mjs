import { createHash } from "node:crypto";

export const MAX_CANDIDATE_FILES = 16;
export const MAX_CANDIDATE_FILE_BYTES = 64 * 1024;
export const MAX_CANDIDATE_TOTAL_BYTES = 48 * 1024;

function fail(message) { throw new Error(`BENCHMARK_SOURCE_MAP_INVALID: ${message}`); }
function u32(value) { const output = Buffer.alloc(4); output.writeUInt32BE(value); return output; }
function u64(value) { const output = Buffer.alloc(8); output.writeBigUInt64BE(BigInt(value)); return output; }
function field(value) { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"); return Buffer.concat([u32(bytes.length), bytes]); }
function record(value) { return field(value); }
function hasOnlyDataProperties(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail(`${name} shape`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(`${name} property`);
  }
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail(`${name} keys`);
  return value;
}

export function assertSafePosixPath(path, name = "path") {
  if (typeof path !== "string" || !path || path.length > 1024 || /[\\\0-\x1F\x7F-\x9F]/.test(path) || /[\uD800-\uDFFF]/.test(path) || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) fail(`${name} path`);
  return path;
}

export function entryBytes(entry) {
  const path = field(entry.path);
  if (entry.type === "file") return Buffer.concat([path, Buffer.from([1]), u32(entry.mode), u64(entry.size), Buffer.from(entry.sha256, "hex")]);
  if (entry.type === "symlink") return Buffer.concat([path, Buffer.from([2]), u32(entry.mode), field(entry.target), Buffer.from(entry.sha256, "hex")]);
  fail("entry type");
}

export function treeDigest(entries, phase) {
  const domain = phase === "initial" ? "codexlooper.initial-tree.v1" : phase === "final" ? "codexlooper.final-tree.v1" : null;
  if (!domain) fail("tree phase");
  return createHash("sha256").update(`${domain}\0`, "utf8").update(Buffer.concat(entries.map((entry) => record(entryBytes(entry))))).digest("hex");
}

export function assertUniqueSortedPaths(entries, name = "entries") {
  let previous = null;
  for (const entry of entries) {
    assertSafePosixPath(entry.path, name);
    if (previous !== null && Buffer.compare(Buffer.from(previous, "utf8"), Buffer.from(entry.path, "utf8")) >= 0) fail(`${name} paths`);
    previous = entry.path;
  }
  return entries;
}

export function validateSourceMap(sourceMap, expectedPaths) {
  if (!Array.isArray(sourceMap) || Object.getPrototypeOf(sourceMap) !== Array.prototype || Object.getOwnPropertySymbols(sourceMap).length || sourceMap.length > MAX_CANDIDATE_FILES) fail("source map shape");
  for (let index = 0; index < sourceMap.length; index += 1) {
    if (!Object.hasOwn(sourceMap, index)) fail("source map dense");
    const descriptor = Object.getOwnPropertyDescriptor(sourceMap, String(index));
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("source map property");
  }
  for (const key of Reflect.ownKeys(sourceMap)) {
    if (key === "length") continue;
    if (!/^(0|[1-9]\d*)$/.test(key)) fail("source map property");
  }
  const expected = [...expectedPaths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (new Set(expected).size !== expected.length || expected.some((path) => assertSafePosixPath(path, "expected") !== path)) fail("expected paths");
  const entries = [];
  let total = 0;
  for (const [index, raw] of sourceMap.entries()) {
    const value = hasOnlyDataProperties(raw, ["path", "mode", "size", "sha256", "source"], `source[${index}]`);
    assertSafePosixPath(value.path, `source[${index}]`);
    if (!Number.isSafeInteger(value.mode) || value.mode < 0 || value.mode > 0o777 || (value.mode & 0o111) !== 0) fail(`source[${index}] mode`);
    if (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > MAX_CANDIDATE_FILE_BYTES || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256) || typeof value.source !== "string" || /[\uD800-\uDFFF]/.test(value.source)) fail(`source[${index}] metadata`);
    const bytes = Buffer.from(value.source, "utf8");
    if (bytes.length !== value.size || bytes.length > MAX_CANDIDATE_FILE_BYTES || createHash("sha256").update(bytes).digest("hex") !== value.sha256) fail(`source[${index}] bytes`);
    total += bytes.length;
    if (total > MAX_CANDIDATE_TOTAL_BYTES) fail("source map size");
    entries.push({ path: value.path, type: "file", mode: value.mode, size: value.size, sha256: value.sha256, source: value.source });
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  assertUniqueSortedPaths(entries, "source map");
  if (entries.length !== expected.length || entries.some((entry, index) => entry.path !== expected[index])) fail("source map paths");
  const frozen = entries.map((entry) => Object.freeze({ path: entry.path, mode: entry.mode, size: entry.size, sha256: entry.sha256, source: entry.source }));
  return Object.freeze({ sourceMap: Object.freeze(frozen), entries: Object.freeze(entries.map(({ source, ...entry }) => Object.freeze(entry))), sha256: treeDigest(entries, "final") });
}
