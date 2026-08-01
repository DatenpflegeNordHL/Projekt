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

The **core local CLI roadmap and hardened local runner are complete**.

- WP0: CloseRouter, Codex, MEX and Ralphex integration verified.
- WP1: real one-command Terra implementation and Sol review loop verified.
- WP2: reproducible non-destructive target-project bootstrap verified.
- WP3: review and repair loop completed inside WP1.
- WP4: token and cost controls completed inside WP1.
- WP5: real Terra/Sol and bootstrap pilots completed.
- WP6 trust hardening was merged in PR #7; PR #8 repaired the post-merge CI
  fixtures without relaxing production validation. The optional Code Review
  Graph context remains advisory and is not required for normal operation.
- WP8 Phase A was merged in PR #17. It provides a deterministic offline
  benchmark harness; real benchmark runs have not started.
- The only active next work is planning WP8 Phase B. Issue #9 and roadmap Issue
  #14 are the controlling sources for that work.

An optional dashboard remains a deferred product idea; it is not the meaning of
WP6.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for evidence and supported versions.

CodexLooper does not automatically push, merge, deploy, publish, purchase, contact third parties, or perform other external actions. Those require separate authorization.
