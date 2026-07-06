---
description: Continue Fiber Test Lab backlog — implement the next ticket end-to-end
argument-hint: "[optional target ticket, e.g. E3-2 or issue #17]"
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

You are driving the Fiber Test Lab backlog as a dev harness.

Target for this run: $ARGUMENTS (if empty, pick the next unstarted ticket in order).

Steps:
1. Read `.context/processes/backlog.md` and `docs/hands-on/progress.md` to find the next ticket to do (or the one named in the target).
2. Read the relevant spec in `.context/` for that ticket before coding (system-design, scenario-schema, cli-spec, business-rules).
3. Implement it following project conventions:
   - TypeScript strict; run via `tsx` (no build step).
   - Validate every external input with zod before use.
   - Never hardcode ports/container names — derive from run-id.
   - Keep CLI handlers thin; logic in `lib/`.
   - Shared magic values live in `lib/constants.ts`.
   - Few comments — lean, readable code only.
4. Verify: `npm run typecheck` must pass. If the ticket has runtime behaviour and the demo-startup stack is running (localhost:10001-10003), exercise it live with a `npx tsx -e "import('./...').then(...)"` smoke check (avoid top-level await in -e).
5. Update `docs/hands-on/progress.md` (and the RPC notebook if new RPC data was captured).
6. When a logical chunk is done: create a branch off `canary` (or continue the active feature branch), commit with a plain, concise, imperative message — NO emoji, NO Claude/AI co-author trailer, authored as the user — then open/update a PR into `canary` and close the matching GitHub issue(s) with a note referencing the PR.

Only append to `.context/processes/decisions-log.md` after the user explicitly confirms a decision.
Report what you did, what you verified, and the next ticket.
