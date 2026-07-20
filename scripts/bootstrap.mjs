#!/usr/bin/env node

import { bootstrap } from "../src/bootstrap.mjs";

try {
  const result = bootstrap();
  process.stdout.write(
    `CODEXLOOPER_BOOTSTRAP=PASS\nRUN_COMMAND=${result.runCommand}\nRECEIPT=${result.receiptPath}\n`,
  );
} catch (error) {
  process.stderr.write(`CODEXLOOPER_BOOTSTRAP=BLOCK: ${error.message}\n`);
  process.exitCode = 1;
}
