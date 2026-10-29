---
date: 2026-10-25
lives_in:
  - spec.md#commands
amends:
  - 2026-10-25-skip-the-worktree
---

# The look before a spawn names only what its variant allows, and commits only the change's files

**Decision:** The look's examples follow the variant: with expensive gates and docsOnly, records and doc lines; with no expensive gates, a typo and a comment too; a label never. The orchestrator stages only the change's files, and checks no ship runs in `wf status` and its own background commands.

**Why:** At the site (`docsOnly: **/*.md`, expensive gates) the rule named a typo, a label and a comment beside "touches only docs": a code comment is never in `**/*.md`, and a label is what a reader sees. The main checkout is where the person works too, so `git add -A` would take their edits.

**Rejected:** one list of examples for every variant: it names what the docs-only variant forbids · a label as a change with no behavior: it is what a reader sees
