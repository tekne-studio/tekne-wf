---
title: Proposal
group: Project
summary: What wf is, how the flow runs and what stays out
order: 3
---

# Proposal: tekne-wf

`wf` is the studio's command for parallel agents: an orchestrator session in a project's main checkout starts agents in herdr worktrees, where the person sees them live; watches them; checks and delivers their work. The same flow in every project, with the project's own preparation and gates in one config file. It stands apart from kb: a project uses `wf` with or without kb, and `wf` writes its own rules into `AGENTS.md`.

Based on the portrait (`portrait.md`). Marlus said yes on 2026-10-21; the spec (`spec.md`) builds on it.

`wf` speaks the flow's own verbs (`spawn`, `report`, `ship`) and keeps herdr behind one adapter: when herdr changes, or another multiplexer replaces it, the rules in every project stay as they are and a new `wf` version follows (see "herdr changes"). For everything outside the flow (layout, reading a screen, focus), agents use `herdr` directly.

## The flow

| # | Step | Command | Who |
|---|---|---|---|
| 1 | Create, prepare and start | `wf spawn <name> --task <file>` | orchestrator, main checkout |
| 2 | Work, live in herdr | — | agent, in its worktree's pane |
| 3 | Watch; call the person only for what is theirs | `wf watch` (a background command) | orchestrator |
| 4 | Report | `wf report` | agent |
| 5 | Check: the diff, what changed on screen | git, the app | orchestrator |
| 6 | Deliver to the integration branch and close | `wf ship <name>` | orchestrator |
| 7 | Push to a shared environment | the project's own command | orchestrator, after the person's yes |

Each task gets its own worktree, branch and agent: never two agents in one working directory. The orchestrator commits on the integration branch itself, after the cheap gates, a change with no behavior that the ship would test with those gates alone, such as its own records ([why](decisions/2026-10-25-skip-the-worktree.md)). With an orchestrator, the agent never merges: it reports, and the orchestrator ships. Its work reaches the integration branch with no yes from the person once the orchestrator has checked it and `wf ship` passes; a push to a shared environment waits for the person's yes. An agent working alone (one session in a worktree, no orchestrator) plays both parts and finishes with `wf ship` from its worktree.

## Commands

| Command | Where | What it does |
|---|---|---|
| `wf init` | main checkout | writes `wf.config.ts` and the rules block in `AGENTS.md` (creating `AGENTS.md` with `CLAUDE.md` as a symlink when missing), then runs `wf doctor` |
| `wf doctor` | anywhere | herdr version and server; the `wf` herdr plugin linked; herdr state integrations for the configured agent kinds; Claude trust for the repository; the config |
| `wf spawn <name> --task <file\|->` | main checkout | `herdr worktree create` (branch `worktree/<name>`, base the integration branch), `wf prepare`, starts the agent in the worktree's pane under the same name (`--kind` overrides the config), sends the header and the task; prints pane and URL |
| `wf status` | anywhere | each worktree: branch, commits ahead of and behind the integration branch, agent and state, report waiting, URL |
| `wf watch` | main checkout | returns at the first event to act on (below) and prints it; the orchestrator acts and runs it again |
| `wf tell <name> <text>` | anywhere | finds the agent's Claude Code session when its name misses it, and prints the SendMessage that carries the text; never types into its pane |
| `wf report` | a worktree | records the report (stdin or a file) and wakes `wf watch` |
| `wf resume <name>` | main checkout | starts the agent again in its pane, continuing its last conversation (`claude --continue` picks the latest session of the folder it starts in) |
| `wf prepare` | a worktree | runs the project's `prepare` under the repository lock (the herdr plugin, `spawn` and `ship` call it) |
| `wf ship [<name>]` | main checkout with a name, or the worktree itself | refuses on a dirty or wrong state, merges the integration branch, prepares, runs the gates in order (the cheap alone when every changed file matches `docsOnly`), takes the lock, fast-forwards the main checkout to the tested commit, deletes the branch, closes the worktree by path; never pushes; `--dry-run` |
| `wf close <name>` | main checkout | abandons a worktree: closes it by path; keeps the branch unless `--delete-branch` |
| `wf gen` · `wf check` | anywhere · CI | writes · verifies the rules block |
| `wf --skill [--all]` | anywhere | prints the rules of the role the checkout plays: the agent's in a worktree, the orchestrator's in the main checkout, both with `--all` |

Names follow herdr's agent names (`[a-z][a-z0-9_-]{0,31}`): one name for the worktree, the branch and the agent.

## Configuration: `wf.config.ts`

The only part that changes between projects. TypeScript, like `kb.config.ts`.

```ts
// the platform: a data copy and ports per worktree, E2E and browser suites
export default defineConfig({
	integration: 'dev',
	prepare: 'bun run worktree',
	gates: {
		cheap: ['bun run check', 'bun kb check', 'bun run test:unit'],
		expensive: ['bun run test:e2e', 'bun run test:browser', 'bun run shots']
	},
	look: { file: '.env.local', keys: ['APP_URL', 'MAILPIT_URL'] },
	agent: { kind: 'claude' },
	header: 'Screens are checked in the browser at APP_URL; sign-in codes arrive at MAILPIT_URL.'
});

// the engine: one gate, no data to copy
export default defineConfig({
	integration: 'dev',
	prepare: 'bun install',
	gates: { cheap: ['bun run check'] },
	agent: { kind: 'claude' }
});
```

- `prepare` is idempotent: it runs at creation and after every merge of the integration branch.
- `gates` run in order, cheap then expensive; the first failure stops the run. An agent runs the cheap ones in its worktree; `wf ship` runs all of them, so the orchestrator never reruns them ([why](decisions/2026-10-22-ship-runs-the-gates.md)).
- `docsOnly` lists the globs of the paths that count as docs (`['docs/**', '**/*.md']`): when every file the delivery changes matches, `wf ship` runs the cheap gates alone and says why ([why](decisions/2026-10-22-ship-in-proportion-tests-the-tip.md)). Empty or missing, every gate runs.
- `look` is where the URLs the person opens come from, read after `prepare`. Without it, the agent reports the URL.
- `agent.kind` picks the default agent; `wf` knows each kind's start arguments (`--permission-mode auto` for Claude) and how it continues a conversation.
- `header` adds the project's lines to the task header.

Port slots and data copies stay in the project's `prepare` (the platform's worktree script). A port-slot helper in `wf` comes later, once a second project needs it (the engine picks ports at start time today).

## Rules: `wf`'s own block in `AGENTS.md`

`wf gen` writes the rules between `<!-- wf:rules · generated by wf gen -->` and `<!-- /wf:rules -->`, the same mechanism as kb's block: each tool touches only its own markers, and `wf check` (in CI, beside `kb check`) fails when the block is stale. The block sits after kb's and before the project's section. It is rendered from `wf`'s template and the project's config, so it names the real integration branch, gates and URLs; the projects' hand-written worktree sections leave, and with them the close by `$HERDR_WORKSPACE_ID`.

The block is `templates/rules.md`, under 300 words: what every agent needs at every turn (one orchestrator; one worktree, branch and agent per task; never merge, push or close from inside a worktree; send the SendMessage a command prints; `herdr --skill` for the rest of herdr) and the pointer to `bun wf --skill`, which prints the rules of the role the checkout plays, `templates/agent.md` in a worktree and `templates/orchestrator.md` in the main checkout, rendered with the project's values ([why](decisions/2026-10-26-the-block-in-agents-md-says-only-what-every-agent-needs-wf.md)). The task header carries the agent's rules once, so a spawned agent reads them with its task.

The rules keep sessions short ([why](decisions/2026-10-22-short-sessions.md)), puts small fixes in batches ([why](decisions/2026-10-22-small-fixes-in-batches.md)) and leaves the gates to the ship, whose review adds what they cannot ([why](decisions/2026-10-22-ship-runs-the-gates.md)). They say that commits are checkpoints and the ship tests the tip in proportion to the diff ([why](decisions/2026-10-22-ship-in-proportion-tests-the-tip.md)), that tools change between rounds ([why](decisions/2026-10-22-tools-change-between-rounds.md)), and when a change skips the worktree ([why](decisions/2026-10-25-skip-the-worktree.md)).

They hold only what nothing else the agent reads already says ([why](decisions/2026-10-22-block-says-only-what-nothing-else-says.md)). A rule both blocks share lives in kb's, which owns knowledge, writing, evidence, commits and working with the person; wf's keeps it only where a project with wf alone needs it. With kb, kb's block says what a decision is and where each fact lives; without kb, the orchestrator's rules say it, with kb's criterion: a decision only for a choice with a plausible alternative someone would propose again, which Rejected names. What a command prints when it runs stays out of the block: `watch`'s restart and its refusal of `&`, `tell`'s way to `resume`, the SendMessage that `ask`, `tell` and `report` print.

kb's side: the platform and the engine drop `'worktrees'` from `agents.modules` in `kb.config.ts` in the commit that adds `wf`'s block. kb's `core` already says decisions and questions are one file each, so parallel branches never collide. The `worktrees` template leaves kb once no project uses it (a change in `tekne-kb`, after its open worktree merges).

## How the orchestrator and the agents talk

- **Orchestrator → agent:** a SendMessage to the agent's name, which its Claude Code session carries; `wf tell` finds the session when the name misses it, and prints the SendMessage that carries the message. A session message arrives as a message of its own and leaves the input box alone, so a message never types into the agent's pane, where the person may be typing. The agent's next turn records the answer, whoever started it ([why](decisions/2026-10-25-answer-by-turn.md)). Another kind needs its own way to receive a message without the input box.
- **Agent → orchestrator:** `wf report` (finished work) and `wf ask` (a question, a choice, a plan), shell commands every kind can run. Each reaches the orchestrator once: the orchestrator's running `wf watch` delivers it; otherwise it prints the SendMessage that carries it to the orchestrator's session ([why](decisions/2026-10-25-one-wake.md)). The report lands in `<git common dir>/wf/<name>/report.md`, the question in `question.json` beside it, which every worktree and the main checkout see, outside the tracked tree; they leave when the worktree closes.
- **Agent → agent:** `wf status` shows who works where; `wf tell` reaches them.

## Watching and calling the person

`wf watch` follows the agents' states in herdr and the report folder. It returns at the first of:

| Event | The orchestrator | The person |
|---|---|---|
| a report arrived | checks, then ships or answers by SendMessage to the agent | — |
| an agent asks (`wf ask`) | answers what the decisions, the docs and the person's earlier choices settle, tells the person what it decided | called only for what nothing settles, a permission, a push or a publish, or anything destructive or outward; and once when a question waits ten minutes |
| an agent is blocked (a dialog on screen: a permission) | never answers it | the herdr plugin calls them once it stays blocked 8 s, with sound and the pane (a state that goes away by itself, such as a permission auto mode answers, calls nobody); `wf watch` calls again every five minutes while it waits |
| an agent is idle or done without a report | reads its screen (`herdr agent read`), nudges by SendMessage to the agent | — |
| an agent is gone (pane exited, agent not detected) | `wf resume <name>` | — |

Calling the person never waits on the orchestrator: the plugin reacts to herdr's `pane.agent_status_changed`. The orchestrator's `wf watch` is a queue that loses nothing (it keeps what it delivered), and the orchestrator starts it again before acting, so a second event during a long `ship` still wakes it. The person's notifications go through `herdr notification show`; product questions reach the person in the orchestrator's own pane, in conversation. Reliable states for Codex and Kimi need `herdr integration install codex | kimi`; `wf doctor` says so when the config uses them.

## Trust in a new folder

Claude Code keys a worktree's trust on its main checkout (docs: code.claude.com/docs/en/permissions, "Project allow rules and workspace trust"). This machine agrees: 33 herdr worktree folders hold Claude sessions, and none has its own entry in `~/.claude.json`. The question stops an agent only when the repository was never trusted, as happened at `tekne-flow`'s birth, spawned from the platform's orchestrator into a new repository.

- `wf doctor` and `wf spawn` read `projects[<main checkout>].hasTrustDialogAccepted` in `~/.claude.json`. Untrusted: `spawn` stops before creating anything and asks the person to open Claude once in the main checkout.
- When the question shows up anyway (`agent_not_ready` and the dialog on screen), `wf spawn` notifies the person with sound and waits for the agent to become ready.
- `wf` never answers the dialog and never writes `~/.claude.json`: trust is the person's.

Renaming the folder to `tekne-wf` moved its key: the first Claude session there asks once more.

## herdr changes

herdr is at 0.9, before 1.0: its commands will change. `wf` absorbs that in one place.

- **One adapter.** Every herdr call goes through one module and reads herdr's JSON output, never screen text. The rules and the config never name a herdr command for the flow.
- **A tested range.** `wf` declares the herdr versions it was tested with, as herdr plugins declare `min_herdr_version`; outside the range, `wf doctor` and `wf spawn` warn before acting.
- **A contract test.** `wf`'s suite runs against the installed herdr; after a herdr update, it says what changed before anyone trips on it.
- **Pass-through when herdr catches up.** When herdr gains something `wf` does itself (waiting on several agents, a report channel), the `wf` command hands over to it and keeps its name.
- **Thin and visible.** Each command prints the herdr commands it ran, so the person and the agents can always redo a step by hand.

## Distribution

- `@tekne/wf` on `npm.tekne.studio`, a devDependency of each project like `@tekne/kb`: the lockfile pins the version, so `wf check` in CI uses the version that wrote the block. Runs under Bun.
- One herdr plugin for every project, installed once per machine: on `worktree.created`, it runs the project's own `wf prepare` in the new worktree and notifies with the URLs; when an agent of a wf worktree blocks, it calls the person. It replaces the platform's own plugin, and the engine gets preparation without a plugin of its own.
- Releases: `bun run release` pushes a version tag, and CI publishes from it. Repository `tekne-studio/tekne-wf`, public.

## Out of scope

- Pushing, deploying, publishing: the project's own commands, after the person's yes.
- Pull requests, CI configuration, remote machines (`herdr --machine`).
- Answering an agent's approval or trust question: always the person.
- Splitting the work into tasks and choosing what runs in parallel: the orchestrator, which leads the agents.
- Seeded scenarios and signing in as a persona: the project's own.
- Decisions, questions and docs: kb's.

## Migration

1. `wf ship` extracts the generic part of the platform's merge script and its repository helpers.
2. The platform: `wf.config.ts`, `wf`'s block, the `ship` script calls `wf ship`, its own herdr plugin leaves, `'worktrees'` leaves `agents.modules`. Coordinated with the platform's orchestrator.
3. The engine: `wf.config.ts` and the block; its worktree section leaves.
4. kb: the `worktrees` template leaves.
