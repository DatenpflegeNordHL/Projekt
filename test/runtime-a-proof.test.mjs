import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proveRuntimeA } from "../scripts/runtime-a-proof.mjs";

function executable(path, content) {
  writeFileSync(path, content, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

test("Runtime A proof uses bootstrap, initializes MEX and remains model-free", () => {
  const root = mkdtempSync(join(tmpdir(), "codexlooper-runtime-a-proof-test-"));
  const tools = join(root, "tools");
  const output = join(root, "proof.json");
  mkdirSync(tools, { recursive: true });

  const codex = executable(
    join(tools, "codex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then echo 'codex-cli 0.144.6'; exit 0; fi\nexit 97\n",
  );
  const mex = executable(
    join(tools, "mex"),
    `#!/bin/sh
set -eu
if [ "\${1:-}" = "--version" ]; then echo 'mex 0.6.3'; exit 0; fi
if [ "\${1:-}" = "setup" ]; then
  mkdir -p .mex
  printf '%s\n' '# Runtime A proof MEX scaffold' > .mex/README.md
  exit 0
fi
if [ "\${1:-}" = "check" ] && [ "\${2:-}" = "--json" ]; then
  test -f .mex/README.md
  printf '%s\n' '{"score":100}'
  exit 0
fi
exit 98
`,
  );
  const ralphex = executable(
    join(tools, "ralphex"),
    "#!/bin/sh\nif [ \"${1:-}\" = \"--version\" ]; then echo 'ralphex 1.6.0'; exit 0; fi\nexit 99\n",
  );

  try {
    const evidence = proveRuntimeA({
      codex,
      mex,
      ralphex,
      outputPath: output,
      now: () => new Date("2026-07-22T17:30:00.000Z"),
      sourceCleanCheck: () => {},
    });

    assert.equal(evidence.status, "PASS");
    assert.equal(evidence.checks.mex_scaffold_initialized, true);
    assert.equal(evidence.checks.initial_preflight, "PASS");
    assert.equal(evidence.checks.branch_drift_rejected, true);
    assert.equal(evidence.checks.runtime_tamper_rejected, true);
    assert.equal(evidence.checks.paid_model_calls, 0);
    assert.equal(evidence.checks.crg_builds, 0);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), evidence);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
