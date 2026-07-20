# WP0 Verification

Status: PARTIAL APPROVE

## Verified components

### Ralphex

- Repository: `umputun/ralphex`
- Verified source head inspected: `032776cc9cf54f80d0f31a67ff16534bb1a280a5`
- Latest documented release inspected: `v1.6.0`
- License: MIT
- Native Codex executor is available.
- Per-phase task and review models are configurable.
- Validation commands, retries, commits, worktrees, completion tracking, dashboard mode and stalemate controls already exist.

Decision: reuse Ralphex. Do not build a second roadmap orchestrator.

### MEX

- MEX remains the selective project-memory layer.
- Existing fork PR `DatenpflegeNordHL/mex#1` contains a CloseRouter adapter, but it is MontiHire-specific.
- Its controlled Codex launcher accepts positional prompts and blocks the `-c` overrides and stdin prompt shape used by Ralphex.

Decision: keep MEX provider-neutral. CodexLooper supplies a separate strict Ralphex-compatible launcher and consumes the target project's `.mex/` files.

### CloseRouter

- Base URL: `https://api.closerouter.dev/v1`
- Codex wire API: Responses API
- Authentication: `CLOSEROUTER_API_KEY`
- Exact model IDs are installation or project configuration, not silent defaults.

Initial profiles:

- builder: `openai/gpt-5.6-terra`, reasoning `medium`
- reviewer: `openai/gpt-5.6-sol`, reasoning `medium`
- critical review: Sol `high`

## Integration path

```text
project roadmap
-> Ralphex
-> strict CodexLooper launcher
-> Codex CLI with isolated CODEX_HOME
-> CloseRouter Responses API
-> Terra task session
-> deterministic validation
-> fresh Sol review session
-> bounded fix loop
-> local commit
```

MEX is loaded by project instructions and checked before autonomous execution:

```text
.mex/AGENTS.md
-> .mex/ROUTER.md
-> task-specific context manifest
```

## Remaining local verification

The following require the user's local machine and cannot be proven from repository inspection alone:

- installed Ralphex version and path;
- installed Codex CLI version `>= 0.130.0`;
- installed MEX command and target scaffold;
- live CloseRouter Terra and Sol identity smoke;
- actual returned provider, token and cost metadata;
- one end-to-end local fixture run.

## WP0 decision

```text
PROJECT_FACTORY_WP0=PARTIAL_APPROVE
ORCHESTRATOR=ralphex v1.6.0-compatible
EXECUTOR_PATH=Ralphex native Codex executor through strict CodexLooper launcher
REVIEW_PATH=Ralphex review phase with separate Sol model configuration
MEX_PATH=target-project .mex scaffold plus preflight check
CUSTOM_CODE_REQUIRED=strict launcher, installer, preflight and receipts
NEXT_ACTION=implement and test strict launcher
BLOCKING_FINDINGS=live local identity and end-to-end smoke still required
```
