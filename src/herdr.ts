// The only file that runs herdr. Every call reads herdr's JSON and is echoed to
// stderr, so a step can be redone by hand, and a herdr change is fixed here and in
// contract/, nowhere else. Text is parsed in three places only (version, status,
// integration status); a screen is shown, never parsed.

/** The herdr versions this wf was tested with: `min` included, `below` excluded. */
export const HERDR_RANGE = { min: '0.9.3', below: '0.10.0' };

export class HerdrError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

export type Worktree = { path: string; branch: string | null; is_linked_worktree: boolean; open_workspace_id: string | null };
/** `agent` is absent when the pane holds none; `agent_status` reads `unknown` until herdr tells it. */
export type Pane = { pane_id: string; cwd: string | null; agent?: string | null; agent_status?: Agent['agent_status'] };
export type Agent = {
	name?: string | null;
	agent: string;
	pane_id: string;
	workspace_id: string;
	cwd: string;
	agent_status: 'idle' | 'working' | 'blocked' | 'done' | 'unknown';
	state_change_seq: number;
	/** the agent's own session; for Claude Code, `value` is its session id */
	agent_session?: { value?: string | null } | null;
};
export type Sound = 'none' | 'done' | 'request';

let echo = true;
/** Polling loops turn the echo off: a line every two seconds says nothing. */
export function setEcho(on: boolean): void {
	echo = on;
}

const bin = () => process.env.HERDR_BIN_PATH || 'herdr';

function shown(arg: string): string {
	const one = arg.length > 60 ? `${arg.slice(0, 57).replace(/\n/g, ' ')}…` : arg;
	return /^[\w@%+=:,./~-]+$/.test(one) ? one : `'${one.replace(/'/g, `'\\''`)}'`;
}

// `env: process.env` on every spawn in wf: without it, Bun hands a child the environment
// as it was at startup, and a variable set since (HERDR_BIN_PATH in the tests) is lost.
async function exec(args: string[]): Promise<{ code: number; out: string; err: string }> {
	if (echo) console.error(`→ herdr ${args.map(shown).join(' ')}`);
	const p = Bun.spawn([bin(), ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: process.env });
	const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
	return { code, out, err };
}

function json(text: string): any {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** herdr's JSON `result`; its `{"error":{"code","message"}}` becomes a HerdrError. */
async function call(args: string[]): Promise<any> {
	const { code, out, err } = await exec(args);
	if (code !== 0) {
		const e = json(err)?.error ?? json(out)?.error;
		if (e?.code) throw new HerdrError(e.code, e.message ?? e.code);
		throw new HerdrError('failed', (err || out).trim() || `herdr ${args[0]} exited with ${code}`);
	}
	return json(out)?.result ?? null;
}

/** Plain text output (screens, status), for commands with no JSON. */
async function text(args: string[]): Promise<string> {
	const { code, out, err } = await exec(args);
	if (code !== 0) {
		const e = json(err)?.error;
		throw new HerdrError(e?.code ?? 'failed', e?.message ?? ((err || out).trim() || `herdr ${args[0]} exited with ${code}`));
	}
	return out;
}

export async function installed(): Promise<boolean> {
	if (process.env.HERDR_BIN_PATH) return true;
	return Bun.which('herdr') !== null;
}

export async function version(): Promise<string> {
	const out = await text(['--version']);
	const v = out.match(/(\d+\.\d+\.\d+)/)?.[1];
	if (!v) throw new HerdrError('failed', `herdr --version printed no version: ${out.trim()}`);
	return v;
}

function cmp(a: string, b: string): number {
	const [x, y] = [a, b].map((v) => v.split('.').map(Number));
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
	return 0;
}

export function inRange(v: string): boolean {
	return cmp(v, HERDR_RANGE.min) >= 0 && cmp(v, HERDR_RANGE.below) < 0;
}

/** The running server answers and speaks this client's protocol. */
export async function serverCompatible(): Promise<boolean> {
	try {
		return /endpoint_compatible:\s*yes/.test(await text(['status']));
	} catch {
		return false;
	}
}

/** `<kind>: <state>` per line of `herdr integration status`; state is `current`, `outdated`, `not installed`… */
export async function integrations(): Promise<Record<string, string>> {
	const out = await text(['integration', 'status']);
	const states: Record<string, string> = {};
	for (const line of out.split('\n')) {
		const m = line.match(/^([\w-]+)(?: \([^)]*\))?:\s*(not installed|[\w-]+)/);
		if (m) states[m[1]] = m[2];
	}
	return states;
}

export async function worktreeList(cwd: string): Promise<Worktree[]> {
	return (await call(['worktree', 'list', '--cwd', cwd]))?.worktrees ?? [];
}

export async function worktreeCreate(o: { cwd: string; branch: string; base: string; path: string; label: string }): Promise<{ workspace: string; pane: string }> {
	const r = await call(['worktree', 'create', '--cwd', o.cwd, '--branch', o.branch, '--base', o.base, '--path', o.path, '--label', o.label, '--no-focus']);
	const workspace = r?.workspace?.workspace_id;
	const pane = r?.root_pane?.pane_id;
	if (!workspace || !pane) throw new HerdrError('failed', 'herdr worktree create returned no workspace or root pane');
	return { workspace, pane };
}

export async function worktreeRemove(workspace: string, force = false): Promise<void> {
	await call(['worktree', 'remove', '--workspace', workspace, ...(force ? ['--force'] : [])]);
}

/** One pane, with the folder its shell is in. */
export async function paneGet(pane: string): Promise<Pane> {
	const r = await call(['pane', 'get', pane]);
	if (!r?.pane?.pane_id) throw new HerdrError('failed', `herdr pane get ${pane} returned no pane`);
	return r.pane;
}

/** The pid of the shell herdr runs in a pane; closing the workspace ends it. */
export async function paneShell(pane: string): Promise<number | null> {
	const pid = (await call(['pane', 'process-info', '--pane', pane]))?.process_info?.shell_pid;
	return typeof pid === 'number' ? pid : null;
}

/**
 * Types a command line and Enter into the pane's shell. The command word stays bare, so an
 * alias the person keeps for it applies; every argument is single-quoted, so nothing in it
 * expands, in POSIX shells and fish alike.
 */
export async function paneRun(pane: string, command: string, args: string[]): Promise<void> {
	await call(['pane', 'run', pane, [command, ...args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`)].join(' ')]);
}

export async function paneList(workspace: string): Promise<Pane[]> {
	return (await call(['pane', 'list', '--workspace', workspace]))?.panes ?? [];
}

export async function agentList(): Promise<Agent[]> {
	return (await call(['agent', 'list']))?.agents ?? [];
}

export async function agentGet(target: string): Promise<Agent> {
	const r = await call(['agent', 'get', target]);
	if (!r?.agent?.pane_id) throw new HerdrError('failed', `herdr agent get ${target} returned no agent`);
	return r.agent;
}

/** Names the agent in a pane (herdr takes the pane as the target): the name follows that agent until it exits. */
export async function agentRename(target: string, name: string): Promise<void> {
	await call(['agent', 'rename', target, name]);
}

export async function agentStart(name: string, kind: string, pane: string, args: string[], timeoutMs = 60_000): Promise<void> {
	await call(['agent', 'start', name, '--kind', kind, '--pane', pane, '--timeout', String(timeoutMs), '--', ...args]);
}

/**
 * Types the text into the agent's input box, after whatever is there, and presses Enter.
 * Success means herdr wrote both, not that the agent took it: confirm by its state.
 */
export async function agentPrompt(target: string, message: string): Promise<void> {
	await call(['agent', 'prompt', target, message]);
}

export async function agentSendKeys(target: string, keys: string[]): Promise<void> {
	await call(['agent', 'send-keys', target, ...keys]);
}

export async function agentWait(target: string, until: string[], timeoutMs: number): Promise<void> {
	await call(['agent', 'wait', target, ...until.flatMap((u) => ['--until', u]), '--timeout', String(timeoutMs)]);
}

/** The agent's screen, for a person or a model to read. */
export async function agentRead(target: string, lines = 20): Promise<string> {
	return text(['agent', 'read', target, '--lines', String(lines)]);
}

/**
 * Shows a notification: true only when herdr answers that it showed it. herdr may answer
 * with nothing shown (`rate_limited`, `no_foreground_client`, `disabled`, `busy`); that and
 * a failed call are said on stderr and never stop the flow, so a call to the person that
 * did not go out is never told as made.
 */
export async function notify(title: string, body: string, sound: Sound = 'none'): Promise<boolean> {
	let why: string;
	try {
		const r = await call(['notification', 'show', title, '--body', body, '--sound', sound]);
		if (r?.shown === true) return true;
		why = r?.reason ?? 'herdr did not say why';
	} catch (e) {
		why = (e as Error).message;
	}
	console.error(`✗ herdr did not show the notification "${title}": ${why}`);
	return false;
}

export async function pluginIds(): Promise<string[]> {
	const r = await call(['plugin', 'list', '--json']);
	return (r?.plugins ?? []).map((p: { plugin_id: string }) => p.plugin_id).filter(Boolean);
}
