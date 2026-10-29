// herdr plugin for wf, with the wf of each repository's main checkout (its version is the
// one the project's lockfile pins; a fresh worktree has no node_modules yet):
//
// - `worktree.created` (and the workspace action): `wf prepare --notify` in the worktree.
// - `pane.agent_status_changed` to blocked: `wf alert --pane <id>`, which calls the person
//   once an agent wf started has waited 8 s on an approval or a question.
//
// A repository without wf.config.ts is left alone: herdr fires both events for every
// repository. This file runs herdr only for what an event does not carry (the pane's
// folder); everything else goes through wf. Output lands in the plugin log:
// `herdr plugin log list --plugin tekne.wf`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const herdr = process.env.HERDR_BIN_PATH || 'herdr';
const event = JSON.parse(process.env.HERDR_PLUGIN_EVENT_JSON || 'null');
const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON || '{}');

function out(cmd: string[], cwd?: string): string {
	const p = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'ignore', env: process.env });
	return p.exitCode === 0 ? p.stdout.toString().trim() : '';
}

/** The wf that serves `dir`'s repository, or null when it does not use wf. */
function wfFor(dir: string): { main: string; wf: string[] } | null {
	const common = out(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], dir);
	const main = common && dirname(common);
	if (!main || !existsSync(join(main, 'wf.config.ts'))) return null;
	// wf's own repository runs its source; every other one, its installed wf
	const own = existsSync(join(main, 'package.json')) && JSON.parse(readFileSync(join(main, 'package.json'), 'utf8')).name === '@tekne/wf';
	return { main, wf: [join(main, own ? 'src/cli.ts' : 'node_modules/.bin/wf')] };
}

function run(wf: string[], args: string[], cwd: string): never {
	const r = Bun.spawnSync([...wf, ...args], { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
	process.exit(r.exitCode ?? 1);
}

if (event?.event === 'pane_agent_status_changed') {
	// every state change of every agent lands here: only blocked is wf's business
	if (event.data?.agent_status !== 'blocked') process.exit(0);
	const pane: string = event.data.pane_id;
	const cwd: string | undefined = JSON.parse(out([herdr, 'pane', 'get', pane]) || 'null')?.result?.pane?.cwd;
	const found = cwd && existsSync(cwd) ? wfFor(cwd) : null;
	if (!found || !existsSync(found.wf.at(-1)!)) process.exit(0);
	run(found.wf, ['alert', '--pane', pane], cwd!);
}

const target: string | undefined = event?.data?.worktree?.path ?? context.workspace_cwd;
if (!target || !existsSync(target)) {
	console.log('no worktree in the herdr context');
	process.exit(0);
}
const found = wfFor(target);
if (!found) {
	console.log(`${target}: not a wf repository, nothing to do`);
	process.exit(0);
}
if (!existsSync(found.wf.at(-1)!)) {
	Bun.spawnSync([herdr, 'notification', 'show', 'Worktree not prepared', '--body', `${target}: wf is not installed in ${found.main}; run bun install there`, '--sound', 'request'], { env: process.env });
	process.exit(1);
}
run(found.wf, ['prepare', '--worktree', target, '--notify'], target);
