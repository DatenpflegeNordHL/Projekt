import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { sha256 } from "../schema/benchmark-result.v1.mjs";
import { assertSafePosixPath, assertUniqueSortedPaths, entryBytes, treeDigest, validateSourceMap, MAX_CANDIDATE_FILE_BYTES, MAX_CANDIDATE_FILES, MAX_CANDIDATE_TOTAL_BYTES } from "./candidate-source-map.mjs";

const EXCLUDED = new Set([".git", ".codexlooper", ".ralphex", ".benchmark-runner"]);
function u32(value) { const output = Buffer.alloc(4); output.writeUInt32BE(value); return output; }
function field(value) { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"); return Buffer.concat([u32(bytes.length), bytes]); }
function record(value) { return field(value); }
function absentEntry() { return Buffer.from([0]); }

function workspacePath(root, file) { return assertSafePosixPath(relative(root, file), "workspace"); }
function walk(root, current = root, entries = []) {
  const names = readdirSync(current, { encoding: "buffer" }).sort(Buffer.compare);
  for (const rawName of names) {
    const name = rawName.toString("utf8");
    if (!Buffer.from(name, "utf8").equals(rawName)) throw new Error("BENCHMARK_TREE_INVALID: non-UTF-8 filename");
    if (current === root && EXCLUDED.has(name)) continue;
    const file = join(current, name); const stat = lstatSync(file); const path = workspacePath(root, file);
    if (stat.isDirectory()) walk(root, file, entries);
    else if (stat.isFile()) entries.push({ path, type: "file", mode: stat.mode & 0o777, size: stat.size, sha256: sha256(readFileSync(file)) });
    else if (stat.isSymbolicLink()) {
      const rawTarget = readlinkSync(file, "buffer"); const target = rawTarget.toString("utf8");
      if (!Buffer.from(target, "utf8").equals(rawTarget)) throw new Error(`BENCHMARK_TREE_INVALID: non-UTF-8 symlink target ${path}`);
      entries.push({ path, type: "symlink", mode: stat.mode & 0o777, target, sha256: sha256(rawTarget) });
    }
    else throw new Error(`BENCHMARK_TREE_INVALID: unsupported entry ${path}`);
  }
  return entries;
}

export function snapshotTree(root, phase = "initial") {
  const entries = walk(root).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  assertUniqueSortedPaths(entries, "snapshot");
  return { entries, sha256: treeDigest(entries, phase) };
}

function readSourceFiles(root, current, sourceMap, totals) {
  const names = readdirSync(current, { encoding: "buffer" }).sort(Buffer.compare);
  for (const rawName of names) {
    const name = rawName.toString("utf8");
    if (!Buffer.from(name, "utf8").equals(rawName)) throw new Error("BENCHMARK_SOURCE_MAP_INVALID: non-UTF-8 filename");
    if (current === root && EXCLUDED.has(name)) continue;
    const file = join(current, name); const path = workspacePath(root, file); const stat = lstatSync(file);
    if (stat.isDirectory()) readSourceFiles(root, file, sourceMap, totals);
    else {
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) !== 0) throw new Error(`BENCHMARK_SOURCE_MAP_INVALID: source type ${path}`);
      const bytes = readFileSync(file);
      if (bytes.length > MAX_CANDIDATE_FILE_BYTES) throw new Error(`BENCHMARK_SOURCE_MAP_INVALID: source size ${path}`);
      const source = bytes.toString("utf8");
      if (!Buffer.from(source, "utf8").equals(bytes)) throw new Error(`BENCHMARK_SOURCE_MAP_INVALID: source encoding ${path}`);
      totals.files += 1; totals.bytes += bytes.length;
      if (totals.files > MAX_CANDIDATE_FILES || totals.bytes > MAX_CANDIDATE_TOTAL_BYTES) throw new Error("BENCHMARK_SOURCE_MAP_INVALID: source limits");
      sourceMap.push({ path, mode: stat.mode & 0o777, size: bytes.length, sha256: sha256(bytes), source });
    }
  }
}

export function readCandidateSourceMap(root, expectedPaths) {
  const sourceMap = [];
  readSourceFiles(root, root, sourceMap, { files: 0, bytes: 0 });
  return validateSourceMap(sourceMap, expectedPaths);
}

export function deriveChanges(initial, final) {
  assertUniqueSortedPaths(initial.entries, "initial snapshot");
  assertUniqueSortedPaths(final.entries, "final snapshot");
  const before = new Map(initial.entries.map((entry) => [entry.path, entry])); const after = new Map(final.entries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const entries = [];
  for (const path of paths) {
    const oldEntry = before.get(path); const newEntry = after.get(path);
    if (JSON.stringify(oldEntry) === JSON.stringify(newEntry)) continue;
    let kind = !oldEntry ? "add" : !newEntry ? "delete" : oldEntry.type !== newEntry.type || oldEntry.type === "symlink" && oldEntry.target !== newEntry.target ? "symlink_change" : oldEntry.sha256 === newEntry.sha256 && oldEntry.mode !== newEntry.mode ? "mode_change" : "modify";
    entries.push({ path, kind, before: oldEntry ?? null, after: newEntry ?? null });
  }
  const records = [record(Buffer.from(initial.sha256, "hex")), record(Buffer.from(final.sha256, "hex")), ...entries.map((entry) => {
    const kind = Buffer.from(entry.kind, "utf8");
    return record(Buffer.concat([field(entry.path), field(kind), field(entry.before ? entryBytes(entry.before) : absentEntry()), field(entry.after ? entryBytes(entry.after) : absentEntry())]));
  })];
  return { entries, sha256: createHash("sha256").update("codexlooper.workspace-delta.v1\0", "utf8").update(Buffer.concat(records)).digest("hex") };
}

export function executableSha256(path = process.execPath) { return sha256(readFileSync(path)); }
