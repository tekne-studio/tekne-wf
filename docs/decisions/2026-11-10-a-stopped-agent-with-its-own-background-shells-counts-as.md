---
date: 2026-11-10
lives_in:
  - watch.md#background-shells
---

# A stopped agent with its own background shells counts as working, for ten minutes at most

**Decision:** An agent herdr reports stopped counts as working while processes under it run outside its process group, up to ten minutes from the watch's first look at that stop; past that, watch tells the stop and names them.

**Why:** Claude Code resumes an agent by itself when a background shell ends, so each such stop woke the orchestrator for nothing. A process group is what the system already keeps for this: Claude Code gives each background command its own, and its own helpers stay in the agent's. A dev server the agent forgot lives for ever, so the rule needs an end.

**Rejected:** Reading Claude Code's "2 shells still running" off the screen: a screen is shown, never parsed, and the wording is Claude Code's to change. Counting every child of the agent: caffeinate and stdio MCP servers run as long as it does, so no agent would ever stop. Measuring the cap by the shell's age: a long build or a dev server started early in the turn would be past it the moment the agent stops, and the false alarm comes back. No cap: a forgotten shell hides a stopped agent for ever.
