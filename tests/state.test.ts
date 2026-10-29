import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkouts, linkedWorktrees } from '../src/git';
import { lock, slot } from '../src/lock';
import { State, checkName, nameFromBranch, readKeys, speaksFor, worktreePath, type Meta } from '../src/state';
import { repo, worktree } from './helpers';

let done = () => {};
afterEach(() => done());

test('names follow herdr agent names', () => {
	expect(checkName('dash')).toBeNull();
	expect(checkName('mail-port_2')).toBeNull();
	for (const bad of ['', 'Dash', '2fast', 'a b', 'x'.repeat(33)]) expect(checkName(bad)).toContain('is not a name');
});

test('the name comes from the branch, only for worktree/<name>', () => {
	expect(nameFromBranch('worktree/dash')).toBe('dash');
	expect(nameFromBranch('feat/dash')).toBeNull();
	expect(nameFromBranch('worktree/Not Valid')).toBeNull();
});

test('worktrees go where herdr puts them', () => {
	expect(worktreePath('/Users/x/Dev/its', 'dash')).toBe(join(homedir(), '.herdr/worktrees/its/worktree-dash'));
});

test('reads only the keys asked, unquoting values', () => {
	const dir = mkdtempSync(join(tmpdir(), 'wf-keys-'));
	done = () => rmSync(dir, { recursive: true, force: true });
	const file = join(dir, '.env.local');
	writeFileSync(file, '# ports\nAPP_URL=http://localhost:5203\nMAILPIT_URL="http://127.0.0.1:8203"\nSECRET=x\n');
	expect(readKeys(file, ['APP_URL', 'MAILPIT_URL', 'MISSING'])).toEqual({ APP_URL: 'http://localhost:5203', MAILPIT_URL: 'http://127.0.0.1:8203' });
	expect(readKeys(join(dir, 'none'), ['APP_URL'])).toEqual({});
});

test('checkouts tells the main checkout from a worktree, and lists worktrees by branch', async () => {
	const r = repo();
	done = r.done;
	const wt = worktree(r.main, 'dash');
	const fromMain = await checkouts(r.main);
	const fromWt = await checkouts(wt);
	expect(fromMain?.isMain).toBe(true);
	expect(fromWt?.isMain).toBe(false);
	expect(fromWt?.main).toBe(fromMain!.main);
	expect(fromWt?.root).toBe(wt);
	expect(await linkedWorktrees(r.main)).toEqual([{ path: wt, branch: 'worktree/dash' }]);
	expect(await checkouts(r.dir)).toBeNull();
});

test('state keeps meta, task and report, and forgets them together', async () => {
	const r = repo();
	done = r.done;
	const s = new State((await checkouts(r.main))!.commonDir);
	s.writeMeta('dash', { kind: 'claude', workspace: 'w1', pane: 'w1:p1', path: '/x', spawnedAt: 'a', sentAt: 'a' });
	s.touchSent('dash', 7, new Date(0));
	expect(s.meta('dash')?.sentAt).toBe(new Date(0).toISOString());
	expect(s.meta('dash')?.sentSeq).toBe(7);
	s.writeTask('dash', 'the task');
	expect(s.reportTime('dash')).toBe(0);
	s.writeReport('dash', 'done it', 'abc123');
	expect(s.reportTime('dash')).toBeGreaterThan(0);
	s.writeDelivered({ dash: { report: 1 }, other: {} });
	s.forget('dash');
	expect(s.meta('dash')).toBeNull();
	expect(s.delivered()).toEqual({ other: {} });
});

test('a watch speaks for the agents of the session that reads it, and of one gone; with no session, only for agents no session spawned', () => {
	const home = mkdtempSync(join(tmpdir(), 'wf-claude-'));
	const before = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = home;
	const sleeper = Bun.spawn(['sleep', '60']);
	done = () => {
		sleeper.kill();
		if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = before;
		rmSync(home, { recursive: true, force: true });
	};
	mkdirSync(join(home, 'sessions'));
	const live = (pid: number, sessionId: string) => writeFileSync(join(home, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, name: sessionId }));
	const orch = { name: 'orch', sessionId: 's-orch', pid: process.pid };
	const other = { name: 'other', sessionId: 's-other', pid: sleeper.pid };
	const gone = { name: 'gone', sessionId: 's-gone', pid: Bun.spawnSync(['true']).pid };
	live(orch.pid, orch.sessionId);
	live(other.pid, other.sessionId);
	const watch = (orchestrator?: typeof orch) => ({ pid: 1, startedAt: 'a', orchestrator });
	const meta = (orchestrator?: typeof orch): Meta => ({ kind: 'claude', workspace: 'w1', pane: 'w1:p1', path: '/x', spawnedAt: 'a', sentAt: 'a', orchestrator });

	expect(speaksFor(watch(orch), meta(orch))).toBe(true);
	// spawned from a terminal, or by a session that handed over: the watch's reader is the orchestrator
	expect(speaksFor(watch(orch), meta())).toBe(true);
	expect(speaksFor(watch(orch), meta(gone))).toBe(true);
	// another live session's agent: its message carries the event
	expect(speaksFor(watch(other), meta(orch))).toBe(false);
	// a watch whose session ended reaches nobody
	expect(speaksFor(watch(gone), meta(gone))).toBe(false);
	// from a terminal: only agents no session spawned (another harness's orchestrator, or the person's terminal)
	expect(speaksFor(watch(), meta(orch))).toBe(false);
	expect(speaksFor(watch(), meta())).toBe(true);
	// `/clear`: a new session in the same process still reads its watch
	live(orch.pid, 's-cleared');
	expect(speaksFor(watch(orch), meta(orch))).toBe(true);
});

test('the lock waits for its holder and discards a dead one', async () => {
	const r = repo();
	done = r.done;
	const common = (await checkouts(r.main))!.commonDir;
	const release = await lock(common, 'ship', 'ship');
	let second = false;
	const waiting = lock(common, 'ship', 'ship').then((rel) => {
		second = true;
		rel();
	});
	await Bun.sleep(400);
	expect(second).toBe(false);
	release();
	await waiting;
	expect(second).toBe(true);

	writeFileSync(join(common, 'wf', 'ship.lock'), '999999');
	(await lock(common, 'ship', 'ship'))();
});

test('the machine places: as many holders as places, the next waits, a dead holder is discarded', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'wf-places-'));
	done = () => rmSync(dir, { recursive: true, force: true });
	const a = await slot(dir, 'g', 2, 'a');
	const b = await slot(dir, 'g', 2, 'b');
	let third = false;
	const waiting = slot(dir, 'g', 2, 'c').then((rel) => {
		third = true;
		rel();
	});
	await Bun.sleep(700);
	expect(third).toBe(false);
	b();
	await waiting;
	expect(third).toBe(true);
	a();

	writeFileSync(join(dir, 'g-0.lock'), '999999 gone');
	(await slot(dir, 'g', 1, 'd'))();
});
