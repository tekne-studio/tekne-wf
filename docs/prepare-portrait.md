---
title: Prepare portrait
group: Project
summary: How a worktree gets its own stack today, in the two projects that run wf with data
order: 5
---

# Portrait: a worktree's own stack, today

How a worktree gets its own ports and its own copy of the data in the two projects that run wf with data, as of 2026-10-25. It holds facts only; the proposal built on it is `prepare-proposal.md`, and the roadmap item it serves is [`wf init` gives a project its worktree `prepare`](roadmap.md#wf-init-gives-a-project-its-worktree-prepare).

The two projects, by their shape:

- **The platform**: a client's web platform, the first project to adopt wf. PocketBase, a web app, Mailpit for the sign-in codes, and E2E and browser suites with a test stack per worktree.
- **The site**: a site whose content lives in the main checkout's PocketBase data, copied into each worktree.

Sources, read only: each project's main checkout on its integration branch, on 2026-10-25. A path below in this repository says `wf`; a project's own files are named by what they do.

## How wf runs a project's `prepare`

- `prepare` is a shell command in `wf.config.ts`. `wf prepare` runs it in the worktree with `sh -c`, under the repository lock `prepare`, then reads `look` and prints the URLs (`wf src/commands/prepare.ts:31-43`).
- Three callers: `wf spawn` right after creating the worktree (`wf src/commands/spawn.ts:97`); the herdr plugin on `worktree.created`, as `wf prepare --notify` (`wf herdr/plugin.ts:4`, `:63`); `wf ship` after each merge of the integration branch, with `sh` directly, under the `prepare` lock (`wf src/ship.ts:232-239`).
- wf's bin runs Bun with `--no-env-file` (`wf src/cli.ts:1`), so `prepare` starts from the environment wf started with, and the project's own Bun loads the worktree's env files.
- The wf proposal leaves ports and data to the project: "Port slots and data copies stay in the project's `prepare` (the platform's worktree script). A port-slot helper in `wf` comes later, once a second project needs it" ([proposal](proposal.md#configuration-wf-config-ts)).
- `wf init` writes `prepare: 'bun install'` when the repository has a `package.json` (`wf src/commands/setup.ts:17-27`).

## The platform

**Config.** `prepare: 'bun run worktree'`, which also runs after each merge of the integration branch, since that merge may bring a dependency or a new key in `.env.local`. `look` reads `APP_URL` and `MAILPIT_URL` from `.env.local`; the task header points at Mailpit and the personas. `bun run worktree` runs the project's worktree script.

**What the worktree script does**, in order:

| Step | What |
|---|---|
| Refuse | in the main checkout, with a message to run it from inside a worktree; exit 1 |
| Lock | a lock file in the git common dir, named after the project; waits for a live holder, drops a dead one's. The reason: the plugin and the agent may run it together, and two new worktrees would take the same slot |
| Link | `.env` and the PocketBase binary to the main checkout's; a missing source warns, an existing target (even a broken link) is kept |
| Slot | n in 1-89: PocketBase 8100+n, app 5200+n, Mailpit 8200+n, SMTP 1100+n, tests 9100+10n (eight ports). A worktree's slot is its `.env.local` `PB_URL` port minus 8100. A new one takes the lowest n no other worktree's `.env.local` holds whose 12 ports all refuse a connection; none free throws |
| `.env.local` | rewrites `PB_URL`, `APP_URL`, `MAILPIT_URL`, `SMTP_PORT`, `E2E_PORT_BASE`, keeps every other line; a new file starts with a comment line |
| Data | PocketBase's `pb_data` from the main checkout: skipped when the worktree has `data.db` and no `--refresh`; refused while the worktree's PocketBase port answers; `data.db` by `VACUUM INTO` (with `SQLITE_FCNTL_PERSIST_WAL` off) and `storage/` by `cp -cR` (APFS clone), `cp -R` when that fails; built in `pb_data.tmp` and swapped in at the end. A main checkout with no `data.db` warns and the worktree starts empty |
| Install | `bun install` |
| Seed | after a new copy only: the personas' seed, with the slot's keys passed explicitly, since the script's own environment loaded the main checkout's `PB_URL`; a failure warns |
| Print | the app and Mailpit URLs |

**How the stack reads the slot.**

- `bun run dev` runs under Bun, which loads `.env.local` over `.env`. PocketBase takes `PB_URL`'s port, from the worktree's own PocketBase folder. Mailpit takes `SMTP_PORT` and `MAILPIT_URL`, defaults 1025 and 8025. Vite takes `APP_URL`'s port with `--strictPort`.
- The tests' stack (E2E and browser) takes eight ports from `E2E_PORT_BASE`, fixed ports in the main checkout and CI. Its ports module reads `.env.local` itself, because `bun test` does not load `.env.local`, and Playwright runs on Node, which does not read `.env`.
- The test harness refuses a busy port, naming its owner.

**Refusals outside the script.** `bun run dev` has no worktree check: a worktree with no `.env.local` takes the main checkout's ports, through the `.env` link or the defaults. It warns and goes on without Mailpit when either Mailpit port answers.

**What AGENTS.md and the docs say.**

- The commands list: preparing the worktree (`.env`, the database copy, ports) is `bun run worktree`, and `--refresh` copies the database again.
- The worktree section: the prepare is `bun run worktree`, idempotent, run by wf's herdr plugin; a person alone runs `git worktree add`, then `bun run worktree`, then `bun run ship`; the `.env` is a link, so changing it changes every worktree, and a variable for one worktree goes in `.env.local`; look at `APP_URL`, sign in as a persona, read e-mail at `MAILPIT_URL`.
- The wf block: what to look at is `APP_URL`, `MAILPIT_URL` in `.env.local`.
- The architecture and testing docs describe the same slot and ports.
- Three decisions: a worktree runs on a copy of the main checkout's data, never a link of `pb_data`; a worktree prepares itself in herdr and tests on a slot of ports, test ports included (rejected: ports picked at start time, one E2E queue); each worktree runs its own Mailpit on the slot's ports.

## The site

**Config.** `prepare: 'bun run worktree'`, which runs after each merge of the integration branch too, since that merge may bring a new dependency or migration. `look` reads `SITE_URL` from `.env.local`; the header says content is edited only in the main checkout.

**What the worktree script does.** The platform's script, with English comments: the same sections, functions and messages (the main-checkout refusal word for word).

| Step | What |
|---|---|
| Refuse | in the main checkout, the same message |
| Lock | a lock file in the git common dir, named after the project |
| Link | `.env` and the PocketBase binary |
| Slot | n in 1-89: PocketBase 8300+n, site 5300+n, chosen clear of the platform's ranges and of the main checkout's 8091 and 5180. Found as in the platform, from `PB_URL` minus 8300 |
| `.env.local` | rewrites `PB_URL`, `PUBLIC_PB_URL`, `PUBLIC_MEDIA_URL` (the same PocketBase URL) and `SITE_URL`, keeps the rest |
| Test env | links `.env.test.local` to `.env.local` when absent, since `bun test` runs with `NODE_ENV=test`, which reads `.env.test.local` in place of `.env.local` |
| Data | the same copy as the platform: `data.db` by `VACUUM INTO`, `storage/` by APFS clone, built beside and swapped; logs, backups and `types.d.ts` stay out |
| Install | `bun install` |
| Print | the site and PocketBase URLs |

**How the stack reads the slot.**

- `bun run dev` reuses a PocketBase already answering at `PB_URL`; otherwise it serves this checkout's `pb_data` with `--dir` explicit, since a worktree's binary is a symlink to the main checkout's. Vite takes `SITE_URL`'s port, strictly when `SITE_URL` is set, so only in a worktree.
- `bun test` reads `SITE_URL`, default 5180, through the `.env.test.local` link.
- The expensive gate reuses the site at `SITE_URL` or, in a worktree, starts its stack and stops it after; in the main checkout it refuses to start Marlus's. It passes `SITE_URL` to `bun test` explicitly, since `bun test` runs with `NODE_ENV=test` and skips `.env.local`.

**Refusals outside the script.**

- A no-slot guard: in a worktree whose `PB_URL` is still the main checkout's 8091, dev and the PocketBase commands refuse and say to run `bun run worktree` first.
- A main-checkout-only guard: deploy, sync and provision refuse in a worktree, whose data is a test copy.

**What AGENTS.md says.**

- Never block or bring down Marlus's `bun run dev` in the main checkout.
- One item holds the whole worktree story: links, the copy and `--refresh`, the slot's ports and keys, `.env.test.local` for `bun test`, the refusals, content edited only in the main checkout. It ends telling the orchestrator to ship with `bun --no-env-file node_modules/@tekne/wf/src/cli.ts ship <name>`, since the fix is in wf's roadmap; wf's bin now runs with `--no-env-file` (`wf src/cli.ts:1`).
- `bun test` runs against `SITE_URL`; the expensive gate starts the worktree's stack when it is down. Deploy, sync and provision run only in the main checkout.
- The wf block: what to look at is `SITE_URL` in `.env.local`.
- A decision: a worktree runs on a copy of the main checkout's data, with the links and the slot, and the same alternatives the platform rejected.

## Bun and the env files

Checked with Bun 1.3.14 in a scratch folder holding `.env` (`K=env`) and `.env.local` (`K=local`):

| Run | `NODE_ENV` | `K` |
|---|---|---|
| `bun show.ts` | unset | `local`: `.env.local` over `.env` |
| `bun test` | `test` | `env`: `.env.local` skipped |
| `bun test`, with `.env.test.local` linked to `.env.local` | `test` | `local` |
| `bun --no-env-file show.ts` | unset | unset |

Bun never overrides a variable already set ([decision](decisions/2026-10-25-wf-loads-no-env-file.md)), so a process started before `.env.local` is written keeps the values it loaded; the platform's seed step passes the slot's keys for that reason.

## Same and different

| | Both | The platform | The site | Why it differs |
|---|---|---|---|---|
| The command | `prepare: 'bun run worktree'`, idempotent, `--refresh` | | | |
| Where it may run | a worktree only; the main checkout refuses | | | |
| Lock | a file in the git common dir, named after the project, a dead holder's dropped | | | |
| Links | `.env` and the PocketBase binary | | | |
| Slot | 1-89, from `PB_URL` minus a base; taken = held by another worktree's `.env.local` or a port answering (connect on 127.0.0.1 and ::1) | 4 dev ports (PocketBase, app, Mailpit, SMTP) and a block of 8 test ports | 2 ports | the platform runs Mailpit per worktree (sign-in codes by e-mail) and an isolated test stack per worktree; the site's tests run against the worktree's own dev site |
| Port bases | | 8100, 5200, 8200, 1100, 9100+10n | 8300, 5300 | chosen by hand to stay clear of each other on one machine |
| `.env.local` | managed keys rewritten, other lines kept | `PB_URL`, `APP_URL`, `MAILPIT_URL`, `SMTP_PORT`, `E2E_PORT_BASE` | `PB_URL`, `PUBLIC_PB_URL`, `PUBLIC_MEDIA_URL`, `SITE_URL` | each app's own key names; the site's browser reads PocketBase through the public keys |
| `bun test` | | the test ports module reads `.env.local` itself | `.env.test.local` links to `.env.local`; the gate also passes `SITE_URL` | the platform's tests start their own stack, and Playwright runs on Node; the site's tests hit the dev site |
| Data | `data.db` by `VACUUM INTO`, `storage/` by APFS clone, built beside and swapped, refused while the worktree's PocketBase answers, empty when the main checkout has none | | | |
| After the copy | `bun install` | seeds the personas | | the platform's agents sign in as a persona |
| Guards elsewhere | | the test harness refuses a busy port | dev and the PocketBase commands refuse a worktree with no slot; deploy, sync and provision refuse any worktree | the site's main checkout holds the real content and the deploy |
| `look` | URLs from `.env.local` | `APP_URL`, `MAILPIT_URL` | `SITE_URL` | |
