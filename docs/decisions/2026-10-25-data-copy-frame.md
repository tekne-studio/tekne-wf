---
date: 2026-10-25
lives_in:
  - prepare-proposal.md#what-wf-prepare-runs
---

# wf owns the frame of a worktree's data copy, and the project writes the copy

**Decision:** wf decides when to copy, refuses while a port of the slot answers, hands an empty folder and swaps it in when the project's function returns; a throw keeps the previous data.

**Why:** The frame is the same line for line in both projects, and keeping the old data when a copy fails halfway is the part a new project would forget.

**Rejected:** The project's command does it all, with WF_MAIN and WF_REFRESH in its environment: each project writes the frame again.
