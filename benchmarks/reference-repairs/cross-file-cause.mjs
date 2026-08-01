import { writeFileSync } from "node:fs";
import { join } from "node:path";
export function applyCrossFileCauseRepair(workspace) { writeFileSync(join(workspace, "src/consumer.mjs"), "import { produceUser } from './producer.mjs';\nexport function displayName(name) { return produceUser(name).name.toUpperCase(); }\n"); }
