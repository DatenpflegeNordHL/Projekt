# WP2: Project Bootstrap

## Goal

Turn a clean existing Git repository into a CodexLooper target project without replacing owner-authored files.

## Command

```bash
node /path/to/codexlooper/scripts/bootstrap.mjs \
  --project /absolute/path/to/project \
  --real-codex "$(command -v codex)" \
  --mex-command "$(command -v mex)" \
  --ralphex-command "$(command -v ralphex)"
```

## Safety contract

- the project must be the exact Git root;
- the visible worktree must be clean before bootstrap;
- all executable paths must be absolute;
- existing scaffold files are preserved byte-for-byte;
- missing files are written atomically;
- symlinked targets and unsafe parent paths are rejected;
- MEX must complete `setup` and `check --json` successfully;
- visible changes are restricted to the MEX and CodexLooper scaffold;
- credentials are not written into the bootstrap receipt;
- no commit, push, merge, deployment, purchase, or other external action is performed.

## Generated or preserved files

- `AGENTS.md`
- `ROUTER.md`
- `PROJECT_SPEC.md`
- `context/project-state.md`
- `patterns/INDEX.md`
- `docs/plans/README.md`
- MEX-owned files under `.mex/`

Runtime-only files are installed under `.codexlooper/` and `.ralphex/` and added to the repository-local Git exclude file.

## Result

A successful command prints:

```text
CODEXLOOPER_BOOTSTRAP=PASS
RUN_COMMAND=/absolute/path/to/project/.codexlooper/bin/codexlooper
RECEIPT=/absolute/path/to/project/.codexlooper/bootstrap.json
```

The generated visible scaffold remains uncommitted for human review. After committing it, the bootstrap command is idempotent.
