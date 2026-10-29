---
date: 2026-10-21
lives_in:
  - proposal.md#the-flow
amended_by:
  - 2026-10-25-skip-the-worktree
---

# One agent per working directory, in every project

**Decision:** Each task gets its own worktree, branch and agent; never two agents in one working directory.

**Why:** kb's rules already said so. A worktree each needs no coordination, where the engine's shared checkout needed `git status`, `ListAgents` and a message naming the paths before every write.

**Rejected:** the engine's "several sessions may share one checkout" (portrait.md, gap 5)
