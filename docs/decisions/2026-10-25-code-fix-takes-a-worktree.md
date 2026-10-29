---
date: 2026-10-25
lives_in:
  - spec.md#commands
resolves:
  - should-a-one-line-code-fix-skip-the-worktree
---

# A code fix goes through a worktree, however small

**Decision:** The orchestrator commits only changes with no behavior; a one-line code fix takes a worktree, an agent and a ship.

**Why:** Every commit on the integration branch then passed the gates a ship gives it, the orchestrator writes no code outside a watched pane, and a spawn costs about a minute.

**Rejected:** wf ship --here, which runs every gate on the main checkout's working tree and commits there: it waits until a round shows how many one-line fixes pay a worktree.
