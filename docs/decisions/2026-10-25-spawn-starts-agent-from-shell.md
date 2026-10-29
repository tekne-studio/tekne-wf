---
date: 2026-10-25
lives_in:
  - spec.md#commands
---

# spawn starts the agent from its pane's shell, its first prompt an argument, and names it

**Decision:** `spawn` types the agent's command line into its pane's shell (`herdr pane run`), a short prompt naming `task.md` its last argument, and names the agent herdr then sees in the pane (`herdr agent rename <pane> <name>`). An agent that has not started gets the prompt typed: Enter alone when it stays, the prompt once more when the box was empty.

**Why:** Claude Code's input box loses a prompt typed while it starts (2026-10-22 at the platform, two spawns in three at the site on 2026-10-24), and herdr's JSON does not show the box; the pane's tty keeps what reaches a shell. Every herdr call is used as herdr documents it: no timeout read as success, no screen parsed.

**Rejected:** Typing the first prompt, with Enter as the probe and a second prompt: what drops; it stays the fallback. Reading the box from `herdr agent explain --json -v` or `herdr agent read`: screen text, through a diagnostic outside the contract test. The prompt as an argument to `herdr agent start`: its start waits for an idle box, past the whole first turn, and past `--timeout` (300 s at most) answers `timeout` and forgets the name (2026-10-25); a short timeout read as started, then a rename: a timeout read as success. Waiting for herdr to show the box, or for a start that accepts `working`: a wish.
