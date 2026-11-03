---
date: 2026-11-04
lives_in:
  - spec.md#commands
  - spec.md#agent-kinds
---

# The orchestrator picks an agent's reasoning effort per task with wf spawn --effort, kept in the meta like the model

**Decision:** `wf spawn --effort <level>` passes the kind's effort arguments (Claude: `--effort <level>`) on the agent's start command, `meta.json` keeps the level and every later start (`resume`) reuses it. A kind whose CLI takes no effort (Kimi) has none, and `--effort` with it is refused before anything is created.

**Why:** Without it, every agent runs at the person's global Claude Code effort, the same for every task: a small docs or copy task runs at the highest effort and takes 15 to 100 minutes of model work, where a lower effort would do. The effort fits the task, as the model does, and the orchestrator is the one that sizes the task.

**Rejected:** The config's `agent.args`: they are the kind's arguments for every start of the project, so an effort there replaces the orchestrator's choice per task. The person's global `modelSettings`: one effort for every task of every project. Passing any level through to the CLI unchecked: Claude Code (2.1.311) prints a warning for an unknown level and runs at the default effort, so a typo would start a whole task at the effort the flag was meant to avoid, the warning lost in a pane.
