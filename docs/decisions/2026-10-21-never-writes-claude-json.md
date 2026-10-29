---
date: 2026-10-21
lives_in:
  - proposal.md#trust-in-a-new-folder
---

# wf never writes `~/.claude.json`: trusting a repository stays the person's

**Decision:** `wf` reads Claude Code's trust for the main checkout and stops `spawn` when it is missing, asking the person to open Claude once there; it never answers the trust dialog and never writes `~/.claude.json`.

**Why:** Trust is one click of the person's, once per repository: Claude Code keys a worktree's trust on its main checkout.

**Rejected:** `wf` accepting the trust itself (writing `hasTrustDialogAccepted`, or pressing the dialog) to spare that click: it would answer for the person
