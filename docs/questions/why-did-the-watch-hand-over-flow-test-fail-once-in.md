---
group: open
owner: wf
unblocks: trust in the release run's test step
since: 2026-10-25
context:
  - watch.md#whom-it-speaks-for
---

# Why did the watch hand-over flow test fail once in the release run?

tests/flow.test.ts:447 ('with a watch running, report prints no SendMessage…'): the first reportOnce saw '! the orchestrator runs no `bun wf watch`' about 1 s in, so watcherFor returned null or the watch had already cleared watch.pid (a first-tick orphaned() true would do both). Release run 40165001079 attempt 1 on c164ba4 failed there; ci run 40164870152 on the same commit and attempt 2 passed, as did three local runs. The next failure should print orphaned()'s inputs (ppid, pgid, the leader's liveness) for the watch and for report.
