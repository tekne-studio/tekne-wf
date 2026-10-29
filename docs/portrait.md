---
title: Portrait
group: Project
summary: How the flow of parallel agents ran before wf, and what it taught
order: 2
---

# Portrait: parallel agents, today

How the flow of agents in worktrees works on 2026-10-21: what exists, where it lives, what is generic and what belongs to each project. Validated with Marlus on 2026-10-21; the base for the `tekne-wf` proposal (`proposal.md`).

Sources, each project by its shape:

- **The platform**: a client's web platform, the first project to adopt wf. PocketBase, a web app, Mailpit for the sign-in codes, and E2E and browser suites with a test stack per worktree. Read on its checkout on `dev` and on the worktree that held its ship script.
- **The engine**: a Rust engine with a Go server and a Svelte web client, and no data to copy. Read on `dev`.
- `tekne-kb` (`templates/agents/`), herdr 0.9.3 and the account of the first round at the platform.

## The flow, step by step

As it ran at the platform on 2026-10-21, with 5 to 6 worktrees at once.

| # | Step | Who | How, today | Where it lives |
|---|---|---|---|---|
| 1 | Orchestrate | a Claude Code session in the main checkout, on `dev` | talks with the person, splits the work into tasks | in the conversation |
| 2 | Create the worktree | orchestrator | `herdr worktree create --cwd <repo> --branch worktree/<name> --base dev --path ~/.herdr/worktrees/<repo>/worktree-<name> --label <name> --no-focus` | herdr |
| 3 | Prepare the worktree | herdr plugin, on `worktree.created` | `bun run worktree`: `.env` and PocketBase binary as symlinks, copy of `pb_data`, port slot in `.env.local`, `bun install`; notifies with the app and Mailpit URLs | the platform's worktree script and herdr plugin |
| 4 | Hand over the task | orchestrator | a Claude Code **subagent**, with the standard header: where to work, rules, definition of done, how to check, report format | the header exists only in the orchestrator's conversation |
| 5 | Work | subagent | commits each green step in the worktree | the project's `AGENTS.md` and kb's block |
| 6 | Follow | orchestrator | the subagent is invisible: the person neither sees its pane nor enters it | n/a |
| 7 | Report | subagent | the report comes back as the subagent tool's result | n/a |
| 8 | Check | orchestrator | rereads the diff, reruns the cheap gates, samples screenshots; the expensive ones (E2E, browser) after merging `dev` stay with the agent | in the conversation |
| 9 | Deliver to `dev` | orchestrator or agent | by hand, following `AGENTS.md`: `git merge dev` in the worktree, `bun kb check`, tests, merge into `dev`. `bun run ship` (in progress) does it in one command | the worktree section of `AGENTS.md`; the merge script, on a worktree's branch |
| 10 | Close | whoever delivered | `herdr worktree remove --workspace <id>` and `git branch -d` | `AGENTS.md`; the merge script |
| 11 | Publish | orchestrator, after the person's yes | the platform: a push of `dev` to the branch that deploys (fast-forward); the engine: merging `dev` into `main` publishes | each project's `AGENTS.md` |

Checked in herdr: the platform's two open worktrees each have a pane with a shell and no agent. Their work runs as subagents of the orchestrator.

## The pieces

### The platform

**The worktree script: prepare** (idempotent; `--refresh` copies the database again)

- Refuses in the main checkout; finds the main checkout through the git common dir.
- Lock in the git common dir: one preparation at a time per repository, because the plugin and the agent may run together and two new worktrees would take the same slot. A dead process's lock is discarded.
- Symlinks `.env` and the PocketBase binary to the main checkout's.
- Port slot `n` (1 to 89): PocketBase `8100+n`, app `5200+n`, Mailpit `8200+n`, SMTP `1100+n`, eight test ports from `9100+10n`. The slot is the first one no other worktree holds in its `.env.local` and whose ports nobody answers on. Writes only the keys it manages (`PB_URL`, `APP_URL`, `MAILPIT_URL`, `SMTP_PORT`, `E2E_PORT_BASE`) and keeps the rest of `.env.local`.
- Copies `pb_data` with `VACUUM INTO` (a consistent snapshot while the main PocketBase runs) and an APFS clone of `storage`; builds beside and swaps at the end.
- `bun install`; prints the app and Mailpit URLs.

**The port probe** tests a port by **connecting** to `127.0.0.1` and `::1`. On macOS, listening on `127.0.0.1` succeeds even when another process listens on `[::]` (Mailpit's default), and both share the port without an error.

**The herdr plugin** (linked with `herdr plugin link` from the main checkout; the only plugin installed in herdr)

- The `worktree.created` event and two workspace actions: prepare, and copy the database again.
- herdr fires the event for worktrees of every repository; the plugin compares the git common dir and acts only on the platform's.
- A branch without the worktree script: asks to bring `dev` in.
- Reads `APP_URL` and `MAILPIT_URL` from `.env.local` and notifies that the worktree is ready; on failure, notifies with sound and the preparation's `✗` line.

**Test ports.** Eight ports from `E2E_PORT_BASE` (read straight from `.env.local`, since `bun test` and Playwright do not load it); fixed ones in the main checkout and in CI.

**`bun run ship`** (the merge script, on a worktree's branch, not yet on `dev`)

- The project's configuration is an object at the top: `integration: 'dev'`, `prepare: 'bun run worktree'`, `gates` from cheapest to most expensive: `check`, `kb check`, `test:unit`, `test:e2e`, `test:browser`, `shots`. The rest serves any repository.
- Refuses: in the main checkout; a dirty worktree, one without a branch or with a merge in progress; a main checkout off `dev` or dirty; a branch with no new commit.
- Loop: `git merge dev` → prepare → gates (stops at the first failure, with a timing table) → `merge` lock in the git common dir → if `dev` moved, back to the merge; otherwise, fast-forward of the main checkout to the tested commit.
- Starts over when a new commit lands during the gates; fails when the gates leave dirty files.
- Closes: detaches HEAD, deletes the branch, closes through herdr with the workspace found **by path** in `herdr worktree list` (never `HERDR_WORKSPACE_ID`), or `git worktree remove` outside herdr.
- `--dry-run` does everything but the fast-forward and the close. A test variable swaps preparation and gates for cheap commands, only with the repository in a temporary folder. Never pushes.
- The repository helpers (same branch): the checkouts and a lock, shared by the worktree and merge scripts.

**`AGENTS.md`** (`CLAUDE.md` is a link): the "Shared rules" block generated by kb and the project's worktree section (where the worktree is born, the shared `.env`, the person's URL in `APP_URL`, merge into `dev`, close, the deploying push only after the yes).

### The engine

Rust (engine and WASM), Go (server), Svelte (web), kb. Integration on `dev`; `dev` → `main` publishes (semantic-release, prereleases `0.0.1-dev.N`).

- **No worktree preparation and no plugin.** `AGENTS.md` says the worktree is born in herdr (`~/.herdr/worktrees/<repo>/worktree-<name>`, branch `worktree/<name>`) and needs `bun install` before its first commit: the `commit-msg` hook (through `core.hooksPath`, which holds for every worktree) runs `bunx --no-install commitlint`. No worktree is open today.
- **Ports at start time**, no slot: `bun run dev` takes `8090` or the next free one (a free-port helper), and Vite picks the page's on its own. The URL is known only once dev is up. The helper tests by **listening** on `127.0.0.1`, the test the platform found unreliable on macOS.
- **No `.env` in the worktree** (the defaults serve). Each worktree starts a server state of its own; there is no data to copy.
- **Rust `target/` per checkout**, no shared `CARGO_TARGET_DIR`: the first build in a new worktree compiles everything. Cost not yet measured.
- **Gates: one command**, `bun run check`, which runs what CI runs, in order (fmt, clippy, Rust tests, WASM build, module, go vet and test, web check and tests, proto and plugin generation without diff, `kb check`).
- **The worktree section of `AGENTS.md`:** commit each green step, merge into `dev`, close the worktree with `herdr worktree remove --workspace "$HERDR_WORKSPACE_ID"`. Several sessions may share one checkout: before writing, `git status`, `ListAgents` and one message naming the paths. Its section on who decides: the session decides what can be undone; Marlus decides the name, licence, money and what is published, pushed or deleted.

### kb (`tekne-kb`)

- `kb gen` writes the shared rules into `AGENTS.md` between `<!-- kb:global · generated by kb gen -->` and `<!-- /kb:global -->`, from `templates/agents/<module>.md`; `kb check` fails when the block differs from the templates. `CLAUDE.md` must be a symlink to `AGENTS.md`.
- The project picks the modules in `kb.config.ts` (`agents.modules`, default `['core']`). The platform and the engine both use `['core', 'worktrees']`.
- `worktrees.md` becomes the section "Parallel agents: one worktree per feature":
  - one worktree and one branch per feature; never two agents in one working directory;
  - commit each green step; merging into the integration branch waits for the person's yes;
  - show before merging (the project section says how);
  - finish: bring the integration branch in, resolve conflicts, run the gates, merge; close the worktree last;
  - talk before touching what another feature touches: `herdr agent list`, `herdr agent prompt`, `herdr agent read`; SendMessage between Claude sessions;
  - a conflict that is not only yours waits for both sides;
  - decisions and questions are one file each, so parallel branches add them without conflicts.
- The template has no orchestrator: whoever works is whoever merges.

### herdr and Claude Code (checked on 2026-10-21)

- **herdr 0.9.3.** `worktree create | list | remove`; `pane list`; `agent start | prompt | wait | read | send-keys | rename`; `notification show`; plugins with events (`worktree.created`) and actions. The socket API has `events.subscribe` and `events.wait`, with events such as `pane_agent_status_changed`, `worktree_created` and `worktree_removed` (`herdr api schema`).
- **Agent states:** `idle`, `working`, `blocked` (an approval or question on screen), `done`, `unknown`. `agent prompt` refuses a `blocked` agent (`agent_blocked`); `agent start` returns `agent_not_ready` when the agent blocks while starting.
- **State integrations:** `claude` installed (hooks v10 in `~/.claude/hooks/herdr-agent-state.sh`); `codex` and `kimi` not installed (`herdr integration install codex | kimi` exists). How herdr classifies them without the hooks is not yet checked.
- **`HERDR_WORKSPACE_ID`** is the workspace of whoever runs the command. In the orchestrator, it is the main checkout's.
- **Two addresses for one agent:** herdr reaches any kind by name (`tekne-flow`) or pane (`w1D:p1`); Claude Code's SendMessage reaches only Claude sessions, by session name (the platform's orchestrator has one, and in herdr its pane is unnamed). A message between sessions in different permission modes waits for approval.
- **Folder trust:** Claude Code asks "Is this a project you trust?" in every new folder, and each worktree is a new folder. The main checkouts appear in `~/.claude.json` (`projects`, `hasTrustDialogAccepted: true`); the worktree folders do not.

## Generic and per project

| Piece | Generic (serves any repository) | Per project |
|---|---|---|
| Worktree place and branch | `~/.herdr/worktrees/<repo>/worktree-<name>`, `worktree/<name>`, based on the integration branch | — |
| Integration branch | the main checkout stays on it | the platform: `dev` · the engine: `dev` |
| Preparation | run an idempotent command at creation and after each merge of the integration branch; a lock in the git common dir | the platform: `bun run worktree` (env, database, ports, deps) · the engine: `bun install` |
| Ports | a free slot per worktree, tested by connecting, written to `.env.local` | which ports and keys (the platform: five services and eight for tests) · the engine picks at start time |
| URL for the person to look at | notify when the worktree is ready | the platform: `APP_URL` and `MAILPIT_URL` from `.env.local` · the engine: only once dev is up |
| Gates | run in order, stop at the first failure, timings | the platform: six commands · the engine: `bun run check` |
| Deliver | merge the integration branch, gates, repository lock, fast-forward to the tested commit, never push | — |
| Close | workspace found by path; branch deleted | — |
| Publish | waits for the person's yes | the platform: `dev` → the branch that deploys, by push · the engine: `dev` → `main` |
| Task header | where, rules, definition of done, how to check, report format | the gates, the URL, the project's rules |
| Start and watch the agent | `herdr agent start | wait | read`, states | which agent (Claude, Codex, Kimi) |

## What the first round taught

- An agent's report is a claim, not proof. The orchestrator reread the diffs, reran the cheap gates and sampled screenshots; the expensive ones stayed with the agent. `ship` and CI close that gap.
- The standard header works: one agent stopped at an ambiguous business rule and came back with options and a recommendation; another found a lying code comment, through the rule of looking around.
- Collisions: Mailpit on a fixed port (solved with the slot); the i18n files, one per language, as a sure conflict point between worktrees; the dev database copy holds only real people, so an agent has nobody to sign in as to look at screens (open at the platform: seeded scenarios and signing in as a persona).
- One agent dropped on an API network error mid-task; resuming worked.
- Six stacks (PocketBase, app, Mailpit, Playwright) in parallel on one machine hold up.
- A visible agent in herdr stops at the new folder's trust question: `herdr agent start` returned `agent_not_ready`, and the person confirmed in the pane. The orchestrator does not answer for the person.
- The person wants to see the agents live, be called only when needed, and trust checks, not summaries.

## Gaps and divergences

1. **A subagent is invisible.** The person neither sees nor enters the work; it is why `tekne-wf` exists.
2. **The new folder's trust question blocks `agent start`** for every worktree.
3. **Three versions of who merges.** kb: the agent finishes and merges, after the person's yes. The platform today: the orchestrator checks and merges. The engine: the session merges into `dev` on its own.
4. **Closing with `$HERDR_WORKSPACE_ID`**, as the platform's (on `dev`) and the engine's `AGENTS.md` say, is right only from the worktree's own pane; from the orchestrator, it closes the main checkout. `ship` already finds the workspace by path.
5. **The engine allows several sessions in one checkout**; kb says never two agents in one working directory.
6. **The task header is written nowhere**: each orchestrator rebuilds it from memory.
7. **Codex and Kimi have no way back**: without herdr state hooks and without SendMessage, the report arrives only by reading the screen (`herdr agent read`) or through a file.
8. **Preparation depends on one plugin per project**, linked from each one's checkout; the engine has none.
9. **The engine tests a port by listening**, the trap the platform already documented in its port probe.
10. **`ship` lives in the platform** and waits for the merge into `dev` there; its configuration already sits apart at the top, ready to be extracted.
