---
date: 2026-10-22
lives_in:
  - spec.md#commands
---

# Small fixes go in batches of 2 to 4, one task per batch

**Decision:** 2 to 4 small fixes make one task: one task file, one worktree, one agent, one commit per fix, one report; a fix that turns out bigger leaves the batch by `wf ask`.

**Why:** At the platform on 2026-10-21, a task fixed a bug in two lines (2 files, +4 −2) whose cause and place the orchestrator knew when it wrote the task. Around them, the worktree was prepared (541 packages, a copy of the database, personas), the agent wrote a brief and reproduced the bug, and the report ran to about 60 lines: the fixed cost of a task, in tokens and text.

**Rejected:** a light lane for small fixes outside a worktree: two agents would share one working directory ([one agent per working directory](2026-10-21-one-agent-per-directory.md))
