# WP6B Independent Plan Review

## Verdict

**BLOCKED PENDING REMEDIATION**

The review was performed against the exact WP6B planning specification and the original Code Review Graph v2.3.6 source at commit:

`935695f800f2b02e71aae6d463f3df65f0c6493e`

No CRG graph was built and no model was called.

## Confirmed upstream contract

- package version: `2.3.6`;
- console entry point: `code_review_graph.cli:main`;
- `build` supports `--repo`, `--skip-flows` and `--data-dir`;
- `detect-changes` supports `--repo` and `--base` and is described as read-only;
- exact no-change output: `No changes detected.`;
- `CRG_DATA_DIR` controls graph storage when no registry entry overrides it.

## Blocking finding 1: incomplete executable identity

The recorded SHA-256 covers only the generated console entry script. That script imports the Python interpreter, the `code_review_graph` package and transitive dependencies from the virtual environment. An unchanged console script therefore does not prove unchanged runtime code.

Required remediation:

- record the canonical interpreter path, version and SHA-256;
- create a deterministic SHA-256 manifest for every regular file and symlink target in the isolated CRG environment;
- reject unknown, missing, changed or newly added files;
- seal the environment read-only after manifest creation;
- verify the complete environment manifest before every CRG invocation;
- set `PYTHONNOUSERSITE=1`, `PYTHONSAFEPATH=1` and `PYTHONDONTWRITEBYTECODE=1`.

## Blocking finding 2: uncontrolled parser fan-out

CRG v2.3.6 defaults to a process executor on macOS and Linux and chooses up to eight workers from CPU count.

Required remediation:

- set `CRG_PARSE_EXECUTOR=thread`;
- set `CRG_PARSE_WORKERS=1`;
- reject inherited conflicting values;
- enforce process-group timeout and output/storage ceilings independently.

## Blocking finding 3: legacy database repository mutation

The upstream `get_db_path()` implementation can move a repository-root `.code-review-graph.db` into the selected data directory and delete legacy WAL, SHM or journal side files. The implementation does not enforce the source comment's claimed skip when `CRG_DATA_DIR` is set.

Required remediation:

- fail closed before CRG execution if any of these exist at repository root:
  - `.code-review-graph.db`;
  - `.code-review-graph.db-wal`;
  - `.code-review-graph.db-shm`;
  - `.code-review-graph.db-journal`;
- record repository status and protected-path identities before invocation;
- verify no repository path changed after every CRG command;
- never allow the adapter to migrate or delete legacy CRG data.

## Blocking finding 4: no OS-enforced network and write sandbox

A minimal environment removes credentials but does not itself prevent network access or writes through an unexpected dependency path.

Required remediation for the authorised macOS execution path:

- run CRG through an explicit OS sandbox profile;
- deny network access;
- deny writes outside the private run directory and private temporary directory;
- allow read-only access only to the project, CRG environment, system libraries and required Git executable paths;
- fail closed if the sandbox command or profile cannot be verified;
- add deterministic sandbox-denial tests.

An alternative operating-system isolation mechanism requires separate architecture approval before use.

## Non-blocking confirmations

- avoiding `code-review-graph install` is correct because the upstream command modifies MCP configuration, instruction files and hooks;
- raw CRG output must not enter the Sol prompt;
- exact `No changes detected.` normalization is required;
- one graph cache per version, run-start SHA and current trusted HEAD is coherent;
- CRG failures may be fail-open only after executable, environment, sandbox and path trust checks pass.

## Gate result

The local package installation prerequisite is satisfied, but WP6B must remain outside `docs/plans/` until all four blocking findings are reflected in the planning specification and the CRG environment seal plus sandbox prerequisites are proven locally.
