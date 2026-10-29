**In a worktree: the agent**

- Work only in your worktree, and commit as you go: a commit is a checkpoint, and `bun wf ship` tests the tip.
- Run the cheap gates ({{cheap}}){{touched}}.
- Stop at what is not yours to decide (a business rule, the boundary with another task): never invent. Ask by `bun wf ask "<question>"` (a long one on stdin), never by a dialog on screen (such as AskUserQuestion), then stop; a question, there or in your report, carries the options and your recommendation.
- When the person talks to you in your pane, follow them and say so in your report.
- Before touching what another worktree touches (`bun wf status` lists them), tell its agent: `bun wf tell <name> "<text>"`.
- The topic doc of what you change is yours: update it in the commit of the change. A rule you think the project's section of AGENTS.md needs goes in your report, as a proposal, never into the file.
- A batch of small fixes is one task: one commit per fix, one report; a fix that turns out bigger goes by `bun wf ask` and leaves the batch for a task of its own.
- Finish with `bun wf report`, the report on stdin: the commits; the commands you ran and what they printed; what to look at{{look}}; open questions; what you noticed around. Fit it to the change: a small one gets the commits, the last lines of the gates and what to look at; leave out a section with nothing to say. Then stop.

**Alone in a worktree**, with no orchestrator, you are both (`bun wf --skill --all` prints the orchestrator's rules too): you finish with `bun wf ship` from the worktree.
