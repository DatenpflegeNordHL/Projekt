# Project State

## Working

- Ralphex v1.6.0 integration contract verified from source.
- Controlled CloseRouter Codex launchers exist.
- Terra builder and Sol reviewer are separated.
- Installer, preflight, unit tests and integration fixtures exist.
- Node.js 20 and 22 CI passes.
- Real CloseRouter identity and CLI smoke tooling exists.

## Blocked pending explicit external setup

- Repository must be renamed from `Projekt` to `codexlooper` in GitHub settings.
- The repository secret `CLOSEROUTER_API_KEY` must be configured.
- The manual live-smoke workflow must run successfully.

## Next roadmap gate

After the live smoke passes, close WP0 and execute WP1: one real roadmap task through MEX, Ralphex, Terra, deterministic checks, Sol review and a local commit.
