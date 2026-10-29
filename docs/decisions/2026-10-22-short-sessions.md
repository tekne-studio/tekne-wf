---
date: 2026-10-22
lives_in:
  - spec.md#commands
---

# Sessions stay short: an agent's holds one task, and the orchestrator hands over after a round

**Decision:** An agent's session holds one task: a follow-up continues there, and a new task gets a new agent. The orchestrator reads narrowly and hands over to a fresh session after a round ships, with the state in `wf status`, the reports and the project's records.

**Why:** Every turn reads the whole conversation again from the cache. The platform's 44 Claude Code transcripts hold 6,180 turns that read 1.98 billion tokens, against 25 million of fresh input and output; turns above 300k tokens are 43% of the turns and 72% of what is read, and the orchestrator woke 59 times on `wf watch` carrying 495k tokens on average. kb and wf commands are about 1% of the tokens.

**Rejected:** one session per agent across tasks, or one orchestrator session for the whole day: each turn would carry everything before it
