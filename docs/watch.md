---
title: Watch
group: Project
summary: How `wf watch` wakes the orchestrator once per event, and calls the person
order: 8
---

# Watch: `wf watch`

**`wf watch [--timeout ms]`**, main checkout, as the harness's own background command (in Claude Code, the Bash tool with `run_in_background`). An event is delivered once, so a watch nobody reads would swallow it:

- It refuses an output sent to `/dev/null`, and a start once orphaned: with `&`, `nohup` or `disown` in a harness's shell, the shell exits at once, so the leader of the watch's process group is gone, or pid 1 adopts the watch or `bun wf`, which runs it; a background command's shell waits for it. Both say how to run it.
- Orphaned later (it looks on each tick), it clears `watch.pid` and stops, delivering nothing: the next `ask` or `report` sends its own message.
- One watch runs per repository (`watch.pid`): a new one records itself, then ends the old one, which prints "replaced by a newer `bun wf watch` … do not start another" and exits `4`.
- It delivers only for the agents it speaks for (below).

## Whom it speaks for

`watch.pid` records the Claude Code session that started the watch (`CLAUDE_PID`, the lookup `spawn` makes for `meta.orchestrator`): the session that reads what it prints. A watch speaks for an agent when its reader is the agent's orchestrator ([why](decisions/2026-10-25-watch-speaks-for-its-orchestrator.md)):

- it is not orphaned;
- its session still runs (a `/clear` keeps the process and its background commands), and the agent's orchestrator is that session or no longer runs (a hand-over: the fresh session's watch takes the agents of the old one); or neither has a session (another harness's orchestrator, or the person running both from a terminal).

For an agent it speaks for, `ask` and `report` print no SendMessage: the watch delivers the event and records it in `watch.json`. For any other agent they act as with no watch: the agent's SendMessage carries the event to its orchestrator while that session runs, `report` calls the person, and the message's event is recorded as delivered. The watch neither returns nor records another agent's events, so a watch that speaks for it still delivers them. A watch started with `&`, or from the person's own terminal, silences no agent a session spawned.

A watch no Claude Code session started says on stderr that it wakes no Claude Code orchestrator, and how to run it. It refuses to start while a watch whose session runs is live: it would end that watch, whose orchestrator would hear not to start another.

## Events

Every 2 s it reads `herdr agent list`, the reports and the questions, keeps the agents whose `cwd` is one of this repository's linked worktrees, and returns at the first event, of an agent it speaks for, not yet in `watch.json`, in this order:

| Event | Condition | Also |
|---|---|---|
| `blocked <name>` | `agent_status` is `blocked` at a `state_change_seq` not delivered, and still at it 8 s later (`herdr agent get`): a state that goes away by itself waits on nobody | calls the person when the plugin is not installed, and says whether herdr showed the call; otherwise says the plugin calls them |
| `question <name>` | a question to the orchestrator (`wf ask`) still open (see `wf ask` in [the spec](spec.md#commands)), not delivered | prints the question and how to answer it, as the person's filter (the block's rule): SendMessage to the agent's session, or `wf tell` when none runs |
| `report <name>` | `report.md` newer than the last delivered report | — |
| `idle <name>` | `idle` or `done` at a new `state_change_seq` past `sentSeq` (a stop at it is from before the last prompt: the one a `tell` answers, or a new agent's before its task), with no report waiting and no question open (`wf ask`) | prints the last 20 lines (`herdr agent read`) and how to answer, as for a question |
| `gone <name>` | the worktree has a `meta.json` and no agent in its panes, read again before delivering: a worktree closed or shipped meanwhile is no news | — |

Only the worktrees `wf spawn` started (a `meta.json`) are watched; one made by hand shows in `status` and `doctor`.

It prints the event (the report itself for `report`, the screen for `idle`), records it as delivered, ends with "Start `bun wf watch` again in the background, then act" and exits `0`. The orchestrator starts it again before acting, so a second event during a long `ship` still wakes it; an event is never lost meanwhile, since `watch.json` keeps what was delivered.

## Turns

`wf ask` and `wf report` record the agent's `state_change_seq` while they run. The turn that ran them ends at the first stop (`idle` or `done`) past that seq, and the agent's next turn answers the question or the report, whoever started it ([why](decisions/2026-10-25-answer-by-turn.md)): any move of the agent's seq past that stop. Each look records that stop in `watch.json` (`stops`, by the seq it follows) before reading questions and reports; `status` and `ship` read the record ([why](decisions/2026-10-25-watch-records-the-stop.md)). Until a stop is recorded, the question or the report stays open: with no watch, only a report, a `wf tell` or a resume closes it.

What this reads of herdr, checked by the contract (`bun run test:herdr`):

- `state_change_seq` is one counter for the whole herdr server: every pane's change moves it. wf compares an agent's seq with an earlier one of its own and never counts on it.
- A turn moves an agent once to `working` and once to `done`. A dialog inside it shows `blocked`, before the stop.
- A session change (`/clear`; herdr's Claude integration reports the new session) leaves the seq, the agent stopped.
- An agent stopped on a question or a report waits for an answer, and the orchestrator answers after starting its watch again, so a look every 2 s sees that stop. An answer within one look of the stop (a message queued before it) goes unseen: the next stop reads as the asking turn's, the question stays open one turn more, and the ten-minute reminder calls the person.

## Calling the person

While it waits, it calls the person:

- again for an agent still blocked, or stopped on a question to the person they have not answered (`wf ask` with no orchestrator, no turn since), whose last call (`alertedAt`) is five minutes old: a herdr notification can go unseen;
- once for a question to the orchestrator still open ten minutes after it was asked: nothing waits where nobody sees it, and the orchestrator may be held in a long conversation or a ship;
- once for a report neither shipped nor answered ten minutes after it came (it waits, as `status` reads it, and no `ship` runs): the orchestrator may be held in a long conversation, or gone. The reminder lives in `watch` because it has a clock; the herdr plugin runs per event and has none. With no watch running, `wf report` calls the person itself.

With no watch speaking for the agent, `ask` and `report` record their event as delivered before the agent sends the message that carries it, so a watch started later delivers nothing for it: a message held for the person's approval reaches nobody until they approve it, and only these reminders call them about it.
