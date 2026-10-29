### Parallel agents: wf

One orchestrator, a Claude Code session in the main checkout on `{{integration}}`, leads the agents. Each task, whoever brings it, gets its own worktree, branch and agent, in a herdr pane the person watches, and a follow-up on a task goes to its agent; never two agents in one working directory. Never merge, push or close a worktree from inside it: the orchestrator ships it. `bun wf` runs the flow; when `ask`, `tell` or `report` prints a SendMessage, send it. For the rest of herdr (layout, reading a screen, focus), use `herdr` (`herdr --skill`).

Before anything with wf (a spawn, a question, a report, a ship, a doubt about the flow), run `bun wf --skill`: it prints the rules for the checkout it runs in, the agent's in a worktree and the orchestrator's in the main checkout; `--all` prints both.
