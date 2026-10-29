---
date: 2026-10-25
lives_in:
  - spec.md#package
---

# wf runs Bun with --no-env-file

**Decision:** The bin's shebang is `#!/usr/bin/env -S bun --no-env-file`: no wf command loads a `.env`, and `prepare` and the gates start from the environment wf was started with.

**Why:** At the site on 2026-10-24, `wf ship` in the main checkout loaded its `.env`, and the worktree's gate read the main checkout's `PB_URL` over the worktree's `.env.local`, since Bun never overrides a variable already set. wf reads nothing from `.env`. Tested with Bun 1.3.14: the bin, `bun wf` through a script `"wf": "wf"` and `bunx` all go through the shebang, and `bun run` passes no `.env` to its scripts.

**Rejected:** dropping the main checkout's `.env` keys from the gates' environment, which has to parse every `.env` file Bun reads and guess which value came from where · `env = false` in each project's `bunfig.toml`, which every project must remember and which turns it off for the project's own scripts too · passing the worktree's files with `--env-file`, which wf would have to list as Bun does, `NODE_ENV` included
