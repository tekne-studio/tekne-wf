---
date: 2026-10-25
lives_in:
  - prepare-proposal.md#what-wf-init-writes
---

# wf init gives a repository a web port only when package.json has a dev script

**Decision:** With no stack found, wf init writes the web port, APP_URL and look only when package.json has a dev script; otherwise no worktree field.

**Why:** A dev server on a fixed port is the first thing two worktrees fight over, and a repository with no dev server would get a URL nobody serves.

**Rejected:** The web port always: a URL nobody serves. Never: two worktrees' dev servers fight over one port.
