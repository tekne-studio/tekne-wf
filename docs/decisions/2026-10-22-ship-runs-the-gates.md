---
date: 2026-10-22
lives_in:
  - ship.md#the-gates
  - proposal.md#configuration-wf-config-ts
---

# `wf ship` runs the gates; the orchestrator's review adds what they cannot

**Decision:** `wf ship` runs every gate, the cheap first, and stops at the first that fails; the orchestrator never reruns them, and its review reads the diff (whole when small, by parts when large) and looks at what changed on screen. The report fits the change.

**Why:** In the two-line fix of [small fixes in batches](2026-10-22-small-fixes-in-batches.md), the orchestrator reran the four cheap gates the agent had just run, and `wf ship` ran them all again with the full suites (3m10s): about 10 minutes for a two-line fix, none of them Marlus's.

**Rejected:** a proportional review that keeps the reruns for big diffs: the ship reruns them anyway
