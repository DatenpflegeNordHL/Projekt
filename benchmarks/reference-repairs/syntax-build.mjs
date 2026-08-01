import { writeFileSync } from "node:fs";
import { join } from "node:path";
export function applySyntaxBuildRepair(workspace) { writeFileSync(join(workspace, "src/entry.mjs"), "export const message = 'ready';\nexport function greeting(name) { return `hello ${name}`; }\n"); }
