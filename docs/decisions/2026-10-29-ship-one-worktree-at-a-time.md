---
date: 2026-10-29
lives_in:
  - ship.md#delivering
---

# wf ship tests each worktree on its own, until ships queue

**Decision:** `wf ship` keeps gating each worktree on its own, one after another; a batch of worktrees gated once waits until ships start to queue.

**Why:** In a round of 11 ships of a project with E2E and browser suites, each ship took about 4 minutes; none failed, restarted or waited for a place, and none overlapped (18 min or more apart), so a batch would have saved nothing. The ship runs after the agent is done, so no task waits on it; tasks wait on the agent's own test loop in its worktree (5 to 8 min per heavy task), which the project's own test setup shortens.

**Rejected:** an optimistic merge (merge after the review, one full run on the integration branch later, a hotfix worktree when red): the branch is red in between, new worktrees and merges inherit the failure, and closing the worktree drops the agent who knows the change · a batch ship (one candidate of every waiting report, gated once, fast-forwarded together): keeps the branch tested and saves time only when reports queue, for a candidate branch and a red-batch path in ship.ts; reopen it when ships queue · a config switch that skips the gates: it stays off after the busy day, and the ship is not what tasks wait on
