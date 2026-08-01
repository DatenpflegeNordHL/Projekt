import { writeFileSync } from "node:fs";
import { join } from "node:path";
export function applyLogicBugRepair(workspace) { writeFileSync(join(workspace, "src/logic.mjs"), "export function isNonEmpty(value) { return typeof value === 'string' && value.length > 0; }\n"); }
