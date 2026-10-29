---
group: open
owner: wf
unblocks: trust in the contract's /clear assertion
since: 2026-10-25
context:
  - herdr.md
---

# Why did the contract's /clear step fail once in fourteen runs?

On 2026-10-25 one full run of `bun run test:herdr` failed on a toBe in the turn test at the /clear step (the agent not stopped, or its seq moved); five isolated runs, three under load and three full runs passed, and the output was not kept. The assertion now prints the agent's states and seqs on failure: the next failure names the cause. If /clear sometimes moves the seq, answer-by-turn reads it as a turn by whoever typed it, which the rule allows.
