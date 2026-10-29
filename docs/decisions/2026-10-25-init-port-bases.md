---
date: 2026-10-25
lives_in:
  - prepare-proposal.md#what-wf-init-writes
---

# wf init writes fixed port bases, and the person moves them

**Decision:** wf init writes default bases (web 5400, pb 8400) with why in a comment; the person moves them when two projects share a machine.

**Why:** The slot probe already skips a slot whose port answers, and two projects with a stack share a machine today.

**Rejected:** A machine registry in WF_STATE_DIR that init reads to pick free bases and doctor reads to warn on overlap: worth it when a third project with a stack shares the machine.
