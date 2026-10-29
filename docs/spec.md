---
title: Spec
group: Project
summary: Each command, the config, the state and the tests
order: 4
---

# Spec: wf

What `wf` does, command by command, built from `proposal.md`. The texts agents read are files: `templates/rules.md` (the `AGENTS.md` block), `templates/agent.md` and `templates/orchestrator.md` (each role's rules, printed by `wf --skill` and, the agent's, carried by the task header) and `templates/header.md` (the task header).

## Package

`@tekne/wf`, bin `wf` → `src/cli.ts`, run by Bun from TypeScript, as `@tekne/kb` does. A project adds it as a devDependency and a script `"wf": "wf"`, so every agent types `bun wf <command>`. No runtime dependencies.

The bin's shebang runs Bun with `--no-env-file` ([why](decisions/2026-10-25-wf-loads-no-env-file.md)): wf reads its config from `wf.config.ts`, never from `.env`, so it runs `prepare` and the gates with the environment it was started with, and each gate's own Bun loads the worktree's `.env` files (Bun never overrides a variable already set). A variable for wf itself, such as `WF_GATE_SLOTS`, goes in the shell. `bun wf` (the script runs the bin), the bin and `bunx` go through the shebang; wf's own repository runs `src/cli.ts` the same way, from its script and the plugin. `bun <path>/src/cli.ts` skips the shebang and loads the folder's `.env`.

| File | Holds |
|---|---|
| `src/cli.ts` | argument parsing, help, exit codes |
| `src/herdr.ts` | the adapter: the only file that runs `herdr` |
| `src/git.ts` | `checkouts()` (main checkout, git common dir) and worktrees by branch |
| `src/lock.ts` | the repository's locks (`lock()`) and the machine's places for expensive gates (`slot()`) |
| `src/procs.ts` | the processes running inside a worktree, found by their folder, and stopping them |
| `src/context.ts` | where a command runs (main checkout, worktree) and `WfError` |
| `src/config.ts` | `defineConfig`, the `Config` type, loading and validation |
| `src/state.ts` | names, paths and the `wf` folder in the git common dir |
| `src/kinds.ts` | what each agent kind needs to start and continue |
| `src/claude.ts` | reading Claude Code's records: its trust in a folder, its live sessions |
| `src/template.ts`, `src/rules.ts`, `src/header.ts` | rendering `templates/`: the block, each role, the header; `gen`, `check` and `--skill` |
| `src/ship.ts` | delivering a worktree to the integration branch; closing a worktree by path |
| `src/watch.ts` | event selection over herdr's agent list, the reports and the questions; reminders; the next action per worktree |
| `src/worktrees.ts` | the agent in each linked worktree, matched by its folder; the watch, the questions and the reports waiting, for `status` and `doctor` |
| `src/commands/` | the commands: `spawn`, `watch`, `ship`, `prepare`, `rules` (`gen`, `check`), `agents` (`tell`, `report`, `ask`, `resume`, `close`, `status`), `setup` (`init`, `doctor`), `alert` |
| `herdr/` | the herdr plugin (`herdr-plugin.toml`, `plugin.ts`) |
| `tests/` | unit, ship and flow tests, with the fake herdr (`tests/fake-herdr.ts`, through `HERDR_BIN_PATH`) |
| `contract/` | the contract with the installed herdr |

Exit codes: `0` done, `1` refused or failed (the message says what to do), `2` usage error, `3` `wf watch` timed out with nothing to report, `4` a newer `wf watch` replaced this one (its owner does not start it again).

## Configuration

`wf.config.ts` at the repository root, read from the checkout the command acts on (in a worktree, the branch's own version). `wf init` writes it with a type-only import (`import type { Config }` and `satisfies Config`), so it loads before `@tekne/wf` is installed.

```ts
type Config = {
	integration: string; // the branch the main checkout stays on
	prepare?: string; // idempotent shell command, run in the worktree
	gates?: { cheap?: string[]; expensive?: string[] }; // shell commands, in order
	docsOnly?: string[]; // globs: a delivery whose every file matches runs only the cheap gates
	look?: { file: string; keys: string[] }; // where the URLs for the person are, after prepare
	agent?: { kind?: 'claude'; args?: string[] }; // args replace the kind's defaults
	header?: string; // project lines for the task header
	agentsFile?: string; // default 'AGENTS.md'
};
```

Validation fails with the field and the reason; unknown fields are errors.

## Names, places and state

- A name matches `[a-z][a-z0-9_-]{0,31}` (herdr's agent names). It is the herdr label, the agent's name and the branch `worktree/<name>`.
- Path: `~/.herdr/worktrees/<basename of the main checkout>/worktree-<name>`, herdr's own convention; `WF_WORKTREES_DIR` moves the root (the tests use it).
- In a worktree, the name comes from the branch `worktree/<name>`; another branch is refused.
- State lives in `<git common dir>/wf/`, which the main checkout and every worktree see, outside the tracked tree:

| Path | Holds | Written by |
|---|---|---|
| `<name>/meta.json` | kind, model, workspace, pane, `spawnedAt`, `sentAt` (the last prompt or `tell`), `sentSeq` (the agent's `state_change_seq` when the last prompt went: the task, a `tell`, a resume), `alertedAt` (the last call to the person, shown or not), `orchestrator` (the Claude Code session that ran `spawn`: name, sessionId, pid) | `spawn`, `tell`, `resume`, `alert`, `ask`, `watch` |
| `<name>/task.md` | the header and task as sent | `spawn` |
| `<name>/report.md` | the latest report, with its time, `HEAD` and the agent's `state_change_seq` at the top | `report` |
| `<name>/question.json` | the agent's last question, its time, the agent's `state_change_seq` then, and whom it went to (`orchestrator` or `person`) | `ask` |
| `<name>/ship.pid` | the pid of the `ship` delivering it now | `ship` |
| `watch.json` | events already delivered, the report and the question the person was reminded of, and the stop that ended the turn of each question and report (`stops`) | `watch`; `report` and `ask` when their message carries the event |
| `watch.pid` | the running watch: pid, start time and `orchestrator` (the Claude Code session that started it, which reads it: name, sessionId, pid) | `watch` |
| `prepare.lock` | the pid running `prepare` and what for; a dead pid's lock is discarded | `prepare`, `ship` |
| `ship.lock` | the pid fast-forwarding the integration branch and what for; a dead pid's lock is discarded | `ship` |

`ship` and `close` remove `<name>/` before they close the worktree: its agent ends first, and meanwhile a watch would read it as gone.

The machine's own state lives in `WF_STATE_DIR` (default `~/.local/state/wf`), shared by every repository: `expensive-gate-<i>.lock`, one per place for an expensive gate, with its holder's pid and repository, worktree and gate.

## Commands

The orchestrator leads the agents: it opens them without asking the person, answers them, ships their work and tells the person; the person watches the panes and may step in. It is the person's filter: an agent's question goes to it (`wf ask`), it answers what the decisions, the docs and the person's earlier choices settle, answers the agent by SendMessage to its name (`wf tell` when that misses its session) and tells the person what it decided and why. It records a decision (`kb decision new` in a project with kb) only when the choice had a plausible alternative someone would propose again, and Rejected names it; without one, the why goes in a code comment or the topic doc. It brings the person only a product question nothing settles, a permission, a push or a publish, or anything destructive or outward, and relays the answer. A dialog on an agent's screen (a permission) stays the person's: the orchestrator never presses it, nor types in the pane.

Tools change between rounds. The orchestrator's rules say a wf or kb upgrade waits until a round ships and no worktree is open, so every agent of a round reads the same rules; an improvement to a tool found during a round goes to that tool's roadmap (wf's is `docs/roadmap.md`), for one release at the end of the round, never several a day.

Every worktree is born from `wf spawn`, with an agent in its pane the person can watch. The orchestrator's rules say so: the orchestrator never opens a worktree by hand or edits in one, and a handoff from another tool (such as kb's upgrade steps) becomes the task file. `status` and `doctor` mark a worktree with no agent.

The project section of `AGENTS.md` is the orchestrator's: the one text every task file says to read first, so the one place an agent is sure the next one reads, and where every agent would add its paragraph. The orchestrator's rules say only it writes there, from an agent's proposal or the person's words, one line per rule linking the doc section that explains it; the agent updates the topic doc of what it changes in the commit of the change, and a rule it thinks the section needs goes in its report as a proposal. A task file names the doc sections the agent reads (`kb search` or `kb why` in a project with kb), so the agent needs no more than `AGENTS.md` and them.

A change with no behavior that the ship would test with the cheap gates alone skips the worktree ([why](decisions/2026-10-25-skip-the-worktree.md)). The orchestrator's rules give one look before each spawn: when the change has no behavior (its records, such as a decision, a question, a roadmap or doc line; with no expensive gates, a typo or a comment too) and, in a project with expensive gates, touches only files `docsOnly` matches, the orchestrator commits it on the integration branch itself, staging only its files, after the cheap gates and with no ship running (`wf status` shows one as `shipping`); anything else goes by `wf spawn`. With expensive gates and no `docsOnly`, they say every task goes by `wf spawn`, the orchestrator's records too.

Small fixes go in batches. The orchestrator's rules say a fix is small when its cause and place are known and fit in one line, and it touches no business rule and nothing the project's own section of `AGENTS.md` marks as sensitive (each project names its own there). A batch of 2 to 4 is one task: one task file listing them, one worktree, one agent, one commit per fix, one report. A fix that turns out bigger comes back by `wf ask` and leaves the batch for a task of its own. The report fits the change: a small one gets the commits, the last lines of the gates and what to look at, and a section with nothing to say stays out.

Sessions stay short, since every turn reads the whole conversation again. The rules give an agent's session one task: a follow-up continues there (a SendMessage to the agent, or `wf resume` when it is gone), and a new task gets a new agent. The orchestrator, whose context is read again at every return of `watch`, reads reports narrowly and a large diff by parts (`--stat` first). After a round of tasks ships, or once its session has grown long, it writes what lives only in the conversation into the project's records (the decisions, the roadmap, the open questions: `kb decision new` and `kb question add` in a project with kb) and tells the person it is ready to hand over. The fresh session needs nothing from the old one: `wf status` shows the questions and reports still waiting (`watch.json` keeps what the old watch delivered), its `watch` replaces the old one, and `report` and `ask` reach that watch for agents an earlier session spawned.

**`wf spawn <name> --task <file|-> [--kind k] [--model m]`**, main checkout only.
1. Refuses: an invalid or taken name (branch, worktree or live agent); a herdr version outside the range; kind `claude` with the main checkout untrusted (`~/.claude.json`, `projects[<realpath>].hasTrustDialogAccepted`, read only), saying "open Claude once in `<main>` and confirm".
2. `herdr worktree create --cwd <main> --branch worktree/<name> --base <integration> --path <path> --label <name> --no-focus`.
3. `wf prepare` in the new worktree. A failure stops here and leaves the worktree for inspection.
4. Renders the header with the task and writes `task.md`. When a Claude Code session runs `spawn` (`CLAUDE_PID` names its record, `sessions/<pid>.json`, read only), the header names it as the orchestrator and `meta.json` keeps it; otherwise the header names the session in the main checkout.
5. Starts the agent from the root pane's shell, its first prompt an argument ([why](decisions/2026-10-25-spawn-starts-agent-from-shell.md)): `herdr pane run <pane> "<kind> '<arg>'…"`, the command word bare (so the person's alias for it applies) and each argument single-quoted. The arguments: the kind's start arguments (or the config's `agent.args`), then the arguments every start gets (Claude: `--disallowedTools AskUserQuestion EnterPlanMode`), then the model arguments for `--model` (Claude: `--model <m>`), kept in `meta.json` for `resume`, then the kind's prompt arguments (Claude: `--`, which ends `--disallowedTools`'s list, and "Your task is in `<task.md>`: read it and do it."). The pane's tty keeps what reaches a shell, while Claude Code's input box can lose a prompt typed while it starts. herdr sees the agent in the pane within seconds, unnamed: `spawn` reads `herdr pane get <pane>` until it tells the agent's state (up to 60 s), then names it, `herdr agent rename <pane> <name>`, and records `sentAt` and `sentSeq`, the state at the rename. A `blocked` agent stopped at a dialog before its prompt (a trust or setup question): `spawn` notifies the person (`--sound request`, naming the pane), saying whether herdr showed the call, then `herdr agent wait <name> --until working --until idle --until done --timeout 600000`; past the dialog, the agent goes on to its prompt.
6. Proves the agent started (`herdr agent get`): its state is `working`, `blocked` or `done`, or its `state_change_seq` moves past and it is so three seconds later and again a second after (`WF_SETTLE_MS`). Otherwise (a kind with no prompt argument, or a prompt the agent did not take) it types the prompt, `herdr agent prompt <name> <prompt>`, into a pane where nobody types yet, and checks the same way: herdr's success means it wrote the text and Enter, not that the agent took them. Not started, it sends `herdr agent send-keys <name> Enter` once, for a prompt held in the box (with a long paste, Claude Code now and then keeps the text and drops the Enter: 1 in 27 fresh starts on 2026-10-21), and checks again; still not started, the box was empty, so it sends the prompt once more; still not, it fails naming the pane, `herdr agent send-keys <name> Enter` and the task file.
7. Prints name, pane, path and the URLs from `look`.

**`wf watch [--timeout ms]`**, main checkout: [watch.md](watch.md).

**`wf report [--file f]`**, a worktree. Reads the report from stdin or the file; refuses an empty one; writes `<name>/report.md` with the time, `HEAD` and the agent's `state_change_seq` at the top. Then it reaches the orchestrator once ([why](decisions/2026-10-25-one-wake.md)):

- With a watch running that speaks for the agent ([watch.md](watch.md#whom-it-speaks-for)) and a `meta.json` for the worktree, the watch delivers it: `report` prints no message.
- Otherwise it calls the person at once (`--sound request`): no watch of the orchestrator's has the clock to remind them. When `spawn` recorded the orchestrator's session and that session still runs (by pid, or by its id after a restart, under its current name), it prints the message for the agent to send, which carries the report: SendMessage to that name, "wf: `<name>` reported in `<repo>`: `<report.md>`; read the diff and look at the screens, then `bun wf ship <name>`". It records the report as delivered in `watch.json`, so a watch started after it (the orchestrator's, between two returns) does not deliver it again. The rules tell the agent to send it, then stop.
- When that session no longer runs, it says so; the next watch delivers the report: after a hand-over, the fresh session's.

**`wf ask "<question>"`**, a worktree; a long question (a plan with options) on stdin, with `-` or no argument, or with `--file`. The agent stops on a question, a choice or a plan to approve. An orchestrator runs when the session `spawn` recorded still does (by pid, or by its id after a restart), or a watch that speaks for the agent runs ([watch.md](watch.md#whom-it-speaks-for)) and `wf spawn` started this worktree: the session receives the message, and the watch's reader is the orchestrator, after a hand-over or when `spawn` ran from a terminal too. `ask` writes `<name>/question.json` (the question, the time, the agent's `state_change_seq`, and `to`), then:

- With an orchestrator (`to: orchestrator`), it calls nobody, and the question reaches the orchestrator once, as a report does. With a watch that speaks for the agent, `watch` returns it as a `question` event, and `ask` prints no message. Otherwise `ask` prints the message for the agent to send, SendMessage to the session's name, "wf: `<name>` asks, in `<repo>`: `<question>` (answer by SendMessage to `<agent's session>`)", or `bun wf tell <name>` when no session runs for the agent, and records the question as delivered in `watch.json`.
- Alone (`to: person`), it calls the person with the question (`--sound request`, naming the pane), and the agent asks in its pane.

The question is open until the agent takes a turn after its stop on it, a stop the watch records ([watch.md](watch.md#turns)). Whoever started the turn answered: the orchestrator's SendMessage to the agent's name, a `wf tell`, the person in the pane ([why](decisions/2026-10-25-answer-by-turn.md)). Its next report, a `wf tell` or a resume closes it too. While it is open, `watch` delivers no `idle` for the agent. A report waits the same way, until the agent's turn after it, a `wf tell` or a resume; a turn nobody started (a background command finishing) reads as an answer, and its stop comes later as an `idle` event with the screen.

**`wf alert --pane <id>`**, run by the herdr plugin when an agent turns `blocked`. From the pane's folder (`herdr pane get`), finds the worktree; when `wf spawn` started its agent, it waits 8 s (`WF_BLOCKED_MS`): an agent no longer blocked at the same `state_change_seq` (auto mode answers some permission dialogs by itself) calls nobody, and one still blocked calls the person (`--sound request`, naming the repository and the pane) and records `alertedAt`; it exits `1`, saying the person was not called, when herdr did not show the call. Any other pane is left to herdr.

**`wf tell <name> <text>`**, anywhere, from a Claude Code session. A message to a running agent that never types into its pane: the person may be typing there, and typed text would merge with their half-written sentence and submit both. It finds the agent in `herdr agent list`, and its Claude Code session by the id herdr reports (`agent_session.value`, matched against `sessions/*.json`, under the session's current name). The orchestrator's way when SendMessage to the agent's name misses its session; a SendMessage sent straight answers as well, since the agent's turn records it. It records `sentAt` and `sentSeq` (the agent's `state_change_seq`, the stop the message answers) and prints "Tell `<name>` now, with SendMessage to \"`<session>`\": \"`<text>`\""; the caller sends it. A session message arrives as a message of its own, at the agent's next tool round or as a new turn, and leaves the input box alone. A blocked agent gets it too, with a note: the message waits in its session while the dialog stays the person's. It refuses, typing nothing, when the agent's session is not running (naming the pane, and `wf resume`), or when no Claude Code session runs `tell` (type it in the pane yourself).

**`wf status`**, anywhere. One row per linked worktree: name, commits ahead and behind `integration`, agent kind and state (`idle` and `done` read `stopped`: herdr's `done` means the turn ended and the agent waits for input, not that its task is done), report time or `-`, the next action, URLs. From git's worktree list and `herdr agent list`; an agent belongs to the worktree its `cwd` is in.

| Next | When |
|---|---|
| `shipping` | a `ship` delivers it now |
| `answer the person: on screen` | the agent is blocked |
| `check and ship` | a report waits (newer than `sentAt`, no turn of the agent's since: see `wf ask`) and the agent is not working |
| `no agent: resume` · `no agent` | no agent in its panes (`resume` when `wf spawn` started one) |
| `answer the agent: <question>` | a question to the orchestrator is open |
| `answer the person: <question>` · `with the person` | a question to the person is open; the agent stopped on it, or works again |
| `working` · `stopped: read its screen` | otherwise |

A worktree with no agent shows `! none`, and a note under the table says what to do: `wf resume <name>` when `wf spawn` started an agent there (it has a `meta.json`); otherwise start one in its pane, or `wf close <name>` (`git worktree remove <path>` for a branch that is not `worktree/<name>`). When herdr does not answer, the agent and next columns are `?` and nothing is marked. Under the table, for a repository with worktrees `wf spawn` started: whether a watch runs (pid, start), or `! no bun wf watch runs` with how to start it; each question waiting on the orchestrator, with its age; and each report waiting to ship, with its age.

**`wf resume <name>`**, main checkout. Refuses while an agent is live in the worktree's pane, naming how to reach it: SendMessage to its session, or `wf tell` when none runs. Starts the agent again with the arguments `spawn` gives it (the config's `agent.args` or the kind's, the arguments every start gets, the model) and the kind's continue flag; then types "You were interrupted. Carry on with the task in <task.md>; if it was done, run `bun wf report`." and checks that the agent took it, as `spawn` does with a prompt it types (step 6).

**`wf prepare [--worktree path] [--notify]`**, a worktree. Takes `prepare.lock`, runs `prepare` (none configured: nothing to do), reads `look` and prints the URLs; `--notify` sends them as a herdr notification (the plugin uses it).

**`wf ship [<name>…] [--reported] [--dry-run]`**, in the worktree, or in the main checkout with names: it and the gates, the agent's and its own, in [ship.md](ship.md).

**`wf close <name> [--force] [--delete-branch]`**, main checkout. Refuses uncommitted changes or a `working` agent without `--force`. Forgets the worktree, then stops its processes and closes it by path, as `ship` does; keeps the branch unless `--delete-branch`.

**`wf --skill [--all]`**, anywhere. Prints, as Markdown on stdout, the rules of the role the checkout plays: `templates/agent.md` in a worktree (ending with the line for an agent alone, with no orchestrator), `templates/orchestrator.md` in the main checkout, both with `--all`; rendered from the project's config (gates, `look`, `docsOnly`, the integration branch) and naming kb's commands when the main checkout's `agentsFile` carries kb's block. The block in `AGENTS.md` says to run it before anything with wf, so a session reads only its own role at every turn, and the task header carries the agent's rules once ([why](decisions/2026-10-26-the-block-in-agents-md-says-only-what-every-agent-needs-wf.md)). A flag, as `herdr --skill`: it prints the tool's own instructions and is no verb of the flow.

**`wf gen` · `wf check`.** The block sits between `<!-- wf:rules · generated by wf gen -->` and `<!-- /wf:rules -->` in `agentsFile`. `gen` renders `templates/rules.md` with the config (under 300 words: what every agent needs at every turn, and the pointer to `wf --skill`) and rewrites only the block; with no markers, it inserts them after `<!-- /kb:global -->`, or at the end of the file. `check` fails when the block is missing or differs. Both check that `CLAUDE.md` is a symlink to `AGENTS.md`, as kb does.

**`wf init`**, the main checkout or a worktree (a project adopts wf in a worktree it then ships). Writes `wf.config.ts` (with `integration` set to the main checkout's branch, and `prepare: 'bun install'` when there is a `package.json`) when missing; turns an existing `CLAUDE.md` into `AGENTS.md`, or creates `AGENTS.md` titled with the repository's name (the main checkout's folder); links `CLAUDE.md` to it; adds the `wf` script to `package.json` keeping its formatting; runs `gen` and `doctor`.

**`wf doctor`.** The config valid; the block current; the shell inside herdr; herdr installed, version in range, server compatible; the plugin `tekne.wf`, which calls the person when an agent stays blocked (`spawn` warns without it); herdr's state integration for the configured kind; Claude trust for the main checkout; each worktree with no agent, as a warning with `status`'s advice; with worktrees `wf spawn` started, whether a watch runs, each question waiting on the orchestrator and each report waiting to ship, with its age, as warnings. A warning, not a failure: a worktree between its agent's exit and a resume is the flow's own state, and resuming, starting or closing is the orchestrator's call. Prints each check with what to run when it fails; changes nothing.

## herdr adapter and plugin

What `wf` calls and reads of herdr, and the plugin herdr runs: [herdr.md](herdr.md).

## Agent kinds

The orchestrator is always a Claude Code session. Agents in worktrees are Claude; another kind enters as one row of `src/kinds.ts` (start args, model args, first-prompt args, continue flag, herdr integration, trust check) once someone uses it and it is checked end to end. Its report needs nothing new: `bun wf report` is a shell command. A message to it does: `wf tell` reaches a Claude Code agent through its session, and another kind needs its own way to receive a message without the input box.

| Kind | Start args | Every start | Model | First prompt | Continue | State in herdr | Trust check |
|---|---|---|---|---|---|---|---|
| `claude` | `--permission-mode auto --name <name>` | `--disallowedTools AskUserQuestion EnterPlanMode`: a question's choices and a plan's approval are dialogs only the person can answer, so questions and plans go by `wf ask` and a blocked agent waits on a permission | `--model <m>` | `-- <prompt>`, last | `--continue` (the latest session of the folder) | integration `claude` | `~/.claude.json` |

## Tests

- **Unit** (`bun test`): config validation; the block (under 300 words), each role's and the header's rendering; `gen` and `check` on fixtures with and without kb's block; `watch`'s event selection, reminders and next action from recorded `herdr agent list` output, with a question and a report answered by a turn past the stop the watch recorded, and not by a dialog inside the asking turn, another agent's change or a session change; names, paths, the repository lock and the machine's places; which agents a watch speaks for.
- **ship** (`bun test`): temporary repositories with a main checkout and a worktree, each with its own `wf.config.ts` whose gates are cheap shell commands. The cases: the gates in order, the cheap first, stopping at the first that fails; a docs-only diff running the cheap gates alone, and one file outside `docsOnly` (or no `docsOnly`) running every gate; every refusal, the integration branch moving during the gates or while waiting for a place, a new commit during the gates, gates leaving files behind, a conflict, success and `--dry-run`; a main checkout dirty for a moment; an agent that stops a few seconds after its report, one still working a minute after it, and a prompt, a question or a turn after the report, which waits for nothing; an expensive gate in a place; an interrupted ship ending its gate's group; a process left writing in the worktree stopped before it closes. With no herdr workspace for the path, closing falls back to `git worktree remove`. The tests' machine places live in a temporary `WF_STATE_DIR`. No test covers `ship --reported` with several agents still ending their turn: it waits for each in turn, each until a minute after its own report.
- **Flow** (`bun test`): the commands as processes against the fake herdr (`--skill` in a worktree, in the main checkout and with `--all`, with and without kb's block), which keeps each agent's input box and can lose Enters: spawn (model, orchestrator session, AskUserQuestion and EnterPlanMode left out whatever the config's args, started from its pane's shell and named, a dialog while starting, a prompt not taken and typed, one never started; resume's nudge left in the input box, and lost whole and sent once more, a watch reading the agent before it took its task), tell (a session message, the person's half-typed text untouched, its refusals), report and ask with the orchestrator's watch running (no message; the watch delivers it, for an agent spawned from a terminal too, after a hand-over), with a watch orphaned, another session's or a terminal's (the message) and with none (the message, which a watch started after does not repeat; the report's call to the person), ask alone, `-` reading stdin, tell answering a stop, a turn with no tell answering a question and a dialog in the asking turn, other agents and `/clear` not, status, resume (the config's args kept), close (processes stopped, the pane's shell spared, a watch running meanwhile), a call herdr did not show (spawn, report, ask, alert, watch), a blocked state gone within the hold (alert, watch), the ship queue (a report answered by a turn past its recorded stop left out), a gate reading the worktree's `.env.local` over the main checkout's `.env` (`bun wf` through the project's script and the bin), and watch's guards (`/dev/null`, a shell already gone, orphaned while it runs, one watch per repository, a terminal's watch delivering nothing of a session's agents and never ending the orchestrator's).
- **Contract** (`bun run test:herdr`, by hand after each herdr update and after a change to the adapter or to `spawn`'s launch; it passed on 2026-10-25, 9 pass; needs `HERDR_ENV=1`; opens and closes its own workspaces in the person's herdr): creates a worktree of a temporary repository, lists worktrees, panes and agents (with the session herdr reports for the agent running the test, renamed by its pane to its own name), reads a pane's shell and its state before an agent, runs a command in it, removes it, shows one silent notification, and asserts every field the adapter reads. In a detached worktree of this repository (trusted through the main checkout), it starts Claude Code on haiku with no tools, prompts one turn and then `/clear`: `state_change_seq` moves once to `working` and once to `done`, past another pane's change, and a new session leaves it; the test answers no dialog, and fails on one.

CI runs unit, ship and flow.

## Release

Versions, the CHANGELOG, publishing and CI: [release.md](release.md).
