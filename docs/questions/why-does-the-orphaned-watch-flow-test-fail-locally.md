---
group: open
owner: wf
unblocks: a ship of wf whose bun run test passes every time
since: 2026-10-29
context:
  - watch.md#whom-it-speaks-for
---

# Why does the orphaned-watch flow test fail locally?

tests/flow.test.ts:518 ('a watch orphaned while it runs clears its record and stops without delivering…') fails at :527, expect(existsSync(pid)).toBe(true): the watch never writes watch.pid within 10 s. On 2026-10-29, run alone with bun test tests/flow.test.ts -t 'a watch orphaned while it runs', it failed 5 of 5 on the anonimizar worktree's tip and 2 of 3 on main at edc1606, inside an agent's Bash tool; the full suite failed it 2 of 4. It reproduces locally, unlike why-did-the-watch-hand-over-flow-test-fail-once-in, and likely sits in the orphan check at the watch's start.
