---
date: 2026-10-25
lives_in:
  - watch.md#whom-it-speaks-for
amends:
  - 2026-10-25-one-wake
---

# A watch silences an agent only when its reader is the agent's orchestrator: its session, still running, and not orphaned

**Decision:** `watch.pid` records the Claude Code session that started the watch. `ask` and `report` leave their event to a running watch only when it speaks for the agent: not orphaned (the leader of its process group alive, nothing between them adopted by pid 1), its session still running, and the agent's orchestrator that session or no longer running; or neither with a session. Otherwise the agent's message carries the event, as with no watch. The watch returns and records only the events of the agents it speaks for, and one with no session refuses to end one whose session runs.

**Why:** By 2026-10-25 watches started with `&` had taken reports nobody read (twice here, once at the platform), recorded them delivered and exited, and the ten-minute reminders went with them: the reports waited in `status`, where nobody looks. A watch in the person's own terminal does the same. A watch is read only by the harness that runs it as its own background command, and a Claude Code session is the reader wf can name; the process-group check alone misses `&` in a shell that leads no group.

**Rejected:** Any live watch, as the one wake first had it: a watch nobody reads swallows the event. The agent's recorded session alone: after a hand-over, or for an agent spawned from a terminal, its questions would go to the person while the fresh session's watch runs. No watch without a session: another harness's orchestrator has none to record. Returning another agent's events unrecorded: a session's watch would return the same event at every restart.
