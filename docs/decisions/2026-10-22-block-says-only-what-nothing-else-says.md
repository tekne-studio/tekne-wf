---
date: 2026-10-22
lives_in:
  - proposal.md#rules-wf-s-own-block-in-agents-md
---

# wf's block holds only what nothing else the agent reads already says

**Decision:** Each line of wf's block answers what an agent would do wrong without it, in its shortest form, and no rule is said twice: a rule both blocks share lives in kb's, and what a command prints when it runs stays out.

**Why:** Every agent reads `AGENTS.md` on every turn, and in the platform's `AGENTS.md` 65% of its 4318 words were the two generated blocks (kb's about 1426, wf's 1390); trimmed, the platform's wf block went from 1390 to 874 words. Marlus, 2026-10-22: the tools stay lean, perfect, practical and fail-safe; the product is what matters.

**Rejected:** a block complete on its own beside kb's, which every agent would read twice on every turn · repeating what a command prints, which the command says at the moment it applies
