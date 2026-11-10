---
date: 2026-11-10
lives_in:
  - ship.md#delivering
---

# A close that fails keeps the worktree, on its branch, unless wf close --force

**Decision:** When the config's close fails, the worktree stays and wf prints the command to run and the one that closes it; wf close --force prints the failure and removes the worktree anyway. wf ship runs close after the fast-forward and before deleting the branch, so a failure leaves the delivery done and the worktree on its branch.

**Why:** The folder is what running close again needs: once it is gone, what prepare brought up keeps running with nothing left to take it down, and the only trace is a line in a log. Kept, the cost is one folder and one command. wf close finds a worktree by its branch, so the branch has to outlive a close that failed.

**Rejected:** Printing the failure and removing anyway: the orphaned containers close exists to end, now silent. Running close after the branch is deleted, the step just before the removal: the worktree is detached by then, wf close cannot find it, and a close that reads the branch reads nothing. Running close before the fast-forward: the integration branch moving at the last moment sends ship back to the gates, which need what close took down.
