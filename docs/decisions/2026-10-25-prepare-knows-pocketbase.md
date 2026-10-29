---
date: 2026-10-25
lives_in:
  - prepare-proposal.md#the-one-function-a-project-writes
---

# wf hands the data copy sqlite and clone, and wf init writes the PocketBase copy

**Decision:** The copy function gets sqlite (VACUUM INTO) and clone (an APFS clone); wf init writes the PocketBase body when it finds pocketbase/.

**Why:** Both projects carry the same twenty lines, the studio's projects run PocketBase, and the helpers use only Bun's built-ins. It is the one place wf learns PocketBase, a cost Marlus accepted.

**Rejected:** The helpers only, with an empty function from init: the twenty lines in each project. Neither: each project writes the whole copy.
