---
date: 2026-10-25
lives_in:
  - watch.md#turns
amends:
  - 2026-10-25-answer-by-turn
---

# A question's or a report's turn ends at the first stop the watch sees past its seq, and the next turn is the agent's seq past that stop

**Decision:** The watch records in `watch.json` the first `idle` or `done` it sees at a `state_change_seq` past the one `wf ask` or `wf report` recorded: the turn that asked or reported ended there. The question or the report is answered once the agent's seq moves past that stop; `status` and `ship` read the same record. With no stop recorded it stays open, and a report, a `wf tell` or a resume still close it.

**Why:** herdr's `state_change_seq` is one counter for the whole server (the contract shows another pane's change between an agent's own), so `seq + 1` was any agent's change: every question and report read as answered at its own stop once another agent moved, and a dialog inside the asking turn (blocked, approved, working) read as an answer too. A turn moves an agent once to working and once to done, and a session change leaves the seq, so the agent's own stop is the mark that holds; an agent stopped on its question waits there, and the orchestrator answers after starting its watch again, so a look every 2 s sees it.

**Rejected:** `seq + 1` kept for when no watch runs: with one counter for every pane it closes each question at its own stop. herdr's `completion_seq`: it marks only the stop the agent is at and is null while it works, so it cannot tell the asking turn's stop from a later one. `status` and `ship` recording the stop too: a second writer of `watch.json`, and a look long after the stop records a later one. The herdr plugin recording every stop: exact, but optional, and a `wf` run on every stop of every agent.
