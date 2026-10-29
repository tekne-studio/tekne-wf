---
date: 2026-10-25
lives_in:
  - release.md#release
---

# CI writes the registry token to both user npmrc files

**Decision:** The token step in `ci.yml` and `release.yml` writes `//npm.tekne.studio/:_authToken` to `$HOME/.npmrc` and to `${XDG_CONFIG_HOME:-$HOME}/.npmrc`, the secret passed through `env:`; CI keeps Bun pinned at 1.3.14.

**Why:** The 0.7.0 runs got a 401 on `@tekne/kb` at `bun install --frozen-lockfile` (ci run 40160689010, release run 40160694831). Bun 1.3.14 reads the user npmrc from `$XDG_CONFIG_HOME/.npmrc` whenever that variable is set, and then never reads `$HOME/.npmrc`; GitHub's Ubuntu runner sets `XDG_CONFIG_HOME=$HOME/.config`. npm reads `$HOME/.npmrc`, so the publish needs that one. Checked locally with Bun 1.3.14: the install passes with the token in `$HOME/.npmrc` and gets the same 401 once `XDG_CONFIG_HOME` is set, with no Authorization header sent.

**Rejected:** bumping Bun in CI, which would test another Bun than the machines run · the token in the project's `.npmrc`, a line a commit can leak · `NPM_CONFIG_USERCONFIG`, which Bun 1.3.14 ignores
