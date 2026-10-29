---
date: 2026-10-25
lives_in:
  - spec.md#commands
  - proposal.md#the-flow
amends:
  - 2026-10-21-one-agent-per-directory
amended_by:
  - 2026-10-25-the-look-before-a-spawn-names-only-what-its-variant-allows
---

# The orchestrator commits a change with no behavior itself when the ship would test it with the cheap gates alone

**Decision:** Before each spawn, the orchestrator looks once: a change with no behavior (its records, such as a decision, a question, a roadmap or doc line; a typo, a label, a comment) in files the ship tests with the cheap gates alone (any file when the project has no expensive gates, otherwise the files `docsOnly` matches) it commits on the integration branch itself, after the cheap gates and with no ship running. Anything else goes by a worktree; with expensive gates and no `docsOnly`, every change does, the records too.

**Why:** A change of a few lines paid a whole round: an agent's start, the data copy, every gate (Marlus, 2026-10-25). The commit passes the gates a ship would run on it, on the very commit that lands, so the integration branch still holds only commits a ship's gates passed; at the platform on 2026-10-22 a decision reached the integration branch with no gate and the next ship tested it. `docsOnly` already tells the ship which files no expensive gate tests, so the look judges no test suite. With no ship running, no ship reruns its gates for a moved branch or refuses a dirty main checkout. The main checkout is the orchestrator's own directory, so one agent per working directory holds.

**Rejected:** every record through a ship (the Records wish): a whole round for a roadmap line · the orchestrator's records alone: a typo or a comment would pay a round the ship's gates do not call for · the orchestrator judging which files an expensive gate tests: not one look, and `docsOnly` says it already · any change after the cheap gates in a project with no expensive gates: code nobody else reads, written in the context every return of `watch` rereads and outside a pane the person watches · a commit with no gate, as at the platform: the integration branch would hold a commit nothing tested
