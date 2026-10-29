---
date: 2026-10-22
lives_in:
  - ship.md#the-gates
  - ship.md#delivering
  - proposal.md#configuration-wf-config-ts
---

# The ship runs in proportion to the diff and tests the tip

**Decision:** A delivery whose every file matches `docsOnly` runs the cheap gates alone, and `wf ship` says why; empty or missing, every gate runs. A commit is a checkpoint, and `wf ship` tests the tip, the commit that reaches the integration branch.

**Why:** The platform's review of 2026-10-21/22 (28 units, 57 commits): 14 commits changed only docs (about 237 doc lines, 3 code lines) and each paid the full E2E and browser suites, about 3 minutes. "Commit each green step" was a promise nobody checked: the ship tests only the tip, and two commits in the range are red on their own.

**Rejected:** a full suite on every commit, at about 3 minutes per commit · the cheap gates on each commit before the tip, in a temporary worktree: machinery (a worktree, a prepare, a cache, a cleanup after a crash) bought for `git bisect` on intermediate commits, which nobody here uses, and one more thing that can fail; Marlus wants the tools lean and fail-safe
