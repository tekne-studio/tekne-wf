---
date: 2026-11-02
lives_in:
  - spec.md#agent-kinds
  - spec.md#commands
---

# wf tell types a message to a kind with no session only while herdr reports it idle or done, and refuses otherwise

**Decision:** For an agent kind with no session channel (Kimi), `wf tell` runs `herdr agent prompt <name> <text>` once, only while herdr reports the agent `idle` or `done`, and confirms by its state that it took the message; working, blocked or unknown, it refuses, naming the state, and says to wait for the stop or type in the pane.

**Why:** Kimi has no session message, so the orchestrator could answer a Kimi agent's question only through the person. Stopped, the agent's turn is over and its box waits for the next one; working, the person may be typing their next words; blocked, the Enter would answer the dialog on screen, which is the person's. A person typing in a stopped agent's pane at that moment would see the text merge: the one risk left, rare and visible.

**Rejected:** Refusing every tell to a kind with no session: the orchestrator could not answer its questions. Typing whatever the state: lands mid-turn, or answers a dialog for the person. Checking that the input box is empty first: herdr's JSON does not show it, and wf parses no screen. Retrying a message the agent did not take, as spawn does: a retry could submit the person's half-typed text.
