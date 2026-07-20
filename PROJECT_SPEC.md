# CodexLooper

## Problem

Autonomous coding currently requires repeated manual transfer of roadmap context, implementation output, test results and review findings between tools.

## Goal

Provide one local command that connects MEX, Ralphex, Codex through CloseRouter, deterministic validation and independent model review.

## Required behavior

- MEX supplies persistent, selectively routed project context.
- Ralphex selects and executes roadmap tasks, retries failures and commits approved work.
- Terra is the default implementation model.
- Sol is the independent review model.
- CloseRouter is the only model gateway in the autonomous loop.
- Tests, lint, build, secret scanning and Git checks run before model approval where available.
- Model IDs, reasoning levels and run outcomes are recorded without prompts or secrets.

## Non-goals for version 1

- Desktop application or IDE.
- Cloud service or user accounts.
- Automatic push, merge, release or production deployment.
- External messages, purchases, contracts or account changes.
- Silent model or provider fallback.

## Safety boundary

Credentials are supplied only through process environment variables. They must not be written to Git, configuration files, logs or receipts. Destructive or external actions require an explicit stop.

## Completion definition

Version 1 is complete when a fixture project can run several roadmap tasks through MEX context selection, Terra implementation, deterministic gates, Sol review, bounded fixes, local commits and restart-safe progress without manual copy-paste.
