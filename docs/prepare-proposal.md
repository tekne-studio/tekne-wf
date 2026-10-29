---
title: Prepare proposal
group: Project
summary: What wf init writes for a worktree's own stack, and the six choices behind it
order: 6
---

# Proposal: `wf init` gives a project its worktree prepare

What wf takes over from the two projects' worktree scripts, what a project still writes, and how the platform and the site would move (the portrait names each by its shape). Built on the portrait (`prepare-portrait.md`) for the roadmap item [`wf init` gives a project its worktree `prepare`](roadmap.md#wf-init-gives-a-project-its-worktree-prepare). Marlus chose in each of § Choices on 2026-10-25, each choice a decision, and the shape below follows them.

## The shape

`wf prepare` does what both scripts do the same way, from a `worktree` field in `wf.config.ts`. The project writes one function, its data copy. `prepare` stays the project's command for the rest: `bun install`, the platform's personas.

### The config

```ts
type Config = {
	// … the fields of today
	worktree?: {
		links?: string[]; // paths linked to the main checkout's: .env, a binary
		slots?: number; // default 89
		ports?: Record<string, number | { base: number; step?: number; count?: number }>; // slot n holds `count` ports from base + step·n
		env?: Record<string, string>; // the keys wf writes to .env.local; {name} is that port
		data?: { dir: string; copy: string }; // a folder filled from the main checkout's by the function `copy` exports
	};
};
```

The site's, which holds everything its worktree script decides:

```ts
worktree: {
	links: ['.env', 'pocketbase/pocketbase'],
	ports: { pb: 8300, site: 5300 },
	env: {
		PB_URL: 'http://127.0.0.1:{pb}',
		PUBLIC_PB_URL: 'http://127.0.0.1:{pb}',
		PUBLIC_MEDIA_URL: 'http://127.0.0.1:{pb}',
		SITE_URL: 'http://localhost:{site}'
	},
	data: { dir: 'pocketbase/pb_data', copy: 'scripts/worktree.ts' }
},
prepare: 'bun install',
```

The platform's differs in its ports and its `prepare`:

```ts
ports: { pb: 8100, app: 5200, mailpit: 8200, smtp: 1100, e2e: { base: 9100, step: 10, count: 8 } },
env: {
	PB_URL: 'http://127.0.0.1:{pb}',
	APP_URL: 'http://localhost:{app}',
	MAILPIT_URL: 'http://127.0.0.1:{mailpit}',
	SMTP_PORT: '{smtp}',
	E2E_PORT_BASE: '{e2e}'
},
prepare: 'bun install && { test -z "$WF_COPIED" || bun run seed:personas; }',
```

### What `wf prepare` runs

In a worktree, under the `prepare` lock, for every caller: `wf spawn`, the herdr plugin, and `wf ship` after each merge, which goes through the same function.

1. Refuses in the main checkout, as today.
2. **Links** each `links` path to the main checkout's. A missing source warns; an existing target, a broken link included, stays.
3. **Slot**: the `WF_SLOT` in the worktree's `.env.local`; without one, the lowest n in 1..`slots` that no other worktree's `.env.local` holds and whose every port refuses a connection on 127.0.0.1 and ::1. With none free, it fails naming the range.
4. **`.env.local`**: writes `WF_SLOT` and the `env` keys, keeps every other line, and links `.env.test.local` to it so `bun test` reads the slot (§ Bun and the env files).
5. **Data**, when `data` is set. It skips when `dir` exists in the worktree and `--refresh` is not given; it warns and skips when the main checkout has no `dir`, and the worktree starts empty; it refuses while a port of the slot answers ("stop this worktree's stack first"). Otherwise it makes an empty `<dir>.tmp`, runs the project's function in a Bun process of its own, started after step 4 so it reads the slot, and swaps the folder in when the function returns. A throw removes the folder, keeps the previous data and fails the prepare.
6. **`prepare`**, the project's command, with `WF_COPIED=1` in its environment when step 5 copied.
7. **`look`**, as today.

`wf prepare --refresh` copies the data again, in place of `bun run worktree --refresh`; `wf ship` and the plugin never pass it. With no `worktree` in the config, steps 2 to 5 do nothing and a project runs as it does today.

### The one function a project writes

`data.copy` names a file whose default export fills `into` from `from`. It runs before `prepare`, so before `bun install`: it imports `bun:*` and `node:*`, takes wf's type with `import type` (erased at run time, as `wf.config.ts` does), and gets the two helpers both projects use from wf.

```ts
// scripts/worktree.ts: this worktree's copy of the main checkout's PocketBase data. Logs, backups
// and types.d.ts stay out: PocketBase writes them at boot, and the backups belong to the deploy.
import { join } from 'node:path';
import type { DataCopy } from '@tekne/wf/config';

export default (async ({ from, into, sqlite, clone }) => {
	sqlite(join(from, 'data.db'), join(into, 'data.db'));
	await clone(join(from, 'storage'), into);
}) satisfies DataCopy;
```

- `sqlite(src, dst)`: `VACUUM INTO`, a consistent snapshot while the main checkout's server writes, with `SQLITE_FCNTL_PERSIST_WAL` off so no `-wal` or `-shm` stays beside the source.
- `clone(src, dir)`: an APFS clone (`cp -cR`), a plain copy where that fails; a missing `src` copies nothing.
- The context also holds `main`, `root`, `slot` and the `env` keys with their values.

### What `wf init` writes

Into a repository with no `wf.config.ts`; an existing config stays as it is.

| It finds | It writes |
|---|---|
| a `dev` script in `package.json` | `worktree.ports: { web: 5400 }` and `env: { APP_URL: 'http://localhost:{web}' }`, and `look` on `APP_URL` (choice 5) |
| a `package.json` | `prepare: 'bun install'`, as today |
| `.env` in `.gitignore` | `links: ['.env']` |
| `pocketbase/pb_migrations/` | `pocketbase/pocketbase` in `links`; the port `pb: 8400` with `PB_URL`; `data: { dir: 'pocketbase/pb_data', copy: 'scripts/worktree.ts' }` and the file above |
| `.env.local`, `.env.test.local`, a link or `data.dir` outside `.gitignore` | their lines in `.gitignore` |

The bases 5400 and 8400 are the next pair after the platform's and the site's (choice 4). `init` never names a `package.json` script `prepare`: that name is the install lifecycle script (the site's runs `svelte-kit sync`).

`wf gen` adds one line to the rules block when `worktree` is set: the worktree's stack is its own, with its slot in `.env.local`; `.env` is the main checkout's through a link, so a key for one worktree goes in `.env.local`; `bun wf prepare --refresh` copies the data again. Both projects hand-write that in their AGENTS.md.

### What `wf check` verifies

`wf check` runs in CI, where no main checkout data exists, so it checks the repository:

- The config, with `worktree`: every port of every slot within 1024-65535; the ports of two names never meet in any slot; every `{name}` in `env` is a port; `look.keys` on `.env.local` among the `env` keys; `data.copy` a file whose default export is a function.
- git ignores what `wf prepare` writes in a worktree: `.env.local`, `.env.test.local`, each `links` path and `data.dir` (`git check-ignore`). One of the two projects does not ignore `.env.test.local` today.
- The rules block is current and `CLAUDE.md` links to `AGENTS.md`, as today.

`wf doctor` checks the machine's side: in the main checkout, that each `links` source and `data.dir` exist, since a worktree starts without them otherwise; in a worktree, its slot and whether its `.env.local` matches the config.

## Bun and the env files

The portrait's check, with Bun 1.3.14 (portrait § Bun and the env files), and what the shape does with it:

- `bun <script>` and `bun run` load `.env.local` over `.env`. `bun test` sets `NODE_ENV=test`, skips `.env.local` and reads `.env.test.local`. The slot lives in `.env.local`, which dev, Vite and `look` read, and `.env.test.local` links to it for `bun test`: the site's link, made generic.
- Bun never overrides a variable already set, so a process started before `.env.local` is written keeps the old values. wf writes `.env.local` (step 4) before it starts the data function and `prepare`: both read the slot, and the platform's seed needs no keys passed by hand.
- Node reads no env file. A tool that runs on Node, such as Playwright's config, reads `.env.local` itself, as the platform's test ports module does; that stays the project's.

## Moving the two projects

`worktree` is optional: a project on its own script runs unchanged, and gains only `ship` taking the `prepare` lock. Moving needs no worktree open, since wf finds a slot by `WF_SLOT` and a worktree the old script prepared has none; the rule that a wf upgrade waits until a round ships and no worktree is open already gives that moment.

**The site**

- `wf.config.ts`: the `worktree` above, and `prepare: 'bun install'`.
- The worktree script: the function, about ten lines. The repository helpers keep the checkouts, the port reader, the no-slot guard (it reads `PB_URL`, which wf writes as the script does) and the main-checkout-only guard; the port probe and the lock serve only the worktree script and go.
- The worktree item of `AGENTS.md` keeps what is the site's (content edited in the main checkout only, the refusals) and leaves the rest to the rules block. Its last sentence, shipping with `bun --no-env-file node_modules/@tekne/wf/src/cli.ts`, goes: wf's bin does that (`wf src/cli.ts:1`).
- A decision amends the site's decision on a worktree's copy of the main checkout's data, which stays true in what it chose: wf now writes the slot and the links.

**The platform**

- `wf.config.ts`: the `worktree` above, and `prepare` with the personas after a copy.
- The worktree script: the function. The repository helpers go: only the worktree script imports them.
- `.gitignore` gains `.env.test.local`. The test ports module stays, since Playwright runs on Node.
- `AGENTS.md` and the architecture doc name `bun wf prepare` and `--refresh`; a person alone runs `git worktree add`, `bun wf prepare`, `bun wf ship`.

## Choices

1. **Where the generic part lives.** (a) In `wf prepare`, declared in `wf.config.ts`: the shape above. (b) A script `wf init` generates and the project owns: today's `worktree.ts` as a template. (c) A function in `@tekne/wf` that the project's script calls. **Chosen: (a).** The site's script is a copy of the platform's, and what it added (the `.env.test.local` link, the no-slot guard) never reached the platform: (b) repeats that drift in every project. (c) needs `bun install` before the script, and `wf check` cannot read a script's options without running it. (a) runs from the wf that calls `prepare`, writes `.env.local` before any project process starts, and lets `wf check` validate the slot.
2. **The data copy's contract.** (a) One function in a frame wf owns: wf decides when to copy, refuses while the stack is up, hands an empty folder and swaps it in. (b) The project's command does it all, as today, with `WF_MAIN` and `WF_REFRESH` in its environment. **Chosen: (a).** The frame is the same in both projects line for line (portrait § Same and different), and keeping the old data when a copy fails halfway is the part a new project would forget.
3. **What wf knows of SQLite.** (a) wf hands the function `sqlite` and `clone`, and `wf init` writes the PocketBase body when it finds `pocketbase/`. (b) The helpers only, and an empty function from `init`. (c) Neither: the project writes the whole copy. **Chosen: (a).** Both projects carry the same twenty lines, the studio's projects run PocketBase, and the helpers use only Bun's built-ins; the function stays the project's. The cost: it is the one place wf learns PocketBase, which (b) avoids at the price of those twenty lines in each project.
4. **Port bases for a new project.** (a) `wf init` writes default bases, and the person moves them when two projects share a machine, as the site did; the connection probe already skips a slot whose port answers. (b) A machine registry in `WF_STATE_DIR` that `init` reads to pick free bases and `doctor` reads to warn on overlap. **Chosen: (a)** now, with the bases and why in a comment in the config; (b) when a third project with a stack shares the machine.
5. **What `wf init` writes when it finds no stack**, as in the empty repository of the roadmap's test. (a) `worktree` with one `web` port, `APP_URL` and `look`. (b) No `worktree`, as today. (c) The `web` port, `APP_URL` and `look` only when `package.json` has a `dev` script, else no `worktree`. **Chosen: (c):** a dev server on a fixed port is the first thing two worktrees fight over, and a repository with no dev server would get a URL nobody serves.
6. **When the two projects move.** (a) The site first, the platform after a round of wf at the site, each as a task in its own flow once no worktree is open. (b) Both keep their scripts, and `worktree` serves new projects. (c) Both in the same round. **Chosen: (a).** The site has the smaller stack and already links `.env.test.local`; the platform is a client project with four dev ports, a test block and seeds, where a slot error stops several agents at once.
