---
date: 2026-10-21
lives_in:
  - proposal.md#distribution
---

# wf is its own repository and package, apart from kb

**Decision:** `@tekne/wf` lives in `tekne-wf` and writes its own block in `AGENTS.md`; a project uses it with or without kb.

**Why:** A project takes the flow without kb, or kb without the flow, and each tool touches only its own markers in `AGENTS.md`; decisions, questions and docs stay kb's.

**Rejected:** the flow inside kb, as kb's `worktrees` module held it: a project would need kb to get the flow
