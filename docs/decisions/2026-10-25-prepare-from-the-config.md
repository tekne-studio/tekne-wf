---
date: 2026-10-25
lives_in:
  - prepare-proposal.md#the-shape
---

# wf prepare builds a worktree's stack from a worktree field in wf.config.ts

**Decision:** wf prepare links, picks the slot, writes .env.local and frames the data copy from a worktree field in wf.config.ts; the project writes one function, its data copy.

**Why:** The site's script is a copy of the platform's, and what it added never reached the platform. A config field runs from the wf that calls prepare, writes .env.local before any project process starts, and lets wf check validate the slot.

**Rejected:** A script wf init generates and the project owns: the drift again in every project. A function in @tekne/wf that the project's script calls: it needs bun install before the script, and wf check cannot read its options without running it.
