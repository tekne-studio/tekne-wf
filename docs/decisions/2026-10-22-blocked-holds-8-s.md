---
date: 2026-10-22
lives_in:
  - spec.md#commands
  - watch.md#events
  - proposal.md#watching-and-calling-the-person
---

# A blocked agent calls the person only once it holds 8 s

**Decision:** `wf alert` and `watch`'s blocked event call only when the agent is still `blocked` at the same `state_change_seq` 8 s later; a real dialog calls about 8 s late.

**Why:** At the platform on 2026-10-21/22, the false calls came from a blocked state that went away by itself within seconds, likely auto mode answering a permission dialog. Claude Code's "Heads up" notice box was not the cause: herdr reads a screen with one as `working`, or `idle` once the turn ends.

**Rejected:** turning the notice off for agents (`--settings`), which would not stop the false call and takes away notices Marlus keeps on · a request to herdr, with no grounds since the box matches none of its rules · logging herdr's matching rule, which waits on the roadmap's Later in case false calls return
