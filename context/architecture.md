# Architecture

CodexLooper is a thin local integration layer:

1. MEX supplies selective persistent project memory.
2. Ralphex executes roadmap tasks, retries, commits and review loops.
3. Terra is the only default builder and fixer.
4. Sol is an independent read-only reviewer.
5. CloseRouter provides the OpenAI-compatible Responses endpoint.
6. Deterministic tests and Git state remain the objective gates.

CodexLooper must not become a second orchestration engine. It supplies controlled launchers, model policy, preflight checks, receipts and safe defaults around the existing tools.
