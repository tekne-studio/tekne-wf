---
title: Roadmap
group: Project
summary: What wf changes next, in order, and the wishes for later
order: 1
---

# Roadmap

What `wf` changes next, in order: each item says when it is done and leaves the page in the commit that does it; what it built lives in `spec.md` or the doc it points to. An improvement found during a round of tasks lands here, and the list ships as one release at the end of the round, with no worktree open ([why](decisions/2026-10-22-tools-change-between-rounds.md)).

## Now

### `wf init` gives a project its worktree `prepare`

Installing wf at the platform cost most of its time in the project's `prepare`: each worktree's own data and ports, which the site wrote again (its own worktree script: a port slot per worktree, `.env.local`, links to the main checkout's `.env` and binaries, a copy of the database). `wf init` writes `wf.config.ts` and a `prepare` with the generic parts, leaving the data copy as the one function a project writes. The design is `prepare-proposal.md`, its six choices Marlus's (2026-10-25).

**Done when:** `wf init` in an empty repo writes a config and a `prepare` that `wf check` accepts, with a test.

### A review of the diff when `wf ship` runs from a worktree

Marlus's idea. Alone in a worktree, the agent ships its own work, and nobody reads the diff before the fast-forward. `wf ship` from inside a worktree starts a review of `<integration>...HEAD` first. To design: who reviews (a subagent, a review command), and whether a finding stops the ship.

**Done when:** `wf ship` from a worktree prints the review before the gates, and the design is a decision.

### `watch` can read an agent `wf resume` is starting as stopped

While `herdr agent start` brings the agent up (seconds), its meta still holds the last prompt from before, so a watch can read the starting agent as `idle` and wake the orchestrator for nothing. `resume` records the agent's state only after the start, just before its nudge. Or `resume` starts as `spawn` does since 2026-10-25 (the command line in the pane's shell, `--continue -- "<nudge>"`, then a rename), which also ends its typed nudge; unchecked against Claude Code.

**Done when:** a watch running during `wf resume` returns nothing for that agent until it stops after the nudge.

### The call names Claude Code's auto-mode box

Claude Code's "Teach auto mode about your environment?" box, on the screen of an agent that stopped, reads to herdr as `blocked`, so `wf alert` and `watch` call the person for a box that waits on nothing. "Don't show again" ends it, once per person. `wf alert` and `watch`'s blocked event name the box in the call and the answer that ends it, so the person knows it is not a permission. To design: `wf` reads herdr's JSON, never screen text, and naming the box means reading the screen. Recommended: match only the box's title in `herdr agent read`; without a match, the call stays as it is.

**Done when:** with the box on a blocked agent's screen, the call from `wf alert` and from `watch`'s blocked event names the box and "Don't show again", and a test with the fake herdr covers both.

### Shipping a wf upgrade from a main checkout on the old wf

At the platform on 2026-10-22, a task moved the project to wf 0.6.0 and added `docsOnly` to `wf.config.ts`. The main checkout still ran 0.5.0, whose config check refused the unknown field, so `wf ship` stopped before the merge; the orchestrator shipped with a copy of the 0.6.0 package. Every upgrade that adds a config field meets this.

**Done when:** `wf ship` of a worktree whose `@tekne/wf` is newer than the main checkout's either runs the worktree's version or says the one command that does, and a test covers an unknown field coming from a newer version.

## Later

### Agent kinds

- Kimi as an agent kind, one row of `src/kinds.ts`: Kimi 2.1.1 starts with `--yolo` (routine work runs; risky actions and questions ask), continues with `--continue` and needs `herdr integration install kimi`; unchecked end to end. Codex is not on this machine.

### Changelog

- An agent writes its CHANGELOG entry as a file of its own (`changes/<name>.md`), and the release folds them into the new version: every agent adding to the one `## Unreleased` section made three ships in a row stop on a conflict (2026-10-25).

### herdr

- Agents on remote machines (`herdr --machine`).
- `wf tell` finds the agent by its worktree (`agentAt`, as `status` does), in place of herdr's name: a new session in the pane (`/clear`) drops the name herdr gave the agent (seen on 2026-10-25), and `tell` then finds no live agent.
- herdr's `agent start` takes a first prompt, or accepts a `working` agent as started, and `agent get` shows whether the input box is empty or holds text (requests to herdr): `spawn` starts the agent through herdr's own start, and the typed fallback sees a held prompt without Enter as the probe ([why](decisions/2026-10-25-spawn-starts-agent-from-shell.md)).

### Watch

- `status` names the session a running watch speaks for: it says "`bun wf watch` runs (pid …)" for a watch from a terminal too, which speaks for no agent a session spawned (noticed by deafwatch, 2026-10-25).

### Calling the person

- If false calls for a blocked agent come back despite the 8 s hold, `wf alert` prints herdr's matching rule (`herdr agent explain <pane>`), unparsed, to the plugin log, so the next false blocked names its trigger.

### Review

- A reviewer separate from the author on every ship the orchestrator runs: `wf ship` opens a fresh agent with only the task file and `git diff <integration>...<worktree>`, and prints its verdict (approve, or findings with file and line) before the gates; on by diff size, so a three-line fix pays no reviewer and a round of eight fronts does. The orchestrator reads the verdict, not the whole diff. Extends the Now item on the review from a worktree (Marlus, 2026-10-26).
