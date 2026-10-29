---
date: 2026-10-22
lives_in:
  - spec.md#commands
  - roadmap.md
---

# Tools change between rounds, never during one

**Decision:** A wf or kb upgrade waits until a round ships and no worktree is open; an improvement to a tool found during a round goes to that tool's roadmap, for one release at the end of the round.

**Why:** At the platform on 2026-10-21/22, `AGENTS.md` changed 16 times in 14 hours: agents opened in the morning and in the afternoon read different rules, and three tool upgrades happened with worktrees open.

**Rejected:** a release for each improvement when it is found, several a day: the agents of one round would read different rules
