---
date: 2026-10-26
lives_in:
  - spec.md#commands
---

# The block in AGENTS.md says only what every agent needs; wf --skill prints each role's rules for the checkout it runs in

**Decision:** templates/rules.md renders under 300 words: one orchestrator, one worktree and agent per task, never merge, push or close from inside a worktree, send the SendMessage a command prints, herdr --skill, and the pointer to `bun wf --skill`. The flag prints templates/agent.md in a worktree and templates/orchestrator.md in the main checkout (`--all` both), rendered from the project's config, and the task header carries the agent's rules once.

**Why:** At the site, the block was about 1000 of AGENTS.md's 2900 words, read at every turn of every session, and a session plays one role at most: the orchestrator paid the agent's rules at every return of wf watch, and each agent paid the orchestrator's. A flag mirrors herdr --skill: the tool prints its own instructions, outside the flow's verbs.

**Rejected:** The whole rules in the block (every role read at every turn by sessions that play one). `wf skill` as a command: it would sit among the flow's verbs in the help and in the rules, when it is the tool's own instructions, as herdr's --skill and --help are. The header pointing to `bun wf --skill` without the agent's rules: one more turn before the task, for a text read once.
