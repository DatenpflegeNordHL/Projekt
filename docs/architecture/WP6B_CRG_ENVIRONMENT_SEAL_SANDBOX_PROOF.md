# WP6B CRG Environment Seal and Sandbox Proof

## Verdict

**PASS**

The authorised macOS workstation completed the full Code Review Graph environment seal and sandbox proof for the pinned local installation. No graph was built, no model was called and the CRG integration subcommand was not used.

## Pinned source identity

- repository: `tirth8205/code-review-graph`
- release commit: `935695f800f2b02e71aae6d463f3df65f0c6493e`
- package version: `2.3.6`
- CLI version output after sealing and inside the sandbox: `code-review-graph 2.3.6`

## Complete environment identity

- environment: `$HOME/.local/share/codexlooper/crg-2.3.6`
- manifest schema: `codexlooper.crg-environment-manifest.v2`
- manifest SHA-256: `5fe0b287f834d44588f8977e0e1fe1af56ca6397cbf60a51a976a15f37448576`
- manifest entries: `10207`
- dependency-freeze SHA-256: `08f4a3b2a2265df20646078706006232f7d5137160949e0c5e7a4223faa950af`
- console-command SHA-256: `1c0e3e3ad5383069926583667f7c536e8111deddc793189e15d31f34e1d6d604`
- canonical interpreter version: `3.14.6`
- canonical interpreter SHA-256: `b502cb4c5b46b8d4192ec6bcb600ce8922f1afc396fcf646e8765c6eba74a0bf`
- environment sealed read-only: PASS
- complete manifest re-verification after all denial probes: PASS

## Python 3.14 launcher identity

The reproducible CPython 3.14 POSIX venv launcher was included in the manifest under the exact constrained identity:

- path: `bin/𝜋thon`
- first code point: `U+1D70B`
- UTF-8 bytes: `f09d9c8b74686f6e`
- literal target: `python3.14`
- resolved target: the same canonical Python 3.14.6 interpreter as the normal venv launchers

The launcher is not used to execute CRG. Any changed path, code point, byte sequence, literal target or resolved target is an integrity failure.

## macOS sandbox identity

- command: `/usr/bin/sandbox-exec`
- command SHA-256: `8857d087219f0f39d3e3c163e5d0a0aed690cc22f34b50c7eee3d74f93e69688`
- profile SHA-256: `75ba349667783004b80209bf1f064379b990530490e2a369a83e14a22715038a`
- private temporary path canonicalised below `/private/var/folders/...`: PASS
- private run-directory write allowed: PASS
- write outside the private run directory denied: PASS
- network access denied: PASS
- `CRG_PARSE_EXECUTOR=thread`: PASS
- `CRG_PARSE_WORKERS=1`: PASS

## Repository and execution boundaries

- legacy repository-root CRG database paths absent: PASS
- graph builds: `0`
- model calls: `0`
- `code-review-graph install` used: `false`
- MCP integration enabled: `false`
- hooks installed: `false`

## Gate result

The complete environment-identity, read-only-seal and macOS-sandbox prerequisites for final WP6B plan review are satisfied.

This proof does not authorise:

- promotion into `docs/plans/`;
- execution through Runtime A;
- a CRG graph build;
- Terra, Sol or CloseRouter spending;
- WP6C live smoke;
- merge or release of pull request 7.
