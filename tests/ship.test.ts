import { afterEach, expect, spyOn, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve, type Config } from '../src/config';
import { WfError } from '../src/context';
import { checkouts } from '../src/git';
import { closeWorktree, docsOnly, ship, watched } from '../src/ship';
import { State } from '../src/state';
import { slot } from '../src/lock';
import { commit, fakeHerdr, git, repo, worktree, write, writer } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

/** A main checkout on dev, a worktree `dash` with one commit (of `files`), and the fake herdr. */
async function setup(o: { herdr?: Parameters<typeof fakeHerdr>[0]; files?: Record<string, string> } = {}) {
	const r = repo('dev', { 'a.txt': 'a\n' });
	cleanups.push(r.done);
	const h = fakeHerdr(o.herdr);
	cleanups.push(h.done);
	const wt = worktree(r.main, 'dash');
	commit(wt, 'feat: dash', o.files ?? { 'dash.txt': 'dash\n' });
	const c = (await checkouts(wt))!;
	const run = (config: Config, extra: { dryRun?: boolean; fromMain?: boolean; queued?: boolean } = {}) =>
		ship({ root: wt, main: c.main, commonDir: c.commonDir, config: resolve(config), state: new State(c.commonDir), name: 'dash', dryRun: !!extra.dryRun, fromMain: !!extra.fromMain, queued: extra.queued });
	return { ...r, wt, h, c, run, head: (ref: string) => git(r.main, 'rev-parse', ref) };
}

async function refused(p: Promise<unknown>): Promise<string> {
	const e = await p.then(
		() => null,
		(e) => e
	);
	expect(e).toBeInstanceOf(WfError);
	return (e as Error).message;
}

test('delivers: dev fast-forwards to the tested commit, the branch goes, the worktree closes', async () => {
	const s = await setup();
	const state = new State(s.c.commonDir);
	state.writeMeta('dash', { kind: 'claude', workspace: 'w1', pane: 'w1:p1', path: s.wt, spawnedAt: '', sentAt: '' });
	await s.run({ integration: 'dev', gates: { cheap: ['true'], expensive: ['true'] } });
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('feat: dash');
	expect(git(s.main, 'branch', '--list', 'worktree/dash')).toBe('');
	expect(existsSync(s.wt)).toBe(false);
	expect(state.meta('dash')).toBeNull();
});

test('a process left running in the worktree is stopped before the worktree goes', async () => {
	const s = await setup();
	commit(s.wt, 'chore: ignore pb_data', { '.gitignore': 'pb_data/\n' });
	const server = writer(s.wt);
	cleanups.push(server.stop);
	await s.run({ integration: 'dev' });
	expect(server.alive()).toBe(false);
	expect(existsSync(s.wt)).toBe(false);
});

test('close runs in the worktree once what ran there has stopped, and then the worktree goes', async () => {
	const s = await setup();
	commit(s.wt, 'chore: ignore pb_data', { '.gitignore': 'pb_data/\n' });
	const server = writer(s.wt);
	cleanups.push(server.stop);
	const seen = join(s.dir, 'close.txt');
	await closeWorktree(s.wt, s.main, false, `{ pwd; kill -0 ${server.pid} 2>/dev/null && echo running || echo stopped; } > ${seen}`, 'bun wf close dash');
	expect(readFileSync(seen, 'utf8')).toBe(`${s.wt}\nstopped\n`);
	expect(existsSync(s.wt)).toBe(false);
});

test('a close that fails keeps the worktree and names what to run', async () => {
	const s = await setup();
	const message = await refused(closeWorktree(s.wt, s.main, false, 'exit 3', 'bun wf close dash'));
	expect(message).toContain(`run \`exit 3\` in ${s.wt}, then \`bun wf close dash\``);
	expect(existsSync(s.wt)).toBe(true);
});

test('with force, a close that fails is printed and the worktree goes anyway', async () => {
	const s = await setup();
	const log = spyOn(console, 'log');
	cleanups.push(() => log.mockRestore());
	await closeWorktree(s.wt, s.main, true, 'exit 3', 'bun wf close dash');
	expect(log.mock.calls.flat().join('\n')).toContain('✗ exit 3 failed; --force removes the worktree anyway');
	expect(existsSync(s.wt)).toBe(false);
});

test('ship runs close on the worktree\'s branch, after the fast-forward', async () => {
	const s = await setup();
	const seen = join(s.dir, 'close.txt');
	await s.run({ integration: 'dev', close: `{ git branch --show-current; git log -1 --format=%s dev; } > ${seen}` });
	expect(readFileSync(seen, 'utf8')).toBe('worktree/dash\nfeat: dash\n');
	expect(git(s.main, 'branch', '--list', 'worktree/dash')).toBe('');
	expect(existsSync(s.wt)).toBe(false);
});

test('a close that fails after the delivery says it is delivered, and leaves the worktree on its branch', async () => {
	const s = await setup();
	const message = await refused(s.run({ integration: 'dev', close: 'exit 3' }));
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('feat: dash');
	expect(message).toContain(`dev is already at ${s.head('dev').slice(0, 9)}, but exit 3 failed`);
	expect(message).toContain(`run \`exit 3\` in ${s.wt}, then \`bun wf close dash --delete-branch\``);
	expect(existsSync(s.wt)).toBe(true);
	expect(git(s.wt, 'branch', '--show-current')).toBe('worktree/dash');
});

const WATCHED = ['bun.lock', '**/package.json'];

/** What `console.log` (or `console.error`) printed, from here to the end of the test. */
function printed(stream: 'log' | 'error' = 'log'): () => string {
	const spy = spyOn(console, stream);
	cleanups.push(() => spy.mockRestore());
	return () => spy.mock.calls.flat().join('\n');
}

test('refresh watches the lockfile at the root and a package.json at any depth', () => {
	expect(watched(['package.json', 'apps/web/package.json', 'bun.lock', 'apps/bun.lock', 'src/x.ts'], WATCHED)).toEqual(['package.json', 'apps/web/package.json', 'bun.lock']);
	expect(watched(['src/x.ts', 'README.md'], WATCHED)).toEqual([]);
});

test('a ship whose delivery changes a watched file runs refresh in the main checkout, under the ship lock and before the close, and leaves it clean', async () => {
	const s = await setup({ files: { 'bun.lock': 'lock\n', 'dash.txt': 'dash\n' } });
	// outside the repository: the refresh leaves the main checkout as git has it
	const seen = join(s.dir, 'refresh.txt');
	const held = join(s.c.commonDir, 'wf', 'ship.lock');
	const out = printed();
	const run = `{ pwd; git log -1 --format=%s; grep -q '^${process.pid} ' ${held} && echo locked; test -d ${s.wt} && echo open; } > ${seen}`;
	await s.run({ integration: 'dev', refresh: { when: WATCHED, run } });
	expect(readFileSync(seen, 'utf8')).toBe(`${s.main}\nfeat: dash\nlocked\nopen\n`);
	expect(out()).toContain(`▶ ${run} (in the main checkout, ${s.main}: the delivery changed \`bun.lock\`)`);
	expect(git(s.main, 'status', '--porcelain')).toBe('');
	expect(existsSync(held)).toBe(false);
	expect(existsSync(s.wt)).toBe(false);
});

test('a ship whose delivery changes no watched file runs no refresh and prints none', async () => {
	const s = await setup();
	const seen = join(s.dir, 'refresh.txt');
	const out = printed();
	await s.run({ integration: 'dev', refresh: { when: WATCHED, run: `touch ${seen}` } });
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('feat: dash');
	expect(existsSync(seen)).toBe(false);
	expect(out()).not.toContain(seen);
});

test('one of a queue leaves the refresh to the queue', async () => {
	const s = await setup({ files: { 'bun.lock': 'lock\n' } });
	const seen = join(s.dir, 'refresh.txt');
	await s.run({ integration: 'dev', refresh: { when: WATCHED, run: `touch ${seen}` } }, { queued: true });
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('feat: dash');
	expect(existsSync(seen)).toBe(false);
});

test('a refresh that fails leaves the delivery done and the worktree closed, and names the command to run', async () => {
	const s = await setup({ files: { 'package.json': '{}\n' } });
	const tip = s.head('worktree/dash');
	const err = printed('error');
	const message = await refused(s.run({ integration: 'dev', refresh: { when: WATCHED, run: 'exit 3' } }));
	expect(message).toBe(`dev is at ${tip.slice(0, 9)} and the delivery is done, but \`exit 3\` failed in the main checkout: run \`cd ${s.main} && exit 3\``);
	// said at once too, before the close: removing the workspace can end the ship
	expect(err()).toContain(`✗ ${message}`);
	expect(s.head('dev')).toBe(tip);
	expect(git(s.main, 'branch', '--list', 'worktree/dash')).toBe('');
	expect(existsSync(s.wt)).toBe(false);
});

test('a refresh that leaves changes in the main checkout fails too, naming them', async () => {
	const s = await setup({ files: { 'bun.lock': 'lock\n' } });
	const message = await refused(s.run({ integration: 'dev', refresh: { when: WATCHED, run: 'echo more >> bun.lock' } }));
	expect(message).toContain(`but \`echo more >> bun.lock\` left changes in the main checkout: run \`cd ${s.main} && echo more >> bun.lock\``);
	expect(message).toContain('left changed there, which the next ship refuses:\n   M bun.lock');
	expect(existsSync(s.wt)).toBe(false);
});

test('a close that fails after a refresh that failed says both', async () => {
	const s = await setup({ files: { 'bun.lock': 'lock\n' } });
	const message = await refused(s.run({ integration: 'dev', close: 'exit 4', refresh: { when: WATCHED, run: 'exit 3' } }));
	expect(message).toContain(`run \`exit 4\` in ${s.wt}, then \`bun wf close dash --delete-branch\``);
	expect(message).toContain(`but \`exit 3\` failed in the main checkout: run \`cd ${s.main} && exit 3\``);
	expect(existsSync(s.wt)).toBe(true);
});

test('closes through herdr when a workspace is open on the worktree, found by path', async () => {
	const r = repo('dev');
	cleanups.push(r.done);
	const wt = worktree(r.main, 'dash');
	commit(wt, 'feat: dash');
	const h = fakeHerdr({ worktrees: [{ path: wt, branch: 'worktree/dash', is_linked_worktree: true, open_workspace_id: 'w7' }] });
	cleanups.push(h.done);
	const c = (await checkouts(wt))!;
	await ship({ root: wt, main: c.main, commonDir: c.commonDir, config: resolve({ integration: 'dev' }), state: new State(c.commonDir), name: 'dash', dryRun: false, fromMain: true });
	expect(h.calls()).toContainEqual(['worktree', 'remove', '--workspace', 'w7']);
});

test('refuses a dirty worktree, and a main checkout off dev or dirty', async () => {
	const s = await setup();
	write(s.wt, 'loose.txt', 'x');
	expect(await refused(s.run({ integration: 'dev' }))).toContain('uncommitted changes');
	git(s.wt, 'add', '-A');
	git(s.wt, 'commit', '-q', '-m', 'chore: loose');

	git(s.main, 'switch', '-q', '-c', 'other');
	expect(await refused(s.run({ integration: 'dev' }))).toContain('is on other, not on dev');
	git(s.main, 'switch', '-q', 'dev');

	write(s.main, 'wip.txt', 'x');
	const dirty = await refused(s.run({ integration: 'dev' }));
	expect(dirty).toContain('still there after 5s; someone may be working there');
	expect(dirty).toContain('?? wip.txt');
}, 20_000);

test('a main checkout dirty for a moment (a build\'s temporary files) is looked at again, not refused', async () => {
	const s = await setup();
	write(s.main, '.docs-build.tmp', 'x');
	setTimeout(() => rmSync(join(s.main, '.docs-build.tmp')), 1500);
	await s.run({ integration: 'dev' });
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('feat: dash');
}, 20_000);

test('refuses a branch with nothing to deliver, and a merge in progress', async () => {
	const r = repo('dev');
	cleanups.push(r.done);
	const h = fakeHerdr();
	cleanups.push(h.done);
	const wt = worktree(r.main, 'idle');
	const c = (await checkouts(wt))!;
	const run = () => ship({ root: wt, main: c.main, commonDir: c.commonDir, config: resolve({ integration: 'dev' }), state: new State(c.commonDir), name: 'idle', dryRun: false, fromMain: false });
	expect(await refused(run())).toContain('nothing to deliver');
	writeFileSync(join(c.commonDir, 'worktrees', 'worktree-idle', 'MERGE_HEAD'), git(r.main, 'rev-parse', 'dev') + '\n');
	expect(await refused(run())).toContain('a merge is in progress');
});

test('from the main checkout, refuses while the agent is working', async () => {
	const s = await setup();
	s.h.set({ agents: [{ name: 'dash', agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: s.wt, agent_status: 'working', state_change_seq: 3 }] });
	expect(await refused(s.run({ integration: 'dev' }, { fromMain: true }))).toContain('is still working');
});

/** dash's agent working in the worktree, its task sent ten minutes ago. */
function working(s: Awaited<ReturnType<typeof setup>>, status = 'working') {
	s.h.set({ agents: [{ name: 'dash', agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: s.wt, agent_status: status, state_change_seq: 3 }] });
	const state = new State(s.c.commonDir);
	state.writeMeta('dash', { kind: 'claude', workspace: 'w1', pane: 'w1:p1', path: s.wt, spawnedAt: '', sentAt: new Date(Date.now() - 600_000).toISOString() });
	return state;
}

test('from the main checkout, an agent that stops a few seconds after its report ships without a retry', async () => {
	const s = await setup();
	// reported in the turn it is still working in
	working(s).writeReport('dash', 'done', 'abc', new Date(), 3);
	const log = spyOn(console, 'log');
	cleanups.push(() => log.mockRestore());
	setTimeout(() => working(s, 'done'), 1500);
	await s.run({ integration: 'dev' }, { fromMain: true });
	expect(log.mock.calls.flat().join('\n')).toMatch(/the agent reported \d+s ago and is still working; waiting up to [\dm]+s for its turn to end/);
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('feat: dash');
}, 15_000);

test('from the main checkout, an agent still working a minute after its report is refused', async () => {
	const s = await setup();
	const state = working(s);
	const at = new Date(Date.now() - 58_000);
	state.writeReport('dash', 'done', 'abc', at);
	utimesSync(state.reportPath('dash'), at, at);
	const t0 = Date.now();
	expect(await refused(s.run({ integration: 'dev' }, { fromMain: true }))).toMatch(/is still working \(pane w1:p1\), its report \d+[sm] ago; look at its pane, or ask it to stop by `bun wf tell dash`/);
	expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
	expect(git(s.main, 'branch', '--list', 'worktree/dash')).toContain('worktree/dash');
}, 15_000);

test('from the main checkout, a prompt, a question or a turn after the report waits for nothing', async () => {
	const s = await setup();
	const state = working(s);
	const log = spyOn(console, 'log');
	cleanups.push(() => log.mockRestore());
	// reported at 1, stopped at 2 as the watch saw: working at 3 is a turn after it, answered with no tell
	state.writeReport('dash', 'done', 'abc', new Date(Date.now() - 5000), 1);
	state.writeDelivered({ dash: { stops: { 1: 2 } } });
	utimesSync(state.reportPath('dash'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
	expect(await refused(s.run({ integration: 'dev' }, { fromMain: true }))).toContain('is still working (pane w1:p1); wait for its report');
	state.writeReport('dash', 'done', 'abc', new Date(Date.now() - 5000));
	utimesSync(state.reportPath('dash'), new Date(Date.now() - 5000), new Date(Date.now() - 5000));
	state.writeQuestion('dash', { question: 'which?', at: new Date().toISOString(), to: 'orchestrator' });
	expect(await refused(s.run({ integration: 'dev' }, { fromMain: true }))).toContain('is still working (pane w1:p1); wait for its report');
	state.touchSent('dash');
	expect(await refused(s.run({ integration: 'dev' }, { fromMain: true }))).toContain('is still working (pane w1:p1); wait for its report');
	expect(log.mock.calls.flat().join('\n')).not.toContain('waiting up to');
});

test('the gates run cheap first, in order; the first that fails stops them, and dev stays where it was', async () => {
	const s = await setup();
	const before = s.head('dev');
	const ran = join(s.dir, 'ran');
	const gate = (name: string, ok = true) => `echo ${name} >> ${ran}${ok ? '' : ' && false'}`;
	await s.run({ integration: 'dev', gates: { expensive: [gate('e1'), gate('e2')], cheap: [gate('c1'), gate('c2')] } }, { dryRun: true });
	expect(readFileSync(ran, 'utf8')).toBe('c1\nc2\ne1\ne2\n');
	rmSync(ran);
	expect(await refused(s.run({ integration: 'dev', gates: { cheap: [gate('c1'), gate('c2', false), gate('c3')], expensive: [gate('e1')] } }))).toContain(`${gate('c2', false)} failed`);
	expect(readFileSync(ran, 'utf8')).toBe('c1\nc2\n');
	expect(s.head('dev')).toBe(before);
});

test('docs only: every changed file matches one of the globs, and there is a file', () => {
	const docs = ['docs/**', '**/*.md'];
	expect(docsOnly(['README.md', 'docs/a/b.png', 'src/x/notes.md'], docs)).toBe(true);
	expect(docsOnly(['docs/spec.md', 'src/ship.ts'], docs)).toBe(false);
	expect(docsOnly(['README.md'], [])).toBe(false);
	expect(docsOnly([], docs)).toBe(false);
});

test('a diff only in the docs runs the cheap gates alone, and says why', async () => {
	const s = await setup({ files: { 'docs/spec.md': 'spec\n', 'README.md': 'readme\n' } });
	const ran = join(s.dir, 'ran');
	const log = spyOn(console, 'log');
	cleanups.push(() => log.mockRestore());
	await s.run({ integration: 'dev', docsOnly: ['docs/**', '**/*.md'], gates: { cheap: [`echo c >> ${ran}`], expensive: [`echo e >> ${ran}`] } });
	expect(readFileSync(ran, 'utf8')).toBe('c\n');
	expect(log.mock.calls.flat().join('\n')).toContain('docs only: every changed file (2) matches docsOnly (`docs/**`, `**/*.md`), so the cheap gates run and the expensive ones (`echo e >> ' + ran + '`) stay out');
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('feat: dash');
});

test('one file outside the docs, or no docsOnly, runs every gate', async () => {
	const gates = (ran: string) => ({ cheap: [`echo c >> ${ran}`], expensive: [`echo e >> ${ran}`] });
	const mixed = await setup({ files: { 'docs/spec.md': 'spec\n', 'src/x.ts': 'x\n' } });
	const ran = join(mixed.dir, 'ran');
	await mixed.run({ integration: 'dev', docsOnly: ['docs/**'], gates: gates(ran) }, { dryRun: true });
	expect(readFileSync(ran, 'utf8')).toBe('c\ne\n');
	for (const docs of [undefined, []]) {
		const s = await setup({ files: { 'docs/spec.md': 'spec\n' } });
		const ran = join(s.dir, 'ran');
		await s.run({ integration: 'dev', ...(docs ? { docsOnly: docs } : {}), gates: gates(ran) }, { dryRun: true });
		expect(readFileSync(ran, 'utf8')).toBe('c\ne\n');
	}
});

test('a conflict with dev stops and asks for a resolution', async () => {
	const s = await setup();
	commit(s.main, 'feat: a on dev', { 'a.txt': 'dev\n' });
	commit(s.wt, 'feat: a on dash', { 'a.txt': 'dash\n' });
	expect(await refused(s.run({ integration: 'dev' }))).toContain('conflict bringing dev in');
});

test('dev moving during the gates brings it in again before the fast-forward', async () => {
	const s = await setup();
	const mark = join(s.dir, 'moved');
	// the first run of the gate commits to dev in the main checkout, as another delivery would
	const gate = `[ -f ${mark} ] || { touch ${mark}; git -C ${s.main} -c user.email=x@x -c user.name=x commit -q --allow-empty -m 'feat: elsewhere'; }`;
	await s.run({ integration: 'dev', gates: { cheap: [gate] } });
	const log = git(s.main, 'log', '--format=%s', 'dev');
	expect(log).toContain('feat: elsewhere');
	expect(log).toContain('feat: dash');
});

test('a commit in the worktree during the gates runs them again', async () => {
	const s = await setup();
	const mark = join(s.dir, 'committed');
	const gate = `[ -f ${mark} ] || { touch ${mark}; git -c user.email=x@x -c user.name=x commit -q --allow-empty -m 'fix: late'; }`;
	await s.run({ integration: 'dev', gates: { cheap: [gate] } });
	expect(git(s.main, 'log', '--format=%s', 'dev')).toContain('fix: late');
});

test('gates that leave files behind stop it', async () => {
	const s = await setup();
	expect(await refused(s.run({ integration: 'dev', gates: { cheap: ['touch junk.txt'] } }))).toContain('the gates left changes');
});

test('prepare runs after the merge, in the worktree', async () => {
	const s = await setup();
	const mark = join(s.dir, 'prepared');
	await s.run({ integration: 'dev', prepare: `pwd > ${mark}` });
	expect(require('node:fs').readFileSync(mark, 'utf8').trim()).toBe(s.wt);
});

test('prepare runs under the prepare lock, as `wf prepare` does', async () => {
	const s = await setup();
	const held = join(s.c.commonDir, 'wf', 'prepare.lock');
	const mark = join(s.dir, 'prepared');
	await s.run({ integration: 'dev', prepare: `grep -q '^${process.pid} ' ${held} && echo held > ${mark}` });
	expect(readFileSync(mark, 'utf8')).toBe('held\n');
	expect(existsSync(held)).toBe(false);
});

test('an expensive gate runs in one of the machine\'s places; cheap gates take none', async () => {
	const s = await setup();
	const place = join(process.env.WF_STATE_DIR!, 'expensive-gate-0.lock');
	const seen = join(s.dir, 'seen');
	await s.run({ integration: 'dev', gates: { cheap: [`test ! -e ${place} && echo cheap >> ${seen}`], expensive: [`grep -q 'main dash: ' ${place} && echo expensive >> ${seen}`] } });
	expect(require('node:fs').readFileSync(seen, 'utf8')).toBe('cheap\nexpensive\n');
	expect(existsSync(place)).toBe(false);
});

test('dev moving while ship waits for a place is brought in before the expensive gate runs', async () => {
	const s = await setup();
	process.env.WF_GATE_SLOTS = '1';
	cleanups.push(() => delete process.env.WF_GATE_SLOTS);
	const held = await slot(process.env.WF_STATE_DIR!, 'expensive-gate', 1, 'another repository: e2e');
	const runs = join(s.dir, 'runs');
	const shipping = s.run({ integration: 'dev', gates: { expensive: [`echo run >> ${runs}`] } });
	await Bun.sleep(800);
	commit(s.main, 'feat: elsewhere');
	held();
	await shipping;
	const log = git(s.main, 'log', '--format=%s', 'dev');
	expect(log).toContain('feat: elsewhere');
	expect(log).toContain('feat: dash');
	// once, after dev came in: never spent on the stale merge
	expect(require('node:fs').readFileSync(runs, 'utf8')).toBe('run\n');
});

test('interrupting ship ends the gate\'s whole process group', async () => {
	const s = await setup();
	write(s.wt, 'wf.config.ts', `export default { integration: 'dev', gates: { cheap: ['sleep 60 & echo $! > ${join(s.dir, 'child')}; wait'] } };\n`);
	commit(s.wt, 'chore: config');
	const p = Bun.spawn(['bun', join(import.meta.dir, '../src/cli.ts'), 'ship'], { cwd: s.wt, env: process.env, stdout: 'pipe', stderr: 'pipe' });
	const child = join(s.dir, 'child');
	for (const end = Date.now() + 10_000; !(existsSync(child) && require('node:fs').readFileSync(child, 'utf8').trim()) && Date.now() < end; ) await Bun.sleep(50);
	const pid = Number(require('node:fs').readFileSync(child, 'utf8'));
	p.kill('SIGTERM');
	expect(await p.exited).toBe(143);
	await Bun.sleep(300);
	expect(() => process.kill(pid, 0)).toThrow();
}, 20_000);

test('--dry-run runs it all but the fast-forward and the close', async () => {
	const s = await setup();
	const before = s.head('dev');
	await s.run({ integration: 'dev', close: 'exit 3', gates: { cheap: ['true'] } }, { dryRun: true });
	expect(s.head('dev')).toBe(before);
	expect(existsSync(s.wt)).toBe(true);
	expect(git(s.main, 'branch', '--list', 'worktree/dash')).toContain('worktree/dash');
});

test('--dry-run says whether the refresh would run, and which changed files call for it', async () => {
	const out = printed();
	const s = await setup({ files: { 'bun.lock': 'lock\n', 'dash.txt': 'dash\n' } });
	const seen = join(s.dir, 'refresh.txt');
	const refresh = { when: WATCHED, run: `touch ${seen}` };
	await s.run({ integration: 'dev', refresh }, { dryRun: true });
	expect(out()).toContain(`\`touch ${seen}\` would run there, since the delivery changes \`bun.lock\`; then`);
	expect(existsSync(seen)).toBe(false);
	const none = await setup();
	await none.run({ integration: 'dev', refresh }, { dryRun: true });
	expect(out()).toContain(`\`touch ${seen}\` would stay out, since the delivery changes no file refresh watches (\`bun.lock\`, \`**/package.json\`); and`);
});
