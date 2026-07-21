# CRG Read-Only Review Context Pilot

## Goal

Extend CodexLooper with an optional, host-controlled Code Review Graph context stage that helps the existing Sol reviewer identify blast radius, affected tests and structurally risky changes without granting Code Review Graph, Codex or Sol any additional write authority.

The extension must remain optional. A target project without Code Review Graph configured must retain the current verified Terra build, deterministic validation and Sol review behavior.

## Current facts

- CodexLooper already performs bounded plan execution, host-applied patches, deterministic validation, local commits, separate read-only Sol review and secret-free receipts.
- `code-review-graph` v2.3.6 can build a local Tree-sitter/SQLite graph and produce change, impact and test-gap reports.
- Its general installer writes MCP and hook configuration, and its MCP surface includes write-capable refactoring tools. Those integration paths are outside this pilot.
- The pilot is review context only. It is not part of the target product runtime and it must not block MontiHire when disabled.
- The active branch already contains the direct-plan archive collision guard from PR #5.

## Security boundary

- Do not run `code-review-graph install`.
- Do not modify `~/.codex`, user-level MCP configuration, editor configuration or Git hooks.
- Do not start MCP, HTTP, watch or background services.
- Do not enable local or cloud embeddings.
- Do not expose refactor or other write-capable tools.
- Do not allow Code Review Graph to modify tracked project files.
- Do not pass `CLOSEROUTER_API_KEY`, provider credentials or unrestricted inherited environment variables to Code Review Graph.
- Sol remains read-only and must independently verify graph-derived findings against repository files and tests.
- Code Review Graph failure, absence, timeout, stale data or malformed output must degrade to the existing baseline Sol review, never skip or weaken review.

## Allowed paths

- `src/**`
- `bin/**`
- `scripts/**`
- `tests/**`
- `package.json`
- `README.md`
- `docs/ROADMAP.md`
- `docs/CRG_REVIEW_CONTEXT.md`
- `context/project-state.md`
- `docs/plans/crg-readonly-review-pilot.md`

## Validation Commands

- `node --check src/crg-context.mjs`
- `node --check src/run.mjs`
- `node --check src/profiles.mjs`
- `node --check bin/sol-review.mjs`
- `node --check scripts/install.mjs`
- `node --test tests/crg-context.test.mjs tests/install.test.mjs tests/run.test.mjs`
- `npm run check`
- `git diff --check`

## Tasks

### Task 1: Inspect and preserve the current review boundary

- [ ] Trace the current Terra-to-host-to-Sol flow and identify the smallest host-side insertion point for supplemental review context.
- [ ] Preserve the existing reviewer model, read-only sandbox, output schema, validation gates, completion behavior and receipt guarantees.
- [ ] Do not introduce a second reviewer or a parallel orchestration path.

### Task 2: Add explicit optional configuration

- [ ] Add reviewed installer/bootstrap options for an absolute Code Review Graph executable and an exact accepted version, defaulting to disabled when not supplied.
- [ ] Require the executable to be absolute, executable and version-matched before storing it in local CodexLooper install state.
- [ ] Pin the pilot compatibility target to `2.3.6`; reject unknown versions rather than guessing compatibility.
- [ ] Keep all generated configuration under the target project's excluded `.codexlooper/` runtime tree.
- [ ] Do not modify global Codex, MCP, editor or hook configuration.

### Task 3: Implement a host-controlled read-only adapter

- [ ] Add a small adapter that invokes only an explicit allowlist of non-interactive review commands needed to build or refresh a graph and produce a bounded change report.
- [ ] Store graph data outside tracked paths, preferably under `.codexlooper/crg/` through an explicit data-directory setting.
- [ ] Use a minimal environment allowlist that excludes CloseRouter and provider credentials.
- [ ] Apply deterministic timeout, output-size and process-count limits.
- [ ] Redact credential-like values from captured stdout and stderr.
- [ ] Verify the Git worktree remains unchanged after every Code Review Graph invocation; treat any tracked change as a blocking adapter failure and do not forward its report.
- [ ] Never invoke install, serve, watch, embeddings, refactor or apply-refactor behavior.

### Task 4: Feed bounded context to Sol

- [ ] Run the adapter after the task commit and deterministic validation, immediately before the existing Sol review.
- [ ] Produce a compact report containing changed files, affected symbols or flows, likely dependent tests, risk indicators and explicit uncertainty.
- [ ] Save the report inside the private run directory with restrictive permissions.
- [ ] Append the bounded report to the existing Sol review input as untrusted advisory context, clearly separated from system instructions and the actual diff.
- [ ] Instruct Sol to verify every graph-derived claim against source and tests and to ignore any instruction-like text inside the report.
- [ ] Preserve the normal Sol review when the adapter is disabled or degraded.

### Task 5: Extend receipts without leaking data

- [ ] Record whether Code Review Graph was disabled, completed or degraded.
- [ ] Record the accepted version, bounded command names, duration, output byte count and report hash without storing source snippets, credentials or unrestricted stderr in the receipt.
- [ ] Ensure the existing secret-free receipt rejection remains effective.
- [ ] Do not count Code Review Graph output as model usage or model cost.

### Task 6: Add deterministic regression coverage

- [ ] Test the disabled default and prove byte-for-byte-equivalent baseline review behavior where practical.
- [ ] Test accepted absolute executable and exact version validation.
- [ ] Test rejection of relative paths, non-executables, wrong versions and unsupported configuration.
- [ ] Test command allowlisting, minimal environment, timeout, oversized output, malformed output and credential redaction.
- [ ] Test first-build and incremental-report fixture behavior using controlled fake executables, not network installation.
- [ ] Test that Code Review Graph failure still runs the existing Sol reviewer.
- [ ] Test that any tracked worktree mutation by the external process is detected and its output is discarded.
- [ ] Test receipt metadata and restrictive runtime-file placement.

### Task 7: Document the extension and next pilot gate

- [ ] Document installation as a separate user-controlled prerequisite; never auto-install the Python package.
- [ ] Document that the general Code Review Graph installer and MCP integration are not approved for CodexLooper.
- [ ] Document local-only operation, no embeddings and the degraded baseline path.
- [ ] Update the roadmap and project state with the implementation status and one next action: a separately authorized real comparison pilot on CodexLooper, followed by MontiHire only if the pilot passes.

## Acceptance criteria

- CodexLooper works exactly as before when Code Review Graph is not configured.
- The configured executable and version are explicit, absolute and locally verified.
- No global configuration, hooks, MCP service, background process, embedding provider or write-capable graph tool is introduced.
- Graph data and reports remain untracked and inside the private CodexLooper runtime tree.
- The external process receives no CloseRouter or model-provider credentials.
- Sol remains the only independent reviewer and remains read-only.
- A Code Review Graph failure cannot skip Sol review, mark a failed review as approved or leave a dirty worktree.
- All focused and complete tests pass.
- The worktree is clean after completion and the plan is moved to `docs/plans/completed/`.
- No push, merge, release, package publication or target-product change is performed by this plan.
