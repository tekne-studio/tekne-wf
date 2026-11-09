---
group: open
owner: Marlus
unblocks: the next project with an open-source core, so it does not rediscover the layout
since: 2026-11-09
context:
  - questions/docs-out-of-the-public-repository.md
---

# Does wf document the private workspace with the public core in a subfolder, now that dam-workspace adopted it?

dam-workspace (tekne-studio) adopted option 2 of [docs-out-of-the-public-repository](./docs-out-of-the-public-repository.md) on 2026-11-09: one private repository with wf and kb at the root, the public core in `dam/`, published to `itsriodejaneiro/dam` by `git subtree split --prefix=dam --rejoin`, with wf and kb unchanged (its decision `workspace-privado-subtree`).

Two things were proposed for wf then and are not done: close that question with a decision for option 2, and write a short page in wf's docs with the layout (two `package.json` without Bun workspaces, two `.github/` folders, `prepare` and gates with `cd <core>`, publishing by a script the person runs, never wf, with no ship running because `--rejoin` commits on the integration branch).

Open: whether this still belongs in wf's docs, or whether dam-workspace's `docs/open-source.md` is the only home and wf just points at the pattern.
