**In the main checkout: the orchestrator**

- Split the work and open the agents without asking the person: `bun wf spawn <name> --task <file>`, tool upgrades too (a tool's handoff, such as kb's upgrade steps, becomes the task file). Never open a worktree by hand or edit in one.
- A task file names the doc sections the agent reads ({{find}}), so the agent needs no more than AGENTS.md and them.
- {{skip}}
- Only you write the project section of AGENTS.md, from an agent's proposal or the person's words: one line per rule, linking the doc section that explains it.
- Reach an agent by SendMessage to its name (`bun wf tell <name> "<text>"` when that misses its session), or `bun wf resume <name>` when it is gone. Never type into its pane.
- A {{tools}} upgrade waits until a round ships and no worktree is open; an improvement to a tool found during a round goes to its roadmap, for one release at the round's end.
- Small fixes go in batches of 2 to 4, in one task file for one agent. A fix is small when its cause and place are known and fit in one line, and it touches no business rule and nothing the project's section of AGENTS.md marks as sensitive.
- Keep `bun wf watch` running as your harness's own background command (in Claude Code, the Bash tool with `run_in_background`), and run `bun wf ship` the same way.
- Each return of `bun wf watch` rereads your whole conversation: keep it lean, and read a report narrowly.
- You are the person's filter: when what exists settles an agent's question ({{basis}}), answer it, naming the basis, and tell the person what you decided and why. {{record}}
- Bring to the person only a product question nothing settles, a permission, or anything destructive or outward (a push, a publish), and relay their answer.
- A dialog on an agent's screen (a tool permission, an approval) is the person's: never press it.
- A report is a claim: read the diff (`git diff {{integration}}...worktree/<name>`), whole when small, `--stat` and then one file at a time when large, and look at what changed on screen. Leave the gates to `bun wf ship`.
- A test that fails with no cause in the change goes to quarantine, never three reruns, and only with proof: it fails on `{{integration}}` without the change too, or passes alone and fails only under load. Then tell the agent to skip it and name it, with the proof, as an open question in its report, and ship again.
- `bun wf ship <name>` brings `{{integration}}` in, runs {{shipGates}}, fast-forwards `{{integration}}` and closes the worktree. `bun wf close <name>` abandons one; never close one by `$HERDR_WORKSPACE_ID`, which in the main checkout names its own workspace.
- After a round ships, or once this session has grown long, write what lives only in the conversation, such as an answer you gave an agent that should outlast it or a yes the person still owes, {{homes}}; then tell the person this session is ready to hand over (in Claude Code, `/clear`). The new session starts from `bun wf status`.
