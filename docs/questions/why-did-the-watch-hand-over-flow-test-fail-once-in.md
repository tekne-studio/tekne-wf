---
group: open
owner: wf
unblocks: trust in the release run's test step
since: 2026-10-25
context:
  - watch.md#whom-it-speaks-for
---

# Why does the watch hand-over flow test fail now and then on GitHub's runner?

tests/flow.test.ts:447 ('with a watch running, report prints no SendMessage…') fails on GitHub's runner and passes on a rerun and locally: report prints '! the orchestrator runs no `bun wf watch`', so watcherFor returned null while the watch was running.

| Run | Commit | Where it failed | Same commit, other runs |
|---|---|---|---|
| release 40165001079, attempt 1 (2026-10-25) | c164ba4 | the first reportOnce, about 1 s in | ci 40164870152 and attempt 2 passed, and three local runs |
| ci 41679029959, attempt 1 (2026-11-03) | 6c525f9 (0.9.0) | the second reportOnce, after the hand-over to a fresh session (:460), 2.9 s in | attempt 2 and release 41679051394 passed |

Which of watcher()'s checks fails (alive, the command naming `watch`, speaksFor, orphaned) is unknown. The next failure should print them, with orphaned()'s inputs (ppid, pgid, the leader's liveness) for the watch.
