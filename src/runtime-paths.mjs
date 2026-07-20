import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

function fail(message) {
  const error = new Error(message);
  error.code = "CODEXLOOPER_RUNTIME_PATH_INVALID";
  throw error;
}

function validateSegment(segment) {
  if (
    typeof segment !== "string" ||
    !segment ||
    segment === "." ||
    segment === ".." ||
    basename(segment) !== segment ||
    segment.includes("\0") ||
    segment.includes(sep)
  ) {
    fail("Runtime directory segment is invalid");
  }
}

export function ensurePrivateDirectoryChain(projectRoot, segments) {
  const root = realpathSync(projectRoot);
  let current = root;
  for (const segment of segments) {
    validateSegment(segment);
    const parent = current;
    current = resolve(parent, segment);
    const rel = relative(root, current);
    if (!rel || rel.startsWith("..") || rel.split(sep).includes("..")) {
      fail("Runtime directory escaped the project root");
    }
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        fail(`Runtime path is not a real directory: ${segment}`);
      }
      const realParent = realpathSync(dirname(current));
      const realCurrent = realpathSync(current);
      if (realCurrent !== resolve(realParent, segment)) {
        fail(`Runtime path traverses a symlink: ${segment}`);
      }
    } else {
      mkdirSync(current, { mode: 0o700 });
    }
    chmodSync(current, 0o700);
  }
  return current;
}
