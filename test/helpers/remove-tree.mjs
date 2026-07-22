import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";

function unseal(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) unseal(resolve(path, entry));
    return;
  }
  chmodSync(path, 0o600);
}

export function removeTree(path) {
  if (!existsSync(path)) return;
  unseal(path);
  rmSync(path, { recursive: true, force: true });
}
