---
date: 2026-10-21
lives_in:
  - proposal.md#the-flow
---

# Merging into the integration branch needs no yes from the person; a push does

**Decision:** Once the orchestrator has checked the work and `wf ship` passes, the work reaches the integration branch without the person's yes; a push to a shared environment waits for it.

**Why:** The platform and the engine already merged this way. `wf ship` runs every gate before the fast-forward and never pushes, so what reaches others still waits for the person.

**Rejected:** a yes for every merge, as kb's worktrees template asked (portrait.md, gap 3)
