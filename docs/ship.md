---
title: Ship
group: Project
summary: "How `wf ship` tests and delivers a worktree: the gates, the queue, the refusals"
order: 7
---

# Ship: `wf ship`

## The gates

The full suites belong to the ship. The agent's rules (`wf --skill` in its worktree) tell it to run the cheap gates in its worktree and, of the expensive ones (when the config has any), only the test files it touched, and to commit as it goes: a commit is a checkpoint, and `ship` tests the tip, the commit that reaches the integration branch. `ship` runs the gates in proportion to the diff, one ship at a time: every gate, the cheap first, stopping at the first that fails; the cheap alone when every changed file matches `docsOnly`. So the orchestrator never reruns the gates: its review adds what they cannot, the diff (whole when small; `--stat` first, then one file at a time, when large) and what changed on screen. A test that fails with no cause in the change goes to quarantine, never three reruns, and only with proof: it fails on the integration branch without the change too, or passes alone and fails only under load. The orchestrator then tells the agent to skip it, and the agent names it as an open question in its report, with the proof. A test that fails only with the change is a bug to fix.

## Delivering

**`wf ship [<name>…] [--reported] [--dry-run]`**, in the worktree, or in the main checkout with names. It runs the gates `cheap` then `expensive`, stopping at the first that fails, under the lock `ship.lock`. It runs `prepare` after each merge under `prepare.lock`, as `wf prepare` does, so a `bun install` never races another in the worktree. From the main checkout, it also refuses while the worktree's agent is `working`. Never pushes.

- **In proportion to the diff.** After the merge, when every file in `<integration>...HEAD` (`--no-renames`, so a rename counts both paths) matches a glob of `docsOnly`, the expensive gates stay out and `ship` says so, naming the globs and the gates left out. An empty or missing `docsOnly`, a diff with no file, or one file outside the globs runs every gate.
- **A queue.** Several names, or `--reported` (every worktree whose report waits, the oldest first; with herdr not listing its agents, every report reads as waiting, and it says so), ship one after another, each bringing in what the one before delivered. A refusal stays behind and the others go on; a summary at the end names each one's outcome, and the exit is `1` when any failed.
- **Expensive gates take one of the machine's places**: `WF_GATE_SLOTS`, or a quarter of the cores, shared by every repository (their worktrees share one CPU). Cheap gates run freely. Once it holds a place, a ship whose integration branch moved meanwhile brings it in before spending the gate.
- **Each gate (and `prepare`) runs in a process group of its own**: interrupting `ship` (SIGINT, SIGTERM, SIGHUP) sends SIGTERM to the whole group, so a test stack's servers end with it and a runner such as Playwright stops what it started.
- **A main checkout with changes** gets five seconds to settle (a build's temporary files) before `ship` refuses, naming the files.
- **An agent that just reported** gets until a minute after its report to end its turn: when the agent is `working` and its last event is its report (newer than its last prompt and its last question, and no turn since: it is still in the turn that reported), `ship` looks at it again each second and goes on once it stops; still `working` a minute after the report, it refuses, naming the report's age. The report is the agent's last command, and its closing message ends the turn seconds later; a minute after it, an agent still working is on something else (the person in its pane), which a ship must not cut. The minute counts from the report, so a ship long after one waits for nothing.
- **Closing** stops every process still running inside the worktree first: found by their folder (`/proc` on Linux, `lsof` elsewhere), orphans with PPID 1 included; SIGTERM, then SIGKILL after five seconds, and again for one that started meanwhile. It spares itself, its parents (`ship` run alone, in the worktree's own pane) and the panes' shells (`herdr pane process-info`), which herdr ends with the workspace. Then it finds the workspace by path in `herdr worktree list` and runs `herdr worktree remove --workspace <id>`; with no workspace, `git worktree remove`.
