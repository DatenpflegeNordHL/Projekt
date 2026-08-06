# Contributing to CodexLooper

CodexLooper accepts small, reviewable contributions that preserve its trust boundaries and current roadmap order.

## Before opening a change

1. Read `README.md`, `PROJECT_SPEC.md` and `docs/ROADMAP.md`.
2. Check the controlling issue for the active work package.
3. Keep the change inside the currently authorised scope.
4. Do not introduce real credentials, live model runs or external actions unless the relevant plan and gate explicitly authorise them.

Large feature proposals should begin as an issue with a concrete problem, expected evidence and a reason the work belongs at its proposed place in the roadmap.

## Development requirements

- Node.js 20 or newer;
- Git;
- repository dependencies and external tools required by the affected workflow.

Run the complete local check before requesting review:

```bash
npm run check
```

For reliability or compatibility work, include repeated focused runs on every supported Node version relevant to the change.

## Pull-request expectations

A pull request should contain:

- one clearly bounded purpose;
- the root cause or design problem;
- the exact files and contracts changed;
- tests that fail before the fix when practical;
- validation results;
- known limitations and residual risks;
- no unrelated cleanup.

Draft pull requests are preferred until the implementation and evidence are complete.

## Review gates

Planning and implementation are separate gates:

```text
versioned plan
  -> independent plan review: PASS
  -> bounded implementation
  -> independent code review: PASS
  -> tests and CI
  -> merge
```

A `PASS` requires zero P0, P1 and P2 findings. A green test suite does not replace an independent review, because apparently software can be wrong and confident at the same time.

## Safety rules

Contributions must not:

- weaken assertions, skip tests or extend sleeps merely to hide races;
- allow models to determine their own success or evidence;
- expose hidden verifiers or reference repairs to candidate workspaces;
- write credentials, prompts, secrets or full reasoning into receipts;
- silently fall back to another model, provider or executable;
- grant automatic push, merge, deployment, publication, purchase or messaging authority;
- mix unrelated work packages in one branch or pull request.

## Commit style

Use short imperative subjects, for example:

```text
fix: wait for supervised process group exit
docs: publish complete B1a compatibility vectors
test: synchronize process supervisor startup
```

## Useful contributions now

Current priorities are:

- deterministic process-lifecycle and cleanup tests;
- Node 20 and Node 22 portability evidence;
- review of canonicalisation and identity vectors;
- small WP8 fixtures and verifier improvements inside the authorised phase;
- documentation corrections tied to actual merged behaviour.

New providers, dashboards, agents, browser automation and automatic deployment remain deferred until benchmark evidence justifies them.
