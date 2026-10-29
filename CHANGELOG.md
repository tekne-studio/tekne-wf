# Changelog

Versions follow semver; the commit type is the bump (`feat` minor, `fix`
patch, a breaking change minor while below 1.0). Entries are distilled from
the commits.

## 0.8.1

The package's docs, decisions and code comments describe the projects wf runs in by their shape and name none of them. Nothing else changes, and upgrading needs no step.

## 0.8.0

The rules block in `AGENTS.md` keeps only what every agent needs at every turn; `wf --skill` prints the rest for the role the checkout plays, and the project section of `AGENTS.md` becomes the orchestrator's.

### Upgrading

- After upgrading, `bun wf gen`: the rules block changed, and `bun wf check` fails until it is rewritten.

### Added

- `wf --skill [--all]` prints the rules of the role the checkout plays, rendered from the project's config: the agent's in a worktree, the orchestrator's in the main checkout, both with `--all`. The block in `AGENTS.md` keeps only what every agent needs at every turn, under 300 words, and points to it; the task header carries the agent's rules once.
- The rules make the project section of `AGENTS.md` the orchestrator's: only it writes there, from an agent's proposal or the person's words, one line per rule linking the doc section that explains it; the agent updates the topic doc in the commit of the change and proposes a rule in its report; a task file names the doc sections the agent reads, so the agent needs no more than `AGENTS.md` and them.

## 0.7.0

One wake per event: each report and question reaches the orchestrator once and closes on the agent's next turn, whoever answered; spawn hands the agent its task on its command line; ship's gates read the worktree's own env files; and the orchestrator commits its own records without a worktree.

### Upgrading

- After upgrading, `bun wf gen`: the rules block changed, and `bun wf check` fails until it is rewritten.
- Upgrade with no worktree open: the state changed (`report.md` carries the agent's seq; `ask` and `report` write `watch.json`, where the watch records the stop that ends each question's and report's turn).

### Added

- The rules give the orchestrator one look before each spawn: a change with no behavior that the ship would test with the cheap gates alone (its records and doc lines; with no expensive gates, a typo or a comment too), it commits on the integration branch itself, staging only its files, after those gates and with no ship running; anything else goes by a worktree.

### Fixed

- The agent's next turn answers its question or its report, whoever started it: a SendMessage straight to the agent, or the person typing in its pane, closes it, so `status` stops asking for the answer and nobody calls the person about it ten minutes later. The turn counts from the stop the watch sees after the question or the report: a dialog inside the asking turn, another agent's change (herdr's seq is one counter for every pane) and a `/clear` answer nothing, and with no watch the question stays open until a report, a `wf tell` or a resume. The rules have the orchestrator answer by SendMessage to the agent's name, with `wf tell` when that name misses its session, and `watch`, `ask` and the refusals of `ship` (an agent still working) and `resume` (an agent live) name that SendMessage.
- The orchestrator wakes once per report and per question: with a `bun wf watch` running, `ask` and `report` print no SendMessage and the watch delivers the event; with none, the agent's message carries it whole (the question, the report's path), and a watch started after it does not deliver it again.
- A watch nobody reads silences no agent: `ask` and `report` leave their event only to the watch of the agent's orchestrator, its Claude Code session still running and the watch not orphaned. A watch started with `&` (adopted by pid 1) stops at its next look, and one from a terminal delivers nothing of a session's agents and refuses to end the orchestrator's: the agent's message carries the event, and `report` calls the person, as with no watch.
- `ship`'s gates read the worktree's `.env` files: wf runs Bun with `--no-env-file`, so the main checkout's `.env` stays out of every command.
- `ship` right after a report waits, up to a minute after the report, for the agent's turn to end, instead of refusing it as working.
- `spawn` starts the agent from its pane's shell with its first prompt as an argument, and names it: the task reaches the agent with its command line, not through Claude Code's input box, which can lose a prompt typed while it starts. An agent that did not start on it gets it typed into the box, where it can still be lost.
- `resume` sends a nudge lost whole once more: when Enter alone does not start the agent, the box was empty.
- `wf ask -` reads the question from stdin.
- A release turns `## Unreleased` into the new version's entry, instead of leaving it below; with none, it drafts the entry from the commits.
- `ship` runs `prepare` under the prepare lock, as `wf prepare` does, so the two never prepare the same worktree at once.
- `ship --reported` says so when herdr does not list its agents: every report then reads as waiting, an answered one too.
- `bun test` with no path runs `tests/` alone (`bunfig.toml`), so a run from a herdr pane leaves `contract/` out; `bun run test:herdr` runs the contract.
- CI and the release install `@tekne/kb` with the registry token: they write it to `$XDG_CONFIG_HOME/.npmrc` as well as `$HOME/.npmrc`, since Bun 1.3.14 reads only the first when GitHub's Ubuntu runner sets `XDG_CONFIG_HOME`.

## 0.6.0

Lean and truthful: the rules block is 37% shorter, what wf prints says only the action, the ship costs what the diff needs, and wf never says it called the person when it did not.

### Added

- `docsOnly` in the config: a diff whose every file matches ships with the cheap gates alone, and the ship says why.
- The rules: commits are checkpoints and the ship tests the tip; a wf or kb upgrade waits until a round ships; a tool's improvements go to its roadmap for one release at the round's end; a decision needs a plausible alternative (kb's criterion when kb is present).
- `docs/roadmap.md`, the home of wf's improvements.

### Changed

- The rules block holds only what nothing else the agent reads already says: 1390 to 874 words in a project with kb.
- The task header, watch's question and report events, its foot and spawn's next step say only the action (the header from about 110 words to about 20).

### Fixed

- Watch no longer reads a stop from before the first prompt as idle, after spawn or resume.
- A closed worktree no longer reads as gone.
- spawn, report, ask, alert and watch say the person was called only when herdr showed the notification, and say why when it did not.
- A blocked state that goes away by itself within 8 s calls nobody.

## 0.5.0

Process in proportion to the change: small fixes travel together, and the orchestrator's review adds what the gates cannot.

### Added

- The rules batch small fixes into one task: 2 to 4 fixes whose cause and place are known, touching no business rule and nothing the project's own section marks as sensitive, one commit each and one report. A fix that turns out bigger leaves the batch by `wf ask`.
- The orchestrator's review is the diff and the screens; the gates belong to `wf ship`, which runs the cheap ones first and stops at the first that fails. Watch's report footer says so.
- The report fits the change: a small change gets a short one, and a section with nothing to say is left out.

### Changed

- A fresh orchestrator session takes over after a round of tasks ships.

## 0.4.0

Sessions stay short: each turn reads the whole conversation again, so the rules keep what a session holds small and put the state in the repository.

### Added

- The rules: an agent's session holds one task; a new task, whoever brings it, gets its own worktree and agent.
- The rules: the orchestrator reads a report and its diff narrowly (`--stat` first, then one file), and hands over to a fresh session after a batch ships or once the session has grown long, with the state in `wf status`, the reports and the project's records.
- Decision 8 in docs/proposal.md: why sessions stay short, with the measured cost.

### Fixed

- After a hand-over, report says the watch running for the repository delivers it, not the session that started the agent.

## 0.3.0

The orchestrator leads the agents and is the person's filter: questions and reports reach it by message, never by typing into a pane, and the person is called only for what is theirs.

### Added

- `wf ask`: an agent's question goes to the orchestrator (the message ask prints, and a `question` event from watch); the person is called once when it stays unanswered ten minutes. With no orchestrator, ask calls the person.
- The report reaches the orchestrator: spawn records its session, report prints the message that carries it, and with no watch running it calls the person.
- The rules: the orchestrator opens the agents, answers their questions from what exists, records the decision and tells the person; the agent asks with `wf ask`, never with a dialog on screen.
- The rules: the full suites belong to the ship, and an agent runs the cheap gates and only the tests it touched; a test goes to quarantine only with proof that it fails on the integration branch too, or only under load.
- Spawn and resume start a claude agent without AskUserQuestion and EnterPlanMode, whose dialogs only the person can answer.
- Ship delivers several worktrees one after another; expensive gates take one of the machine's places (`WF_GATE_SLOTS`), each gate in its own process group.
- `wf spawn --model` passes the model to the agent, and resume keeps it.
- Status says the next action per worktree; status and doctor say whether a watch runs and which reports wait to ship.
- Watch runs once per repository and refuses a discarded or detached output.

### Fixed

- Tell never types into an agent's pane: it prints the SendMessage that carries the message to the agent's Claude Code session, and refuses when there is none.
- Spawn and resume prove the agent took its first prompt, press Enter once when it sits in the input box, and show the pane when it still has not started.
- Watch never returns as idle the stop a tell answered.
- Close and ship stop every process still running in the worktree before removing it.
- Resume starts the agent with the config's agent args, as spawn does.
- Ship looks again for five seconds at a main checkout with changes before refusing, and names them.
- `wf init` in a worktree titles AGENTS.md with the repository's name, not the worktree's folder.

## 0.2.0

Every worktree has an agent the person can watch: the rules say so, and wf shows a worktree that has none.

### Added

- The rules say every worktree is born from `wf spawn`, tool upgrades included (another tool's handoff becomes the task file), and the orchestrator never opens a worktree by hand or edits in one: it reads, checks and ships.
- `wf status` and `wf doctor` mark a worktree with no agent, with `wf resume` or `wf close` as the way back.

## 0.1.1

What the first project to adopt wf ran into.

### Fixed

- `wf init` runs in a worktree too, where a project adopts wf before shipping it, and takes the main checkout's branch as the integration branch.
- `wf doctor`, `wf spawn` and `wf watch` see the installed herdr plugin; `watch` no longer calls the person a second time for a blocked agent the plugin already called them for.
- The package carries `docs/proposal.md` and `docs/spec.md`, which the README points to.

## 0.1.0

The first version: one orchestrator, a Claude Code session in the main checkout, runs agents in herdr worktrees where the person sees them, and the person is called only for what is theirs.

### Added

- `wf spawn`: worktree, preparation, agent and task in one step; stops before acting when Claude Code has not trusted the repository.
- `wf watch`: the first thing to act on (blocked, report, idle, gone), each told once; calls the person again every five minutes while an agent stays blocked.
- `wf report`, `wf tell`, `wf status`, `wf resume` and `wf close`.
- `wf ship`: brings the integration branch in, prepares, runs the gates, fast-forwards the tested commit under the repository's lock and closes the worktree by path; never pushes.
- `wf prepare` and the herdr plugin `tekne.wf`: prepares each new worktree, and calls the person the moment an agent blocks.
- `wf gen` and `wf check`: the rules block in AGENTS.md, rendered with the project's config.
- `wf init` and `wf doctor`.
