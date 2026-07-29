# WP6A Runtime A Local Proof

## Verdict

**PASS**

Runtime A was proven on the authorised macOS workstation without paid model calls and without any CRG execution.

## Candidate

- source commit: `9c3798b15c5f794c0742d166f8ffead8da8acaf0`
- platform: `darwin`
- architecture: `arm64`
- Node.js: `v26.3.0`
- runtime ID: `2be165996acf579c8db5aaa3af9d641e1e03609389018eae5a5d74747ce66a1e`
- runtime manifest SHA-256: `6c433c1e3809eb64bd42887d28a77270e09af59630857b5b287bfc765caaee75`

## Original tools used

- Codex CLI: `codex-cli 0.144.3`
- MEX: `0.6.3`
- Ralphex: `ralphex v1.6.1-5218609-20260721T074222`

## Local regression

- tests: `68`
- passed: `68`
- failed: `0`
- `git diff --check`: PASS
- candidate checkout clean after validation: PASS

## Trust checks

- source checkout clean: PASS
- MEX scaffold initialised through the real bootstrap path: PASS
- generated wrappers use the immutable copied runtime: PASS
- initial preflight: PASS
- branch drift rejected: PASS
- runtime tampering rejected: PASS
- paid model calls: `0`
- CRG builds: `0`

## Gate result

WP6A Loop Trust Hardening is complete.

This proof permits preparation of WP6B under Runtime A. It does not authorise:

- merging or releasing pull request 7;
- executing WP6B or WP6C;
- running `code-review-graph install`;
- enabling MCP integrations or hooks;
- spending CloseRouter or other model credits.
