---
group: open
owner: Marlus
unblocks: any project whose docs, AGENTS.md and wf.config.ts stay out of its public repository, such as one with an open-source core
since: 2026-10-25
context:
  - spec.md#names-places-and-state
  - proposal.md#out-of-scope
---

# How does wf run a project whose docs stay out of its public repository?

wf runs on one repository: the main checkout is the git common dir's folder (`src/git.ts`), each agent works in a git worktree of it under `~/.herdr/worktrees/<repo>/` (`src/state.ts`), and ship merges one branch. A workspace repository holding the docs, with the project as a nested repository, leaves each agent half the work: a worktree of the project has no docs (kb looks for kb.config.ts only upwards), and a worktree of the workspace has no code (git carries no nested repository; a submodule arrives empty, and its commits sit on a branch ship never merges).

Options:

1. **wf takes a companion docs repository.** spawn opens a worktree in each with the same branch, ship gates and fast-forwards both, kb finds the docs in the companion worktree. This is the person's wish (2026-10-25). Costs: a decision and its code land in two commits in two repositories, the two deliveries are not atomic, and spawn, ship, close, status and resume each handle two worktrees.
2. **One private workspace repository with the project in a subfolder** (`project/`), wf and kb as they are. git-subtree ships with git (2.56.0 here). Each publish pushes `git subtree split --prefix=project --rejoin` to the public repository: the split drops the commits that touch only the docs, and `--rejoin` joins the two histories, so an outside contribution comes back by `git subtree pull --prefix=project <public> main` and the next publish is a fast-forward; without `--rejoin`, the pull refuses unrelated histories. The public history starts at the first commit that has the subfolder, so a project with a private past does its cleanup at the root and moves the code into the subfolder last. @tekne/wf and @tekne/kb live in the workspace's package.json, so the public package.json names no private registry. All of this checked on a scratch repository, 2026-10-25. Costs: prepare and the gates run inside the subfolder, each publish leaves a merge commit in the private history, the public commit ids differ from the private ones, and the messages of commits that touch the code go public.
3. **One private repository with everything at the root**, published through `git filter-repo --invert-paths --path docs/ ...`. filter-repo is a separate install, and package.json, which mixes the project's dependencies with @tekne/wf and @tekne/kb, needs a blob rewrite.

Recommendation: 2, with no change to wf; 1 when others commit to the public repository every day, so changes come back by subtree pull all the time.
