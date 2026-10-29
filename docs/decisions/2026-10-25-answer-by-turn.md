---
date: 2026-10-25
lives_in:
  - spec.md#commands
  - proposal.md#how-the-orchestrator-and-the-agents-talk
amended_by:
  - 2026-10-25-watch-records-the-stop
---

# The agent's next turn answers its question or its report, whoever started it; the orchestrator answers by SendMessage to the agent's name

**Decision:** A question (`wf ask`) or a report (`wf report`) stays open until the agent takes a turn after the stop that followed it: herdr shows its `state_change_seq` past the one `ask` or `report` recorded plus one, and the agent not `blocked`. A report, a `wf tell` or a resume closes it too. The rules have the orchestrator answer by SendMessage to the agent's name, with `wf tell` when that name misses the agent's session.

**Why:** On 2026-10-25 the orchestrator answered agents by SendMessage straight to their names to save `wf tell`'s step, and the state kept each question open: `status` said to answer it, and ten minutes later the person would be called about a question already answered. An answer the person types in the pane drifts the same way, and the rules tell agents to follow the person there. The turn shows whoever answered, and `unanswered` already read a question to the person this way. A turn nobody started (a background command finishing) reads as an answer and costs a later `idle` event with the screen.

**Rejected:** `tell` as the one way, the rules saying why, its SendMessage sent in the same response: drift comes back with every bypass and with every answer the person types in the pane. A Claude Code hook on SendMessage that records the answer: exact and one step, but wf would write each project's `.claude/settings.json`, a new install surface tied to one harness.
