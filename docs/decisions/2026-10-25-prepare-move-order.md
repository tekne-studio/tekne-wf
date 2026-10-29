---
date: 2026-10-25
lives_in:
  - prepare-proposal.md#moving-the-two-projects
resolves:
  - which-of-the-six-choices-in-the-prepare-proposal
---

# The site moves to wf prepare first, and the platform after a round of it

**Decision:** The site moves first; the platform moves after a round of wf prepare at the site; each move is a task in its own flow, with no worktree open.

**Why:** The site has the smaller stack and already links .env.test.local; the platform has four dev ports, a test block and seeds, where a slot error stops several agents at once.

**Rejected:** Both keep their scripts and wf prepare serves new projects: the drift between the scripts stays. Both in one round: an error at the platform stops several agents while the site's move is still new.
