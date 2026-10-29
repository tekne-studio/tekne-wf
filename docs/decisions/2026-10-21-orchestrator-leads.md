---
date: 2026-10-21
lives_in:
  - spec.md#commands
---

# The orchestrator opens the agents without asking the person

**Decision:** The orchestrator splits the work, opens the agents (`wf spawn`), answers them, ships their work and tells the person; the person watches the panes and may step in.

**Why:** Each agent works in a herdr pane the person sees live, so the person steps in by watching; the person wants to be called only when needed (portrait.md, what the first round taught).

**Rejected:** asking the person before each spawn: a call for what the person sees anyway in the pane
