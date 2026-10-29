---
title: herdr
group: Project
summary: What wf calls and reads of herdr, and the plugin herdr runs
order: 9
---

# herdr: the adapter and the plugin

## Adapter

- Every call runs `herdr <args>`, reads JSON from stdout, and turns `{"error":{"code","message"}}` on stderr (exit 1) into a `HerdrError` with the code. Every error stops the command, naming its code, except a notification's.
- Each call is echoed to stderr as `→ herdr …`, so a step can be redone by hand.
- Fields read: worktree list `path`, `branch`, `is_linked_worktree`, `open_workspace_id`; worktree create `workspace.workspace_id`, `root_pane.pane_id`; pane list `pane_id`, `agent`; pane get `pane.cwd`, `pane.agent`, `pane.agent_status`; pane process-info `process_info.shell_pid`; agent list `name`, `pane_id`, `workspace_id`, `cwd`, `agent`, `agent_status`, `state_change_seq`, `agent_session.value` (Claude Code's session id); agent get `agent` with the same fields; plugin list `plugins[].plugin_id`; notification show `shown` and `reason` (`rate_limited`, `no_foreground_client`, `disabled`, `busy`).
- A notification never stops the flow: `notify` is true only when herdr answers `shown`, and otherwise says on stderr why nothing was shown. Every command that calls the person says so only when herdr showed the call, and otherwise that the call did not go out.
- Tested range: `>=0.9.3 <0.10.0`, from `herdr --version`; `herdr status` must say `endpoint_compatible: yes`; `herdr integration status` gives `<kind>: <state>` per line. These three are the only text `wf` parses. A screen (`herdr agent read`) is shown, never parsed.
- `herdr worktree create` on a repository with no open workspace also opens one for the main checkout; `spawn` runs in the main checkout, whose workspace the orchestrator holds.

## Plugin

`herdr/herdr-plugin.toml`, id `tekne.wf`, with two events and the workspace action "wf: prepare". `herdr/plugin.ts` finds the repository's main checkout through the git common dir and acts only when it has `wf.config.ts`, with that checkout's `node_modules/.bin/wf` (a fresh worktree has no `node_modules` yet; wf's own repository runs its source):

| Event | Data herdr hands | What the plugin runs |
|---|---|---|
| `worktree.created` | `worktree.path` | `wf prepare --worktree <path> --notify` |
| `pane.agent_status_changed` (checked 2026-10-21; `pane_agent_status_changed` is unknown to plugins) | `pane_id`, `workspace_id`, `agent_status`, `agent` | for `blocked` only (a dialog on screen: for a wf agent, a permission): `herdr pane get` for the pane's folder, then `wf alert --pane <id>` |

Installed once per machine: `herdr plugin install tekne-studio/tekne-wf/herdr` once the GitHub repository exists; until then `herdr plugin link <clone>/herdr`.
