---
date: 2026-11-16
lives_in:
  - ship.md#delivering
---

# The project declares the main checkout's refresh after a ship: the files it watches and the command

**Decision:** refresh in wf.config.ts names globs and a command; wf ship runs it in the main checkout right after the fast-forward, under the ship lock, only when the delivery changed a file a glob matches. A queue runs it once, after its last ship. One that fails, or leaves changes in the main checkout, leaves the delivery done and the worktree closed, and prints the command to run; ship exits 1.

**Why:** wf names no package manager or build step, as prepare and close show: the project knows what a new lockfile or migration asks of its main checkout. The gates run in worktrees, so only the main checkout lags behind a delivery, and only when a watched file changed; running only then keeps every other ship as fast as it is.

**Rejected:** wf finding the package manager by its lockfile and running its install: a list of managers to keep, blind to any other step (a migration, a codegen). Running the project's prepare in the main checkout: prepare readies a worktree (its ports, its .env.local, a copy of the data) and would overwrite the main checkout's own. A warning only: the next command in the main checkout fails, as it did. A refresh after each ship of a queue: the same install again for each one, while nothing in between runs in the main checkout.
