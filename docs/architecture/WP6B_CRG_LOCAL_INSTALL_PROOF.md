# WP6B CRG Local Install Proof

## Verdict

**PASS**

The original Code Review Graph package was installed in an isolated local Python environment on the authorised macOS workstation. No graph was built, no model was called and the separate CRG integration subcommand was not used.

## Upstream identity

- repository: `tirth8205/code-review-graph`
- release commit: `935695f800f2b02e71aae6d463f3df65f0c6493e`
- package version: `2.3.6`
- CLI version output: `code-review-graph 2.3.6`

## Local installation

- environment: `$HOME/.local/share/codexlooper/crg-2.3.6`
- command: `$HOME/.local/share/codexlooper/crg-2.3.6/bin/code-review-graph`
- Python: `3.14.6`
- command SHA-256: `1c0e3e3ad5383069926583667f7c536e8111deddc793189e15d31f34e1d6d604`
- dependency freeze SHA-256: `08f4a3b2a2265df20646078706006232f7d5137160949e0c5e7a4223faa950af`

The command was verified as:

- a regular file;
- non-symlink;
- executable;
- resolved to its exact canonical path.

## Safety checks

- exact release commit: PASS
- exact package version: PASS
- exact CLI output: PASS
- graph builds: `0`
- model calls: `0`
- `code-review-graph install` used: `false`
- MCP integration enabled: `false`
- hooks installed: `false`

## Gate result

The original executable prerequisite for WP6B is satisfied.

This proof permits final review of the WP6B planning specification. It does not authorise:

- promotion into `docs/plans/`;
- execution through Runtime A;
- a real CRG graph build;
- WP6C live smoke;
- model or CloseRouter spending;
- merge or release of pull request 7.
