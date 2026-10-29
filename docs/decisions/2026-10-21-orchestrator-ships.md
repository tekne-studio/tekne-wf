---
date: 2026-10-21
lives_in:
  - proposal.md#the-flow
---

# With an orchestrator, the agent never merges: it reports and the orchestrator ships

**Decision:** In orchestrated work the agent finishes with `wf report` and the orchestrator runs `wf ship`; a session alone in a worktree ships its own work.

**Why:** The orchestrator reads the diff and looks at what changed on screen before the fast-forward. Three projects had three versions of who merges (portrait.md, gap 3); the rules say one.

**Rejected:** the agent merging its own work with an orchestrator present, as the engine's sessions did, and kb's template after the person's yes: nobody but the author reads the diff before the fast-forward
