# Project State

## Working

- WP0 is complete and merged at `8e3b589a09bd2935dea19ce94b36e18cc2482d83`.
- Ralphex v1.6.0 integration is verified from source and end to end.
- MEX preflight, controlled CloseRouter launchers and isolated runtime state exist.
- Terra is the implementation and fix model.
- Sol is a separate read-only reviewer.
- Real CloseRouter identity and Codex CLI Responses smoke passed for both models.
- Node.js 20 and 22 CI passes on the WP0 baseline.
- The repository secret `CLOSEROUTER_API_KEY` is configured.

## WP1 in progress

- One tracked plan is accepted per run.
- The generated `codexlooper` command performs preflight and starts Ralphex.
- Codex `turn.completed` events are recorded as secret-free usage telemetry.
- Terra and Sol usage is separated and priced from the verified CloseRouter snapshot.
- Every run writes an atomic receipt with Git heads, commits, completion gates, tokens and estimated cost.
- A run is blocked unless the plan is completed, the worktree is clean, at least one commit exists and both Terra and Sol usage are present.

## Remaining external setup

- Rename the GitHub repository from `Projekt` to `codexlooper`.

## Next roadmap gate

Pass Node.js 20/22 CI and the real Ralphex v1.6.0 WP1 fixture, then execute one authorized real roadmap task through the new receipt runner.
