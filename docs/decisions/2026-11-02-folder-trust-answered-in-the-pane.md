---
date: 2026-11-02
lives_in:
  - spec.md#agent-kinds
  - spec.md#commands
---

# spawn waits for the person to trust each new worktree in a kind that asks per folder, reading the kind's own record

**Decision:** For a kind that asks "Trust this folder?" for every folder it never saw (Kimi, in each new worktree), `spawn` starts it, calls the person to answer in the pane, reads the kind's own record (Kimi's `workspace-trust/`) until it holds the worktree trusted, up to 10 minutes, and types the task only then.

**Why:** Kimi 2.4.1 asks in a worktree of a trusted repository, and in a subfolder of a trusted folder (checked 2026-11-02), so no check before the spawn can pass. The answer is the person's, and a typed prompt's Enter would choose Trust and continue for them. herdr may see no agent at the question, before Kimi starts a session; the record is Kimi's own answer, read only, as Claude's `~/.claude.json` is.

**Rejected:** Writing Kimi's trust record for the worktree when the main checkout is trusted, as Claude's trust carries over: it answers for the person, as writing `~/.claude.json` would. Typing the task and letting the Enter pass the question: the same answer, typed. Waiting for herdr's `blocked`: herdr may not see the agent before its session starts, and launch gives up after 60 s. Reading the question from the screen: wf parses no screen.
