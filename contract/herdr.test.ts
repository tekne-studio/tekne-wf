// The contract with the installed herdr: every field src/herdr.ts reads, checked
// against the real thing. Run by hand after each herdr update (`bun run test:herdr`),
// from inside herdr. It opens a workspace for a temporary repository and one for its
// worktree, and one where Claude Code takes a turn, and closes all three.
import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentSession, sessionById } from '../src/claude';
import * as herdr from '../src/herdr';

const inside = process.env.HERDR_ENV === '1';
const it = inside ? test : test.skip;
if (!inside) console.warn('contract: skipped, run it from a herdr pane (HERDR_ENV=1)');

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wf-contract-')));
const repo = join(dir, 'repo');
const path = join(dir, 'worktree-probe');
// a detached worktree of this repository: Claude Code trusts it through the main checkout,
// so its agent starts with no trust question
const turnPath = join(dir, 'turn');
const self = Bun.spawnSync(['git', '-C', import.meta.dir, 'rev-parse', '--show-toplevel'], { stdout: 'pipe' }).stdout.toString().trim();
let turnWorkspace: string | undefined;
const herdrBin = process.env.HERDR_BIN_PATH || 'herdr';

async function sh(...cmd: string[]) {
	const p = Bun.spawn(cmd, { cwd: dir, stdout: 'ignore', stderr: 'inherit' });
	if ((await p.exited) !== 0) throw new Error(`${cmd.join(' ')} failed`);
}

/** herdr's JSON result, for the calls wf itself never makes (a workspace of its own, a state reported for a pane). */
function direct(...args: string[]): any {
	const p = Bun.spawnSync([herdrBin, ...args], { stdout: 'pipe', stderr: 'pipe' });
	if (p.exitCode !== 0) throw new Error(`herdr ${args.join(' ')}: ${p.stderr.toString()}`);
	const out = p.stdout.toString().trim();
	return out ? JSON.parse(out).result : null;
}

// Closing the main checkout's workspace with --group closes the worktree's too, even
// after a failed test; both are this test's own. Before the folder goes: herdr runs git there.
afterAll(async () => {
	const main = inside ? (await herdr.worktreeList(repo).catch(() => [])).find((w) => !w.is_linked_worktree) : undefined;
	if (main?.open_workspace_id) await Bun.spawn([herdrBin, 'workspace', 'close', main.open_workspace_id, '--group'], { stdout: 'ignore', stderr: 'ignore' }).exited;
	// closing the workspace ends its agent
	if (turnWorkspace) await Bun.spawn([herdrBin, 'workspace', 'close', turnWorkspace], { stdout: 'ignore', stderr: 'ignore' }).exited;
	await Bun.spawn(['git', '-C', self, 'worktree', 'remove', '--force', turnPath], { stdout: 'ignore', stderr: 'ignore' }).exited;
	rmSync(dir, { recursive: true, force: true });
});

it('the version is in the tested range and the server speaks this client', async () => {
	const v = await herdr.version();
	expect(herdr.inRange(v)).toBe(true);
	expect(await herdr.serverCompatible()).toBe(true);
});

it('integration status names claude', async () => {
	expect(Object.keys(await herdr.integrations())).toContain('claude');
});

it('plugin list names a plugin linked a moment ago', async () => {
	const plugin = join(dir, 'probe-plugin');
	mkdirSync(plugin);
	writeFileSync(
		join(plugin, 'herdr-plugin.toml'),
		'id = "wf.contract"\nname = "wf contract (temporary)"\nversion = "0.0.1"\nmin_herdr_version = "0.9.0"\ndescription = "Linked and unlinked by wf\'s contract test"\nplatforms = ["macos", "linux"]\n'
	);
	await sh(herdrBin, 'plugin', 'link', plugin);
	try {
		expect(await herdr.pluginIds()).toContain('wf.contract');
	} finally {
		await sh(herdrBin, 'plugin', 'unlink', 'wf.contract');
	}
	expect(await herdr.pluginIds()).not.toContain('wf.contract');
});

it('a worktree is created, listed with its workspace, and removed', async () => {
	await sh('git', 'init', '-q', '-b', 'main', repo);
	await sh('git', '-C', repo, '-c', 'user.email=wf@test', '-c', 'user.name=wf', 'commit', '-q', '--allow-empty', '-m', 'init');

	const { workspace, pane } = await herdr.worktreeCreate({ cwd: repo, branch: 'worktree/probe', base: 'main', path, label: 'wf-contract' });
	expect(workspace).toBeString();
	expect(pane).toBeString();

	const list = await herdr.worktreeList(repo);
	const linked = list.find((w) => w.is_linked_worktree);
	expect(linked?.path && realpathSync(linked.path)).toBe(path);
	expect(linked?.branch).toBe('worktree/probe');
	expect(linked?.open_workspace_id).toBe(workspace);

	const panes = await herdr.paneList(workspace);
	expect(panes.map((p) => p.pane_id)).toContain(pane);
	// a pane with no agent carries no `agent` field at all
	expect(panes[0].agent ?? null).toBeNull();
	expect(panes[0]).toHaveProperty('cwd');
	// the plugin finds a blocked agent's repository from its pane's folder
	const got = await herdr.paneGet(pane);
	expect(realpathSync(got.cwd!)).toBe(path);
	// spawn reads the pane until herdr tells its agent's state
	expect(got.agent ?? null).toBeNull();
	expect(got.agent_status).toBe('unknown');
	// spawn types the agent's command line into the pane's shell
	await herdr.paneRun(pane, 'true', ["it's"]);
	// closing spares the pane's shell, which herdr ends with the workspace
	expect(await herdr.paneShell(pane)).toBeNumber();

	await herdr.worktreeRemove(workspace);
	expect((await herdr.worktreeList(repo)).some((w) => w.is_linked_worktree)).toBe(false);
});

it('agent list carries the fields watch reads', async () => {
	// this test runs inside a herdr pane, so at least the agent running it is listed
	const agents = await herdr.agentList();
	expect(agents.length).toBeGreaterThan(0);
	for (const key of ['agent', 'pane_id', 'workspace_id', 'cwd', 'agent_status', 'state_change_seq']) expect(agents[0]).toHaveProperty(key);
});

it('agent get shows the agent running this test, with the session tell finds it by', async () => {
	const me = await herdr.agentGet(process.env.HERDR_PANE_ID!);
	expect(me.pane_id).toBe(process.env.HERDR_PANE_ID!);
	for (const key of ['agent', 'agent_status', 'state_change_seq']) expect(me).toHaveProperty(key);
	// spawn names the agent it started by its pane: here, the name it has already
	if (me.name) {
		await herdr.agentRename(process.env.HERDR_PANE_ID!, me.name);
		expect((await herdr.agentGet(me.name)).pane_id).toBe(process.env.HERDR_PANE_ID!);
	}
	if (me.agent !== 'claude') return;
	const id = me.agent_session?.value;
	expect(id).toBeString();
	// run by Claude Code, herdr's session id is the one Claude Code records for itself
	const session = currentSession();
	if (session) expect(sessionById(id!)?.pid).toBe(session.pid);
});

/**
 * The agent's states, sampled every 100 ms until `done` holds, one per change of state or
 * seq, the last the one `done` held for. A dialog fails the test, which answers none.
 */
async function follow(pane: string, done: (a: herdr.Agent) => boolean, ms: number): Promise<herdr.Agent[]> {
	const seen: herdr.Agent[] = [];
	herdr.setEcho(false);
	try {
		for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(100)) {
			const a = await herdr.agentGet(pane);
			if (a.agent_status === 'blocked') throw new Error(`the agent in pane ${pane} shows a dialog, which this test never answers: look at it; the workspace closes with the test`);
			const last = seen.at(-1);
			const moved = !last || last.agent_status !== a.agent_status || last.state_change_seq !== a.state_change_seq;
			if (done(a)) return moved ? [...seen, a] : [...seen.slice(0, -1), a];
			if (moved) seen.push(a);
		}
	} finally {
		herdr.setEcho(true);
	}
	throw new Error(`the agent in pane ${pane} did not get there within ${ms / 1000} s: ${seen.map((a) => `${a.agent_status} ${a.state_change_seq}`).join(', ')}`);
}

const stopped = (a: herdr.Agent) => a.agent_status === 'idle' || a.agent_status === 'done';

// watch reads a question's or a report's turn from herdr's state_change_seq (docs/watch.md)
it('a turn moves the agent once to working and once to done, on one counter for every pane; a session change leaves it', async () => {
	await sh('git', '-C', self, 'worktree', 'add', '-q', '--detach', turnPath, 'HEAD');
	turnWorkspace = direct('workspace', 'create', '--cwd', turnPath, '--label', 'wf-contract-turn', '--no-focus').workspace.workspace_id as string;
	const pane = (await herdr.paneList(turnWorkspace))[0].pane_id;
	const other = direct('pane', 'split', pane, '--direction', 'down', '--no-focus').pane.pane_id as string;
	// a small model with no tools and no MCP server: nothing to approve
	await herdr.paneRun(pane, 'claude', ['--model', 'haiku', '--tools', '', '--strict-mcp-config']);
	// herdr sees the agent first and tells its state a few seconds later, as spawn waits for it
	for (const end = Date.now() + 60_000; Date.now() < end; await Bun.sleep(500)) {
		const p = await herdr.paneGet(pane);
		if (p.agent && p.agent_status !== 'unknown') break;
	}
	const start = (await follow(pane, stopped, 60_000)).at(-1)!;

	// another pane's state change moves the counter the agent's state reads
	direct('pane', 'report-agent', other, '--source', 'wf:contract', '--agent', 'claude', '--state', 'working', '--seq', String(Date.now()));
	const between = (await herdr.agentGet(other)).state_change_seq;
	expect(between).toBeGreaterThan(start.state_change_seq);

	await herdr.agentPrompt(pane, 'Reply with the single word OK.');
	const turn = (await follow(pane, (a) => stopped(a) && a.state_change_seq > start.state_change_seq, 120_000)).filter((a) => a.state_change_seq > start.state_change_seq);
	expect(turn.map((a) => a.agent_status)).toEqual(['working', 'done']);
	const [working, done] = turn.map((a) => a.state_change_seq);
	expect(working).toBeGreaterThan(between);
	expect(done).toBeGreaterThan(working);

	// `/clear` starts a new session (herdr's Claude integration reports it): the agent stays stopped at the same seq
	const session = turn[1].agent_session?.value;
	expect(session).toBeString();
	await herdr.agentPrompt(pane, '/clear');
	const clearing = await follow(pane, (a) => !!a.agent_session?.value && a.agent_session.value !== session, 15_000);
	const seen = clearing.map((a) => `${a.agent_status} ${a.state_change_seq}`);
	expect(seen).toEqual(clearing.map((a) => `${stopped(a) ? a.agent_status : 'idle'} ${done}`));
}, 240_000);

it('a notification answers whether herdr showed it, and why not', async () => {
	// one silent notification on the person's screen
	const p = Bun.spawnSync([herdrBin, 'notification', 'show', 'wf contract', '--body', 'from `bun run test:herdr`; nothing to do', '--sound', 'none'], { stdout: 'pipe', stderr: 'pipe' });
	const r = JSON.parse(p.stdout.toString()).result;
	expect(r.shown).toBeBoolean();
	expect(['shown', 'disabled', 'rate_limited', 'no_foreground_client', 'busy']).toContain(r.reason);
});

it('an unknown agent is a HerdrError with its code', async () => {
	const e = await herdr.agentRead('wf-no-such-agent').catch((e) => e);
	expect(e).toBeInstanceOf(herdr.HerdrError);
	expect(e.code).toBe('agent_not_found');
	const keys = await herdr.agentSendKeys('wf-no-such-agent', ['Enter']).catch((e) => e);
	expect(keys).toBeInstanceOf(herdr.HerdrError);
	expect(keys.code).toBe('agent_not_found');
});
