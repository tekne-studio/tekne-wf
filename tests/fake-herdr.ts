// A herdr for the tests, run through HERDR_BIN_PATH (tests/fake-herdr). Its state is a
// JSON file in $FAKE_HERDR; every call is appended to calls.jsonl there, so a test reads
// what wf asked herdr to do. Worktrees it creates are real git worktrees.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type FakeState = {
	version?: string;
	compatible?: boolean;
	integrations?: Record<string, string>;
	plugins?: string[];
	worktrees?: { path: string; branch: string; is_linked_worktree: boolean; open_workspace_id: string | null }[];
	agents?: Record<string, unknown>[];
	/**
	 * The agent stops at a dialog while starting (a trust or setup question): `agent start`
	 * answers agent_not_ready, and an agent run from its pane's shell reads `blocked`
	 */
	startBlocked?: boolean;
	/** An agent run from its pane's shell leaves the prompt among its arguments untaken: idle, its box empty */
	launchPromptIgnored?: boolean;
	screen?: string;
	next?: number;
	/** the shell pid of each pane, for `pane process-info` */
	shells?: Record<string, number>;
	/**
	 * The next this many Enters are lost, a prompt's own or `send-keys`: the text stays in
	 * the input box and herdr answers the prompt with success all the same, as Claude Code
	 * does now and then with a long paste.
	 */
	enterLost?: number;
	/**
	 * The next this many prompts are lost whole: neither the text nor its Enter reaches the
	 * input box, and herdr answers success, as Claude Code just started does now and then.
	 */
	promptLost?: number;
	/** herdr's answer to `notification show`: `shown`, or why it showed nothing */
	notification?: 'shown' | 'disabled' | 'rate_limited' | 'no_foreground_client' | 'busy';
	/** `worktree remove` takes this long after the agent leaves, as removing a big folder does */
	removeMs?: number;
	/** `agent list` fails, as with the server down */
	agentListFails?: boolean;
};

/**
 * Each agent may carry its input box (what sits typed in it), every prompt it received, and
 * the prompt among its arguments it takes once past a dialog.
 */
export type FakeAgent = Record<string, unknown> & { input?: string; submitted?: string[]; pending?: string };

const dir = process.env.FAKE_HERDR!;
const file = join(dir, 'state.json');
const state: FakeState = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(args) + '\n');

// whole or not at all: a watch may read the state while another call writes it
const save = () => {
	writeFileSync(`${file}.${process.pid}`, JSON.stringify(state, null, '\t'));
	renameSync(`${file}.${process.pid}`, file);
};
const ok = (result: unknown) => {
	console.log(JSON.stringify({ id: 'fake', result }));
	process.exit(0);
};
const err = (code: string, message = code) => {
	console.error(JSON.stringify({ error: { code, message }, id: 'fake' }));
	process.exit(1);
};
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
/** The words of a command line as wf quotes it: a bare command, then each argument in single quotes. */
const words = (line: string) => [...line.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replaceAll(`'\\''`, `'`) : m[2]));
const [a, b] = args;

if (a === '--version') {
	console.log(`herdr ${state.version ?? '0.9.3'}`);
	process.exit(0);
}
if (a === 'status') {
	console.log(`server:\n  status: running\n  endpoint_compatible: ${state.compatible === false ? 'no' : 'yes'}`);
	process.exit(0);
}
if (a === 'integration' && b === 'status') {
	for (const [k, v] of Object.entries(state.integrations ?? { claude: 'current (v10)' })) console.log(`${k}: ${v} (/x)`);
	process.exit(0);
}
if (a === 'plugin' && b === 'list') ok({ plugins: (state.plugins ?? []).map((plugin_id) => ({ plugin_id, enabled: true })) });
if (a === 'notification' && b === 'show') ok({ type: 'notification_show', shown: (state.notification ?? 'shown') === 'shown', reason: state.notification ?? 'shown' });
if (a === 'worktree' && b === 'list') ok({ worktrees: state.worktrees ?? [] });
if (a === 'worktree' && b === 'create') {
	const [cwd, branch, base, path] = [flag('--cwd')!, flag('--branch')!, flag('--base')!, flag('--path')!];
	const g = Bun.spawnSync(['git', '-C', cwd, 'worktree', 'add', '-q', '-b', branch, path, base], { stderr: 'pipe' });
	if (g.exitCode !== 0) err('worktree_create_failed', g.stderr.toString());
	const n = (state.next = (state.next ?? 0) + 1);
	const ws = `w${n}`;
	(state.worktrees ??= []).push({ path, branch, is_linked_worktree: true, open_workspace_id: ws });
	save();
	ok({ workspace: { workspace_id: ws }, root_pane: { pane_id: `${ws}:p1` } });
}
if (a === 'worktree' && b === 'remove') {
	const ws = flag('--workspace');
	const wt = state.worktrees?.find((w) => w.open_workspace_id === ws);
	if (!wt) err('workspace_not_found');
	// as herdr does: the panes close, ending the agent, then the folder goes, and a process
	// still writing in it makes that fail
	state.agents = (state.agents ?? []).filter((x) => x.workspace_id !== ws);
	save();
	if (state.removeMs) Bun.sleepSync(state.removeMs);
	if (existsSync(wt!.path)) {
		const common = Bun.spawnSync(['git', '-C', wt!.path, 'rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.toString().trim();
		const g = Bun.spawnSync(['git', '-C', dirname(common), 'worktree', 'remove', '--force', wt!.path], { stderr: 'pipe' });
		if (g.exitCode !== 0) err('worktree_remove_failed', g.stderr.toString());
	}
	state.worktrees = state.worktrees!.filter((w) => w !== wt);
	save();
	ok({ type: 'worktree_removed', workspace_id: ws, path: wt!.path, forced: args.includes('--force') });
}
if (a === 'pane' && b === 'get') {
	const id = args[2];
	const agent = state.agents?.find((x) => x.pane_id === id);
	const wt = state.worktrees?.find((w) => id.startsWith(`${w.open_workspace_id}:`));
	const cwd = (agent?.cwd as string | undefined) ?? wt?.path;
	if (!cwd) err('pane_not_found', `pane ${id} not found`);
	ok({ pane: { pane_id: id, cwd, agent_status: agent?.agent_status ?? 'unknown', ...(agent ? { agent: agent.agent } : {}) }, type: 'pane_info' });
}
// a command typed into a pane's shell: an agent's starts it there, unnamed, as herdr sees one
// the person starts by hand; a prompt after `--` is its first turn
if (a === 'pane' && b === 'run') {
	const pane = args[2];
	const [command, ...rest] = words(args[3]);
	const wt = state.worktrees?.find((w) => pane.startsWith(`${w.open_workspace_id}:`));
	const prompt = rest.includes('--') ? rest.at(-1) : undefined;
	const taken = prompt !== undefined && !state.startBlocked && !state.launchPromptIgnored;
	(state.agents ??= []).push({
		name: null,
		agent: command,
		pane_id: pane,
		workspace_id: pane.split(':')[0],
		cwd: wt?.path ?? '/',
		argv: rest,
		agent_status: state.startBlocked ? 'blocked' : taken ? 'working' : 'idle',
		state_change_seq: taken ? 2 : 1,
		...(taken ? { submitted: [prompt] } : {}),
		...(state.startBlocked && prompt !== undefined ? { pending: prompt } : {})
	});
	save();
	ok({ type: 'pane_run' });
}
if (a === 'pane' && b === 'process-info') {
	const pane = flag('--pane')!;
	ok({ process_info: { pane_id: pane, shell_pid: state.shells?.[pane] ?? 1, foreground_processes: [] }, type: 'pane_process_info' });
}
if (a === 'pane' && b === 'list') {
	const ws = flag('--workspace')!;
	const wt = state.worktrees?.find((w) => w.open_workspace_id === ws);
	const agent = state.agents?.find((x) => x.workspace_id === ws);
	ok({ panes: [{ pane_id: `${ws}:p1`, cwd: wt?.path ?? null, ...(agent ? { agent: agent.agent } : {}) }] });
}
if (a === 'agent' && b === 'list') state.agentListFails ? err('server_unavailable', 'herdr server is not running') : ok({ agents: state.agents ?? [] });
if (a === 'agent' && b === 'start') {
	const name = args[2];
	const pane = flag('--pane')!;
	const wt = state.worktrees?.find((w) => pane.startsWith(`${w.open_workspace_id}:`));
	(state.agents ??= []).push({
		name,
		agent: flag('--kind'),
		pane_id: pane,
		workspace_id: pane.split(':')[0],
		cwd: wt?.path ?? '/',
		agent_status: state.startBlocked ? 'blocked' : 'idle',
		state_change_seq: 1,
		agent_session: { agent: flag('--kind'), kind: 'id', source: 'herdr:claude', value: `session-${name}` }
	});
	save();
	if (state.startBlocked) err('agent_not_ready');
	ok({ type: 'agent_started' });
}
if (a === 'agent' && b === 'rename') {
	const [target, name] = [args[2], args[3]];
	const agent = state.agents?.find((x) => x.name === target || x.pane_id === target);
	if (!agent) err('agent_not_found', `agent target ${target} not found`);
	agent!.name = name;
	// the session herdr's hook reported, named after the agent so a test can record it
	agent!.agent_session ??= { agent: agent!.agent, kind: 'id', source: 'herdr:claude', value: `session-${name}` };
	save();
	ok({ agent, type: 'agent_info' });
}
if (a === 'agent' && ['prompt', 'wait', 'read', 'get', 'send-keys'].includes(b)) {
	const target = args[2];
	const agent = state.agents?.find((x) => x.name === target || x.pane_id === target) as FakeAgent | undefined;
	if (!agent) err('agent_not_found', `agent target ${target} not found`);
	if (b === 'read') {
		console.log(state.screen ?? 'the screen');
		process.exit(0);
	}
	if (b === 'get') ok({ agent, type: 'agent_info' });
	// herdr types into the input box, after whatever the person has typed there, then presses Enter
	const enter = () => {
		if (state.enterLost) state.enterLost--;
		else if (agent!.input) {
			(agent!.submitted ??= []).push(agent!.input);
			agent!.input = '';
			agent!.agent_status = 'working';
			agent!.state_change_seq = Number(agent!.state_change_seq ?? 0) + 1;
		}
	};
	if (b === 'prompt') {
		if (agent!.agent_status === 'blocked') err('agent_blocked');
		if (state.promptLost) state.promptLost--;
		else {
			agent!.input = (agent!.input ?? '') + args[3];
			enter();
		}
	}
	if (b === 'send-keys' && args.slice(3).includes('Enter')) enter();
	// past its dialog, the agent takes the prompt it was started with, if any
	if (b === 'wait' && agent!.agent_status === 'blocked') {
		if (agent!.pending) {
			(agent!.submitted ??= []).push(agent!.pending);
			delete agent!.pending;
			agent!.agent_status = 'working';
			agent!.state_change_seq = Number(agent!.state_change_seq ?? 0) + 1;
		} else agent!.agent_status = 'idle';
	}
	save();
	ok({ type: 'ok' });
}
err('unknown_command', `fake herdr: ${args.join(' ')}`);
