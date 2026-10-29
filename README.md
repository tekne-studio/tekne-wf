# @tekne/wf

Parallel coding agents, each in its own git worktree and its own herdr pane, led by one orchestrator: a Claude Code session in the project's main checkout. The orchestrator opens the agents, answers their questions, ships their work and tells the person; it is the person's filter. The person watches every pane, may step in, and is called only for what is theirs (a permission, a product question nothing settles, a push). The same flow in every project; what changes lives in `wf.config.ts`.

## The flow

| Step | Command | Who |
|---|---|---|
| Create a worktree, prepare it, start the agent, send the task | `bun wf spawn <name> --task <file> [--model <m>]` | orchestrator |
| Wait for the first thing to act on | `bun wf watch` (the harness's own background command) | orchestrator |
| Message a running agent | SendMessage to its name; `bun wf tell <name> "<text>"`, then the SendMessage it prints, when the name misses its session | orchestrator, agents |
| Ask a question, a choice or a plan to approve | `bun wf ask "<question>"` | agent |
| Answer it from what exists, or bring it to the person | SendMessage to the agent's name | orchestrator |
| Report, then message the orchestrator | `bun wf report` (the report on stdin) | agent |
| Read the diff, look at what changed on screen | git, the app | orchestrator |
| Deliver to the integration branch and close the worktree | `bun wf ship <name>…` or `bun wf ship --reported` | orchestrator |
| Push to a shared environment | the project's own command | orchestrator, after the person's yes |

An agent alone in a worktree, with no orchestrator, finishes with `bun wf ship` itself. `bun wf help` lists every command.

Every worktree is born from `bun wf spawn`, with an agent the person can watch, tool upgrades included: a handoff from another tool, such as kb's upgrade steps, becomes the task file. The orchestrator never edits in a worktree; it reads, checks and ships. `bun wf status` and `bun wf doctor` mark a worktree with no agent and say what to do: `bun wf resume <name>` when wf started an agent there, otherwise start one in its pane or `bun wf close <name>`.

`wf watch` returns at the first of: an agent blocked on a dialog (a permission), an agent's question, a report, an agent stopped with no report since its last prompt (with its screen), an agent gone (`bun wf resume <name>`). The orchestrator starts it again before acting, and runs `ship` in the background too, so nothing waits on a long delivery. While it waits, `watch` calls the person again for an agent still blocked after five minutes, and once for a question or a report the orchestrator left waiting ten.

Sessions stay short, since every turn reads the whole conversation again. An agent's session holds one task: a follow-up continues there (a SendMessage to the agent, or `bun wf resume` when it is gone), and a new task gets a new agent. The orchestrator's context is read again at every return of `watch`, so it reads reports narrowly and a large diff by parts. After a round of tasks ships, or once its session has grown long, it writes what lives only in the conversation into the project's records (the decisions, the roadmap, the open questions) and tells the person it is ready to hand over; the fresh session reads `bun wf status` and starts `watch` again.

Small fixes go in batches, and the review adds what the gates cannot. A fix is small when its cause and place are known and fit in one line, and it touches no business rule and nothing the project's own section of `AGENTS.md` marks as sensitive (each project names its own). A batch of 2 to 4 is one task: one task file, one worktree, one agent, one commit per fix and one report, as short as the change. A fix that turns out bigger leaves the batch for a task of its own. `ship` runs every gate, the cheap first, and stops at the first that fails, so the orchestrator never reruns them: it reads the diff and looks at what changed on screen.

The ship runs in proportion to the diff and tests the tip. A delivery whose every file matches `docsOnly` runs the cheap gates alone, and `ship` says why. A change with no behavior that the ship would test with the cheap gates alone, such as the orchestrator's own records, skips the worktree: the orchestrator commits it on the integration branch after the cheap gates, with no ship running. An agent commits as it goes: a commit is a checkpoint, and the tip is the commit that reaches the integration branch. Tools change between rounds: a wf or kb upgrade waits until a round ships and no worktree is open, and an improvement to a tool found during a round goes to that tool's roadmap (wf's is `docs/roadmap.md`), for one release at the end of the round.

Nothing waits on the watch alone:

- **The watch runs where it is read.** It runs as the harness's own background command (in Claude Code, the Bash tool with `run_in_background`). It refuses an output sent to `/dev/null` or a start with `&`, `nohup` or `disown`, and stops without delivering once the shell that started it is gone. One watch runs per repository; a new one replaces the old.
- **A report pushes, once.** With a watch running, the watch delivers it. With none, `bun wf report` calls the person at once and prints the message (SendMessage) the agent sends to the Claude Code session that ran `bun wf spawn`.
- **A question goes to the orchestrator, the person's filter.** An agent that stops on a question, a choice or a plan runs `bun wf ask "<question>"` (a long one on stdin). An orchestrator runs when the session that spawned the agent still does, or a watch runs for the repository. Then the question is the orchestrator's: `watch` returns it, or, with no watch running, `ask` prints the SendMessage that carries it; the person is not called. The orchestrator answers what the decisions, the docs and the person's earlier choices settle, and tells the person what it decided. It records a decision only when the choice had a plausible alternative someone would propose again, and Rejected names it; without one, the why goes in a code comment or the topic doc. It brings the person only a product question nothing settles, a permission, a push or a publish, or anything destructive or outward. Alone, `ask` calls the person, and the agent asks in its pane.
- **`bun wf status` says what comes next** per worktree (check and ship, answer the agent, answer the person, working, stopped, no agent), whether a watch runs, which questions wait on the orchestrator and which reports wait to ship. herdr's `done` means an agent's turn ended, not its task.

An agent's pane stays the person's:

- **wf types into a pane once**, for the first prompt: the task from `spawn`, or the nudge from `resume`, into a pane just opened where nobody types yet. Then it checks that the agent took it: its state moves and stays working. A prompt left in the input box gets Enter once; one still unsent stops `spawn` with the pane and the command that sends it.
- **No dialog on screen asks the person a question.** wf starts a Claude agent with `--disallowedTools AskUserQuestion EnterPlanMode`, so its questions and plans go by `bun wf ask`, and a blocked agent is one waiting on a permission, which stays the person's.
- **Every later message is a Claude Code session message.** SendMessage to the agent's name reaches its session; `bun wf tell <name> "<text>"` finds the session when the name misses it, and prints the SendMessage that carries it. The agent's next turn records the answer, whoever started it. The message arrives as a message of its own and never touches the input box, so a sentence the person is halfway through stays as it was. With no session to carry it, or run outside Claude Code, `tell` says so and types nothing.

## Set up a project

```sh
bun add -d @tekne/wf     # needs @tekne:registry=https://npm.tekne.studio in .npmrc
bun wf init              # wf.config.ts, AGENTS.md with CLAUDE.md as a link, the "wf" script, the rules block
```

```ts
// wf.config.ts
import type { Config } from '@tekne/wf/config';

export default {
	integration: 'dev',
	prepare: 'bun run worktree',
	gates: {
		cheap: ['bun run check', 'bun kb check', 'bun run test:unit'],
		expensive: ['bun run test:e2e', 'bun run test:browser']
	},
	docsOnly: ['docs/**', '**/*.md'],
	look: { file: '.env.local', keys: ['APP_URL', 'MAILPIT_URL'] },
	header: 'Sign-in codes arrive at MAILPIT_URL.'
} satisfies Config;
```

| Field | Means |
|---|---|
| `integration` | the branch the main checkout stays on; `ship` fast-forwards it |
| `prepare` | idempotent shell command run in each new worktree and after each merge of the integration branch |
| `gates.cheap`, `gates.expensive` | shell commands, in order; an agent runs the cheap ones in its worktree; `ship` runs all, the cheap first, and stops at the first that fails |
| `docsOnly` | globs of the paths that count as docs; a delivery whose every file matches runs only the cheap gates |
| `look` | the `KEY=value` file and keys with the URLs the person opens |
| `agent` | `{ kind: 'claude', args }`; `args` replace `--permission-mode auto --name <name>` (`--disallowedTools AskUserQuestion EnterPlanMode` stays, and `bun wf spawn --model` adds `--model`, either way; `resume` uses them too) |
| `header` | the project's lines for the task header |
| `agentsFile` | default `AGENTS.md` |

`bun wf gen` keeps the rules block in `AGENTS.md` current (between `<!-- wf:rules … -->` and `<!-- /wf:rules -->`, after kb's block when there is one); `bun wf check` fails when it is stale, so CI runs it. The block is short, what every agent needs at every turn, and points to `bun wf --skill`, which prints the rules of the role the checkout plays: the agent's in a worktree, the orchestrator's in the main checkout, both with `--all`. `bun wf doctor` checks herdr, the plugin, herdr's state integration, Claude's trust in the repository and the config, and warns of a worktree with no agent, of no watch running, and of each report waiting to ship.

## One machine, many repositories

`bun wf ship a b c` (or `--reported`, every report waiting, the oldest first) delivers one after another, each bringing in what the one before delivered; a refusal stays behind and the rest go on. The full suites belong to the ship: the rules tell each agent to run the cheap gates in its worktree and, of the expensive ones, only the test files it touched, so four worktrees never queue Chromiums on one Mac. A test that fails with no cause in the change goes to quarantine, never three reruns, and only with proof: it fails on the integration branch without the change too, or only under load (its agent skips it and names it in the report, with the proof). Expensive gates take one of the machine's places, shared by every repository's worktrees: `WF_GATE_SLOTS`, or a quarter of the cores by default. Cheap gates run freely. Each gate runs in a process group of its own, which an interrupted `ship` ends whole. Closing a worktree, by `ship` or `close`, first stops every process still running in it, a dev server left behind included.

## One herdr plugin per machine

```sh
herdr plugin install tekne-studio/tekne-wf/herdr
```

It serves every repository that has a `wf.config.ts`, with that repository's own wf (the main checkout's, since a fresh worktree has no `node_modules` yet), and leaves the rest alone:

- `worktree.created`: `wf prepare --notify` in the new worktree, then a notification with the URLs.
- `pane.agent_status_changed` to blocked: `wf alert`, which calls the person, with sound, once an agent `wf spawn` started has waited 8 s on a dialog: a permission, since its questions go to the orchestrator by `bun wf ask`. No orchestrator needs to be watching.

## What wf never does

- Answer an approval or a trust question: they are the person's. Claude Code asks trust once per repository (a worktree's trust is its main checkout's); `spawn` stops before acting when it is missing.
- Push or publish.
- Work out of the person's sight: the orchestrator never edits in a worktree, and `status` and `doctor` mark a worktree with no agent.
- Close a worktree by `$HERDR_WORKSPACE_ID`: it finds the workspace by path.

## herdr behind one adapter

Every herdr call goes through `src/herdr.ts`, reads herdr's JSON and is printed (`→ herdr …`), so any step can be redone by hand. `wf` declares the herdr versions it was tested with and stops outside them; `bun run test:herdr` checks every field it reads against the installed herdr.

## Develop

```sh
bun install
bun run check       # types
bun kb check        # the docs, the decisions and the roadmap
bun run test        # unit, ship and flow tests, with a fake herdr
bun run test:herdr  # the contract with the real herdr, from a herdr pane
```

The design: `docs/proposal.md` and `docs/spec.md`.
