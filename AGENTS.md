# CodexLooper Agent Anchor

Read `ROUTER.md` before changing code. Load only the context files relevant to the active task.

Hard boundaries:

- Terra implements and fixes.
- Sol reviews in a separate read-only process.
- Secrets stay in environment variables.
- No push, merge, release, deployment or external communication without explicit approval.
- Run `npm run check` and `mex check --json` before declaring work complete.
