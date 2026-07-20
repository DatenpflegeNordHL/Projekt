# CodexLooper

CodexLooper is a local autonomous development loop that connects:

- MEX for selective project memory;
- Ralphex for roadmap execution, retries and review orchestration;
- CloseRouter for controlled model access;
- Terra as the default builder;
- Sol as the independent reviewer;
- deterministic tests and Git as objective gates.

## Bootstrap a target project

The target must be a clean existing Git repository. CodexLooper preserves existing project files and creates only missing scaffold files.

```bash
node /path/to/codexlooper/scripts/bootstrap.mjs \
  --project /absolute/path/to/project \
  --real-codex "$(command -v codex)" \
  --mex-command "$(command -v mex)" \
  --ralphex-command "$(command -v ralphex)"
```

After reviewing and committing the generated scaffold, add a bounded plan under `docs/plans/` and run:

```bash
/path/to/project/.codexlooper/bin/codexlooper docs/plans/your-plan.md
```

## Current status

- WP0: CloseRouter, Codex, MEX and Ralphex integration verified.
- WP1: real one-command Terra implementation and Sol review loop verified.
- WP2: reproducible non-destructive target-project bootstrap in progress.

Version 1 is a local CLI. It does not push, merge, deploy, publish, purchase, or perform other external actions without explicit authorization.
