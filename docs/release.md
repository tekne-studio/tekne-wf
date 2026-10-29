---
title: Release
group: Project
summary: How a version is cut and published, and what CI runs
order: 10
---

# Release

`bun run release`: the version from the Conventional Commits since the last tag; the CHANGELOG's `## Unreleased` turned into the new version's entry (with none, an entry drafted from the commits), read and given a sentence on what the release is; the checks, `chore: release x.y.z`, the tag `vx.y.z`, then a push of `main` and of the tag. It runs in the main checkout, on `main` and clean, and refuses anywhere else (`tests/release.test.ts`). `.github/workflows/release.yml` publishes the tag to `npm.tekne.studio` from a clean checkout; it needs the repository's `NPM_TOKEN` secret (`gh secret set NPM_TOKEN -R tekne-studio/tekne-wf`) and says so when it is missing. `.github/workflows/ci.yml` runs the checks on every push to `main` and every pull request. Both workflows install `@tekne/kb` from the studio's registry with that same secret, so `bun kb check` runs among the checks. They write the token to `$HOME/.npmrc`, which npm reads, and to `$XDG_CONFIG_HOME/.npmrc`, the only user npmrc Bun 1.3.14 reads when that variable is set, as GitHub's Ubuntu runner sets it. The repository is `tekne-studio/tekne-wf`, private.
