# WP1 Minimal Autonomous Loop

## Scope

WP1 proves one real plan can move through MEX preflight, Ralphex, Terra implementation, deterministic checks, Sol review, local commits and a secret-free receipt without copy-paste between tools.

## Command

After installation:

```bash
export CLOSEROUTER_API_KEY='...'
.codexlooper/bin/codexlooper docs/plans/<plan>.md
```

Exactly one tracked Markdown plan inside `docs/plans/` is accepted. Completed plans, symlinks, dirty worktrees and missing credentials are rejected.

## Required completion gates

A run is successful only when:

- MEX, Codex and Ralphex preflight passes;
- Ralphex exits successfully;
- the plan is moved to `docs/plans/completed/`;
- at least one local commit is created;
- the final worktree is clean;
- Terra usage is recorded;
- Sol usage is recorded.

## Receipt

Each run writes:

```text
.codexlooper/runs/<run-id>/receipt.json
```

The receipt contains plan, timestamps, Git heads, commit count, model profiles, token usage, estimated cost and gate results. Credentials and full model responses are not stored.

## Pricing snapshot

The WP1 estimate uses the verified CloseRouter catalog snapshot from 2026-07-20:

| Model | Input / 1M | Cached input / 1M | Output / 1M |
|---|---:|---:|---:|
| `openai/gpt-5.6-terra` | $0.09 | $0.009 | $0.36 |
| `openai/gpt-5.6-sol` | $0.0945 | $0.00945 | $0.378 |

Dynamic catalog refresh and hard run budgets remain WP4 work.
