import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '../src/herdr';
import { backgroundOf, processTable } from '../src/procs';
import { State, type Meta, type Question } from '../src/state';
import { QUESTION_REMIND_MS, REPORT_REMIND_MS, SHELLS_CAP_MS, busyOf, clearReturned, dueQuestions, dueReports, idleCandidates, markDelivered, nextAction, noteBusy, noteStops, onShells, openQuestion, reportWaits, selectEvent, stateWord } from '../src/watch';
import { fakeHerdr, git, repo, worktree } from './helpers';

const meta = (sentAt = '2026-10-21T10:00:00Z'): Meta => ({ kind: 'claude', workspace: 'w1', pane: 'w1:p1', path: '/w', spawnedAt: sentAt, sentAt });
const agent = (status: Agent['agent_status'], seq: number, pane = 'w1:p1'): Agent => ({ agent: 'claude', pane_id: pane, workspace_id: 'w1', cwd: '/w', agent_status: status, state_change_seq: seq });
const T = Date.parse('2026-10-21T10:00:00Z');

test('blocked comes first, then a report, then idle, then gone', () => {
	const snap = {
		metas: { a: meta(), b: meta(), c: meta(), d: meta() },
		agents: { a: agent('idle', 4), b: agent('working', 2), c: agent('blocked', 7, 'w3:p1'), d: undefined },
		reports: { a: 0, b: T + 5000, c: 0, d: 0 }
	};
	let delivered = {};
	const seen: string[] = [];
	for (let e = selectEvent(snap, delivered); e; e = selectEvent(snap, delivered)) {
		seen.push(`${e.kind} ${e.name}`);
		delivered = markDelivered(delivered, e);
	}
	expect(seen).toEqual(['blocked c', 'report b', 'idle a', 'gone d']);
});

test('an idle agent that reported since its last prompt is not idle news', () => {
	const snap = { metas: { a: meta() }, agents: { a: agent('done', 5) }, reports: { a: T + 1000 } };
	const first = selectEvent(snap, {});
	expect(first?.kind).toBe('report');
	expect(selectEvent(snap, markDelivered({}, first!))).toBeNull();
});

test('the same state is told once; a new turn is told again', () => {
	const snap = { metas: { a: meta() }, agents: { a: agent('idle', 5) }, reports: { a: 0 } };
	const d = markDelivered({}, selectEvent(snap, {})!);
	expect(selectEvent(snap, d)).toBeNull();
	expect(selectEvent({ ...snap, agents: { a: agent('idle', 7) } }, d)?.kind).toBe('idle');
	expect(selectEvent({ ...snap, agents: { a: agent('blocked', 8) } }, d)?.kind).toBe('blocked');
});

test('a question to the person stops the agent without waking the orchestrator, until its report or a tell', () => {
	const asked: Question = { question: 'Which title?', at: '2026-10-21T10:05:00Z', seq: 4, to: 'person' };
	const snap = { metas: { a: meta() }, agents: { a: agent('done', 5) }, reports: { a: 0 }, questions: { a: asked } };
	expect(selectEvent(snap, {})).toBeNull();
	// a report after the question ends it: the report is news
	expect(selectEvent({ ...snap, reports: { a: T + 10 * 60_000 } }, {})?.kind).toBe('report');
	// a tell after the question ends it too; the stop it answered is not news
	const told = { ...snap, metas: { a: { ...meta('2026-10-21T10:06:00Z'), sentSeq: 5 } } };
	expect(selectEvent(told, {})).toBeNull();
	// once the agent took the answer and stopped again, that stop is news
	expect(selectEvent({ ...told, agents: { a: agent('done', 7) } }, {})?.kind).toBe('idle');
	// blocked on an approval is still told
	expect(selectEvent({ ...snap, agents: { a: agent('blocked', 6) } }, {})?.kind).toBe('blocked');
});

test('a question to the orchestrator is told once, after a blocked agent and before a report, and its stop is no idle news', () => {
	const asked: Question = { question: 'Which title?', at: '2026-10-21T10:05:00Z', seq: 4, to: 'orchestrator' };
	const snap = {
		metas: { a: meta(), b: meta(), c: meta() },
		agents: { a: agent('done', 5), b: agent('working', 2), c: agent('blocked', 7, 'w3:p1') },
		reports: { a: 0, b: T + 5000, c: 0 },
		questions: { a: asked }
	};
	let delivered = {};
	const seen: string[] = [];
	for (let e = selectEvent(snap, delivered); e; e = selectEvent(snap, delivered)) {
		seen.push(`${e.kind} ${e.name}`);
		delivered = markDelivered(delivered, e);
	}
	expect(seen).toEqual(['blocked c', 'question a', 'report b']);
	// a new question is told again
	expect(selectEvent({ ...snap, questions: { a: { ...asked, at: '2026-10-21T10:08:00Z' } } }, delivered)?.kind).toBe('question');
	// a report after the question ends it before the orchestrator saw it: the report is the news
	const alone = { metas: { a: meta() }, agents: { a: agent('done', 5) }, reports: { a: T + 10 * 60_000 }, questions: { a: asked } };
	expect(selectEvent(alone, {})?.kind).toBe('report');
});

test('the next action says what herdr\'s state alone does not: done is not a finished task', () => {
	const snap = (a: Agent | undefined, o: { report?: number; question?: Question } = {}) => ({
		metas: { a: meta('2026-10-21T10:00:00Z') },
		agents: { a },
		reports: { a: o.report ?? 0 },
		questions: { a: o.question },
		// the watch saw the agent stop at 5 after asking at 4
		stops: { a: { 4: 5 } }
	});
	const asked: Question = { question: 'Should the footer stay on mobile,\nor fold into the menu?', at: '2026-10-21T10:05:00Z', seq: 4, to: 'person' };
	expect(nextAction(snap(agent('working', 3)), 'a')).toBe('working');
	// an agent stopped with no commit and no report: its screen says why
	expect(nextAction(snap(agent('done', 5)), 'a')).toBe('stopped: read its screen');
	expect(stateWord(agent('done', 5))).toBe('stopped');
	expect(nextAction(snap(agent('done', 5), { question: asked }), 'a')).toBe('answer the person: Should the footer stay on mobile, or fo…');
	expect(nextAction(snap(agent('working', 4), { question: asked }), 'a')).toBe('with the person');
	// a question to the orchestrator is the orchestrator's to answer, until the agent's next turn
	const toOrchestrator: Question = { ...asked, to: 'orchestrator' };
	expect(nextAction(snap(agent('working', 4), { question: toOrchestrator }), 'a')).toBe('answer the agent: Should the footer stay on mobile, or fo…');
	expect(nextAction(snap(agent('done', 5), { question: toOrchestrator }), 'a')).toBe('answer the agent: Should the footer stay on mobile, or fo…');
	expect(nextAction(snap(agent('working', 6), { question: toOrchestrator }), 'a')).toBe('working');
	expect(nextAction(snap(agent('blocked', 6)), 'a')).toBe('answer the person: on screen');
	expect(nextAction(snap(agent('done', 5), { report: T + 60_000 }), 'a')).toBe('check and ship');
	expect(nextAction(snap(undefined, { report: T + 60_000 }), 'a')).toBe('check and ship');
	expect(nextAction(snap(undefined), 'a')).toBe('no agent: resume');
	expect(nextAction(snap(agent('done', 5), { report: T + 60_000 }), 'a', true)).toBe('shipping');
	// a report older than the last prompt was answered with a tell
	expect(nextAction(snap(agent('working', 7), { report: T - 60_000 }), 'a')).toBe('working');
});

test('the agent\'s next turn answers its question or its report, whoever started it: a turn past the first stop the watch saw after it', () => {
	// asked while working at 4; herdr's seq is one counter for every pane, so the agent's own stop lands at 9
	const asked: Question = { question: 'Which title?', at: '2026-10-21T10:05:00Z', seq: 4, to: 'orchestrator' };
	const q = (a: Agent, stops?: Record<string, number>) => ({ metas: { a: meta() }, agents: { a }, reports: { a: 0 }, questions: { a: asked }, stops: { a: stops } });
	expect(openQuestion(q(agent('working', 4)), 'a')).toBe(asked);
	// no stop recorded: no turn, wherever the counter went
	expect(openQuestion(q(agent('done', 9)), 'a')).toBe(asked);
	expect(openQuestion(q(agent('working', 12)), 'a')).toBe(asked);
	// the watch records the first stop it sees past the question's seq, and keeps it
	expect(noteStops(q(agent('working', 4)), {})).toEqual({});
	const seen = noteStops(q(agent('done', 9)), {});
	expect(seen).toEqual({ a: { stops: { 4: 9 } } });
	expect(noteStops(q(agent('working', 11), { 4: 9 }), seen)).toBe(seen);
	expect(openQuestion(q(agent('done', 9), { 4: 9 }), 'a')).toBe(asked);
	// a session change (`/clear`) leaves the seq: no turn
	expect(openQuestion(q(agent('idle', 9), { 4: 9 }), 'a')).toBe(asked);
	// a SendMessage, or the person in the pane, started a turn: no tell needed; a dialog in that turn is the same turn
	expect(openQuestion(q(agent('working', 11), { 4: 9 }), 'a')).toBeNull();
	expect(openQuestion(q(agent('blocked', 12), { 4: 9 }), 'a')).toBeNull();
	// the agent took the answer and stopped again: that stop is news, and nothing calls the person
	expect(selectEvent(q(agent('done', 13), { 4: 9 }), { a: { question: asked.at } })?.kind).toBe('idle');
	expect(dueQuestions(q(agent('done', 13), { 4: 9 }), {}, Date.parse(asked.at) + QUESTION_REMIND_MS)).toEqual([]);

	// a dialog inside the asking turn: blocked, approved, working on, and only then the stop
	expect(noteStops(q(agent('blocked', 6)), {})).toEqual({});
	expect(openQuestion(q(agent('blocked', 6)), 'a')).toBe(asked);
	expect(dueQuestions(q(agent('blocked', 6)), {}, Date.parse(asked.at) + QUESTION_REMIND_MS)).toEqual(['a']);
	expect(noteStops(q(agent('working', 7)), {})).toEqual({});
	expect(openQuestion(q(agent('working', 7)), 'a')).toBe(asked);
	expect(noteStops(q(agent('done', 9)), {})).toEqual({ a: { stops: { 4: 9 } } });

	// reported while working at 4, stopped at 9
	const r = (a: Agent | undefined, seq?: number, stops?: Record<string, number>) => ({ metas: { a: meta() }, agents: { a }, reports: { a: T + 60_000 }, reportSeqs: { a: seq }, stops: { a: stops } });
	expect(reportWaits(r(agent('done', 9), 4), 'a')).toBe(true);
	expect(noteStops(r(agent('done', 9), 4), {})).toEqual({ a: { stops: { 4: 9 } } });
	expect(reportWaits(r(agent('done', 9), 4, { 4: 9 }), 'a')).toBe(true);
	expect(reportWaits(r(agent('working', 11), 4, { 4: 9 }), 'a')).toBe(false);
	// a dialog before the stop is no turn
	expect(reportWaits(r(agent('working', 7), 4), 'a')).toBe(true);
	// no seq (herdr silent while it reported), or no agent: only a tell answers it
	expect(reportWaits(r(agent('working', 9)), 'a')).toBe(true);
	expect(noteStops(r(agent('done', 9)), {})).toEqual({});
	expect(reportWaits(r(undefined, 4, { 4: 9 }), 'a')).toBe(true);
	const done = r(agent('done', 13), 4, { 4: 9 });
	expect(nextAction(done, 'a')).toBe('stopped: read its screen');
	expect(selectEvent(done, { a: { report: T + 60_000 } })?.kind).toBe('idle');
	expect(dueReports(done, {}, T + 60_000 + REPORT_REMIND_MS, () => false)).toEqual([]);
});

test('the watch keeps the stops of the current question and report only: a new one starts from none', () => {
	const asked: Question = { question: 'Which title?', at: '2026-10-21T10:05:00Z', seq: 14, to: 'orchestrator' };
	const snap = { metas: { a: meta() }, agents: { a: agent('working', 14) }, reports: { a: T + 60_000 }, questions: { a: asked }, reportSeqs: { a: 4 } };
	// the report's stop stays; the question's turn has not ended, and the stop of an older question goes
	expect(noteStops(snap, { a: { report: T + 60_000, stops: { 2: 3, 4: 9 } } })).toEqual({ a: { report: T + 60_000, stops: { 4: 9 } } });
	expect(noteStops({ ...snap, reportSeqs: { a: undefined } }, { a: { stops: { 4: 9 } } })).toEqual({ a: {} });
});

test('an agent that comes back clears gone, so leaving again is told again', () => {
	const gone = markDelivered({}, { kind: 'gone', name: 'a' });
	expect(selectEvent({ metas: { a: meta() }, agents: { a: undefined }, reports: {} }, gone)).toBeNull();
	expect(clearReturned(gone, { a: agent('working', 9) }).a.gone).toBe(false);
});

test('an agent stopped with its own background shells counts as working, up to the cap; then its stop is told with what still runs', () => {
	const base = { metas: { a: meta() }, agents: { a: agent('done', 5) }, reports: { a: 0 }, shells: { a: ['bun scripts/dev.ts', 'colima start'] } };
	const t = T + 3_600_000;
	// no clock yet: working
	expect(selectEvent(base, {}, t)).toBeNull();
	expect(nextAction(base, 'a', false, t)).toBe('working (background shells)');
	expect(stateWord(base.agents.a, onShells(base, 'a', t))).toBe('working');

	// the first look starts the clock, and the next ones keep it
	const seen = noteBusy(base, {}, t);
	expect(seen).toEqual({ a: { busy: { seq: 5, at: t } } });
	expect(noteBusy(base, seen, t + 60_000)).toBe(seen);

	const snap = { ...base, busy: busyOf(seen) };
	expect(selectEvent(snap, seen, t + SHELLS_CAP_MS - 1)).toBeNull();
	expect(nextAction(snap, 'a', false, t + SHELLS_CAP_MS - 1)).toBe('working (background shells)');
	const late = selectEvent(snap, seen, t + SHELLS_CAP_MS);
	expect(late).toEqual({ kind: 'idle', name: 'a', pane: 'w1:p1', seq: 5, shells: ['bun scripts/dev.ts', 'colima start'] });
	expect(nextAction(snap, 'a', false, t + SHELLS_CAP_MS)).toBe('stopped: read its screen');
	expect(stateWord(snap.agents.a, onShells(snap, 'a', t + SHELLS_CAP_MS))).toBe('stopped');
	// told once, as any stop
	expect(selectEvent(snap, markDelivered(seen, late!), t + SHELLS_CAP_MS + 60_000)).toBeNull();

	// a clock belongs to its stop: a later stop with shells starts its own
	const moved = { ...base, agents: { a: agent('done', 7) }, busy: busyOf(seen) };
	expect(selectEvent(moved, seen, t + SHELLS_CAP_MS)).toBeNull();
	expect(noteBusy(moved, seen, t + SHELLS_CAP_MS).a.busy).toEqual({ seq: 7, at: t + SHELLS_CAP_MS });
	expect(noteBusy({ ...moved, agents: { a: agent('working', 6) }, shells: {} }, seen, t).a.busy).toBeUndefined();
});

test('with no shells a stop is told as ever, and shells change nothing for a report, a question or a working agent', () => {
	const t = T + 3_600_000;
	const base = { metas: { a: meta() }, agents: { a: agent('done', 5) }, reports: { a: 0 } };
	expect(selectEvent({ ...base, shells: {} }, {}, t)?.kind).toBe('idle');
	expect(nextAction({ ...base, shells: {} }, 'a', false, t)).toBe('stopped: read its screen');
	// the last shell ended and the agent took no turn: the record stays, and the stop is told
	const seen = { a: { busy: { seq: 5, at: t } } };
	expect(selectEvent({ ...base, shells: {}, busy: busyOf(seen) }, seen, t)).toEqual({ kind: 'idle', name: 'a', pane: 'w1:p1', seq: 5, shells: undefined });
	expect(noteBusy({ ...base, shells: {} }, seen, t)).toBe(seen);

	const shells = { a: ['bun run dev'] };
	const reported = { ...base, shells, reports: { a: T + 5000 } };
	expect(selectEvent(reported, {}, t)?.kind).toBe('report');
	expect(nextAction(reported, 'a', false, t)).toBe('check and ship');
	expect(idleCandidates(reported, {})).toEqual({});
	expect(nextAction({ ...base, shells, agents: { a: agent('working', 5) } }, 'a', false, t)).toBe('working');
	// only a stop that would be news is looked at
	expect(idleCandidates(base, {})).toEqual({ a: agent('done', 5) });
	expect(idleCandidates(base, { a: { idleSeq: 5 } })).toEqual({});
});

test('an agent\'s background shells are the processes under it that left its group, named by what they run', () => {
	const row = (pid: number, ppid: number, pgid: number, command: string) => ({ pid, ppid, pgid, command });
	// as `ps` shows Claude Code with background commands: each in a zsh of its own group
	const zsh = `/bin/zsh -c source /h/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && eval 'x' < /dev/null && pwd -P >| /tmp/c`;
	const table = [
		row(10, 1, 10, '-zsh'),
		row(20, 10, 20, 'claude --permission-mode auto'),
		row(21, 20, 20, 'caffeinate -i -t 300'),
		row(22, 20, 20, 'node /h/mcp-server.js'),
		row(30, 20, 30, zsh),
		row(31, 30, 30, 'bun run dev'),
		row(32, 31, 30, '/bin/bash -c cd app && bun run dev'),
		row(33, 32, 30, 'bun scripts/dev.ts'),
		// a pipeline, its middle stage a function the shell snapshot wraps
		row(40, 20, 40, zsh),
		row(41, 40, 40, 'bun capture.ts final'),
		row(42, 40, 40, zsh),
		row(43, 42, 40, 'ugrep -v at'),
		row(44, 40, 40, 'tail -2'),
		// between two commands of a loop
		row(50, 20, 50, zsh),
		// another pane's agent, and a job the person left in the pane's shell
		row(60, 1, 60, 'claude'),
		row(61, 60, 61, 'sleep 100'),
		row(70, 10, 70, 'sleep 5')
	];
	expect(backgroundOf(table, 20)).toEqual(['bun run dev', 'bun capture.ts final', 'ugrep -v at', 'tail -2', 'a shell (pid 50)']);
	// through a wrapper that started the agent: it leads the group
	const launched = [row(19, 10, 19, 'launcher'), ...table.map((p) => ({ ...p, pgid: p.pgid === 20 ? 19 : p.pgid, ppid: p.pid === 20 ? 19 : p.ppid }))];
	expect(backgroundOf(launched, 19)).toContain('bun run dev');
	expect(backgroundOf(table, 60)).toEqual(['sleep 100']);
	expect(backgroundOf([row(1, 0, 1, 'x'), row(2, 1, 2, 'sh -c "sleep 1"')], 99)).toEqual([]);
});

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

test('wf watch prints the event, calls the person for a blocked agent, and times out with 3', () => {
	const r = repo('dev', { 'wf.config.ts': `export default { integration: 'dev' };\n` });
	cleanups.push(r.done);
	const wt = realpathSync(mkdtempSync(join(tmpdir(), 'wf-wt-')));
	cleanups.push(() => rmSync(wt, { recursive: true, force: true }));
	const h = fakeHerdr({ agents: [{ name: 'dash', agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: wt, agent_status: 'blocked', state_change_seq: 3 }] });
	cleanups.push(h.done);
	const common = git(r.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	const dir = join(common, 'wf', 'dash');
	require('node:fs').mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta(), path: wt }));

	const watch = () => {
		const p = Bun.spawnSync(['bun', join(import.meta.dir, '../src/cli.ts'), 'watch', '--timeout', '300'], { cwd: r.main, env: process.env, stdout: 'pipe', stderr: 'pipe' });
		return { code: p.exitCode, out: p.stdout.toString() };
	};
	const first = watch();
	expect(first.code).toBe(0);
	expect(first.out).toContain('blocked dash: pane w1:p1');
	expect(h.calls().some((c) => c[1] === 'show' && c[2] === 'wf: dash waits for you' && c.at(-1) === 'request')).toBe(true);
	const second = watch();
	expect(second.code).toBe(3);
	expect(second.out).toContain('nothing to act on yet');
});

const CLI = join(import.meta.dir, '../src/cli.ts');

/** A repository with one worktree wf started, its agent working, and a report waiting. */
function reported() {
	const r = repo('dev', { 'wf.config.ts': `export default { integration: 'dev' };\n` });
	cleanups.push(r.done);
	const wt = realpathSync(mkdtempSync(join(tmpdir(), 'wf-wt-')));
	cleanups.push(() => rmSync(wt, { recursive: true, force: true }));
	const h = fakeHerdr({ agents: [{ name: 'dash', agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: wt, agent_status: 'working', state_change_seq: 3 }] });
	cleanups.push(h.done);
	const state = new State(git(r.main, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
	state.writeMeta('dash', { ...meta(), path: wt });
	state.writeReport('dash', 'Done.', 'abc123');
	return { ...r, state };
}

async function until(test: () => boolean, ms = 10_000): Promise<void> {
	for (const end = Date.now() + ms; !test(); await Bun.sleep(50)) if (Date.now() > end) throw new Error('timed out');
}

test('watch refuses an output sent to /dev/null, and says how to run it', () => {
	const s = reported();
	const p = Bun.spawnSync(['bun', CLI, 'watch', '--timeout', '300'], { cwd: s.main, env: process.env, stdout: 'ignore', stderr: 'pipe' });
	expect(p.exitCode).toBe(1);
	expect(p.stderr.toString()).toContain('its output goes to /dev/null: run it as your harness');
	expect(s.state.delivered()).toEqual({});
});

test('a watch whose shell already exited (`&`) stops without delivering, so the next watch delivers', async () => {
	const s = reported();
	const out = join(s.dir, 'watch.out');
	const pid = join(s.dir, 'watch.pid');
	// as a harness's shell does: its own process group, `&`, and the shell exits at once
	Bun.spawn(['sh', '-c', `bun ${CLI} watch --timeout 5000 > ${out} 2>&1 & echo $! > ${pid}`], { cwd: s.main, env: process.env, detached: true });
	await until(() => existsSync(pid) && readFileSync(pid, 'utf8').trim() !== '');
	const watch = Number(readFileSync(pid, 'utf8'));
	await until(() => {
		try {
			process.kill(watch, 0);
			return false;
		} catch {
			return true;
		}
	});
	expect(readFileSync(out, 'utf8')).toContain('already exited (`&`, `nohup`, `disown`), so it wakes no orchestrator');
	expect(s.state.delivered()).toEqual({});
	const next = Bun.spawnSync(['bun', CLI, 'watch', '--timeout', '300'], { cwd: s.main, env: process.env, stdout: 'pipe', stderr: 'pipe' });
	expect(next.stdout.toString()).toContain('report dash:');
});

test('one watch per repository: a new one replaces the old, which says not to start it again', async () => {
	const s = reported();
	s.state.writeDelivered({ dash: { report: s.state.reportTime('dash') } });
	const old = Bun.spawn(['bun', CLI, 'watch', '--timeout', '20000'], { cwd: s.main, env: process.env, stdout: 'pipe', stderr: 'pipe' });
	await until(() => s.state.watcher()?.pid === old.pid);
	const next = Bun.spawnSync(['bun', CLI, 'watch', '--timeout', '500'], { cwd: s.main, env: process.env, stdout: 'pipe', stderr: 'pipe' });
	expect(next.exitCode).toBe(3);
	expect(next.stdout.toString()).toContain(`↻ replaced the watch started at`);
	expect(await old.exited).toBe(4);
	expect(await new Response(old.stdout).text()).toContain('replaced by a newer `bun wf watch`');
	// the newer one, gone too, left no record behind
	expect(s.state.watcher()).toBeNull();
});

/** A repository with one worktree wf started, its agent stopped with no report since its prompt. */
function stoppedAgent() {
	const r = repo('dev', { 'wf.config.ts': `export default { integration: 'dev' };\n` });
	cleanups.push(r.done);
	const wt = worktree(r.main, 'dash');
	const h = fakeHerdr({ agents: [{ name: 'dash', agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: wt, agent_status: 'done', state_change_seq: 3 }] });
	cleanups.push(h.done);
	const state = new State(git(r.main, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
	state.writeMeta('dash', { ...meta(), path: wt, sentSeq: 1 });
	const run = (...args: string[]) => {
		const p = Bun.spawnSync(['bun', CLI, ...args], { cwd: r.main, env: process.env, stdout: 'pipe', stderr: 'pipe' });
		return { code: p.exitCode, out: p.stdout.toString() };
	};
	return { ...r, h, state, run, watch: () => run('watch', '--timeout', '300') };
}

/** A real agent and background shell, as Claude Code leaves one: the agent leads its group, the shell has its own. */
async function backgroundShell(): Promise<number> {
	const script = `const s = Bun.spawn(['sh', '-c', 'sleep 30; true'], { detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }); console.log(s.pid); await Bun.sleep(30_000);`;
	const agent = Bun.spawn(['bun', '-e', script], { detached: true, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
	const { value } = await agent.stdout.getReader().read();
	const shell = Number(new TextDecoder().decode(value));
	cleanups.push(() => {
		for (const pid of [shell, agent.pid])
			try {
				process.kill(-pid, 'SIGKILL');
			} catch {
				// gone meanwhile
			}
	});
	await until(() => backgroundOf(processTable(), agent.pid).includes('sleep 30'));
	return agent.pid;
}

test('wf watch leaves an agent stopped with a live background shell until the cap, then names the shell; status and doctor agree', async () => {
	const s = stoppedAgent();
	s.h.set({ ...s.h.state(), foreground: { 'w1:p1': await backgroundShell() } });
	const first = s.watch();
	expect(first.code).toBe(3);
	expect(first.out).toContain('nothing to act on yet');
	expect(s.state.delivered().dash.busy?.seq).toBe(3);
	expect(s.run('status').out).toMatch(/dash\s+0\/0\s+claude working\s+-\s+working \(background shells\)/);
	expect(s.run('doctor').out).not.toContain('shells left running');

	// a dev server it forgot must not hide the stop for ever
	s.state.writeDelivered({ dash: { busy: { seq: 3, at: Date.now() - SHELLS_CAP_MS } } });
	const late = s.watch();
	expect(late.code).toBe(0);
	expect(late.out).toContain('idle dash: the agent stopped with no report since its last prompt (pane w1:p1); still running: sleep 30. Its screen:');
	expect(s.watch().code).toBe(3);
	const status = s.run('status').out;
	expect(status).toMatch(/dash\s+0\/0\s+claude stopped\s+-\s+stopped: read its screen/);
	expect(status).toContain('· dash stopped with shells left running: sleep 30');
	expect(s.run('doctor').out).toContain('! dash stopped with shells left running: sleep 30\n    read its screen, then answer by `bun wf tell dash`');
});

test('wf watch tells an agent stopped with no shells at once, as ever', () => {
	const s = stoppedAgent();
	const first = s.watch();
	expect(first.code).toBe(0);
	expect(first.out).toContain('idle dash: the agent stopped with no report since its last prompt (pane w1:p1). Its screen:');
	expect(s.state.delivered().dash.busy).toBeUndefined();
});

test('the last shell ended: an agent that takes its next turn within the hold is no news, one that stays stopped is told', async () => {
	const s = stoppedAgent();
	s.state.writeDelivered({ dash: { busy: { seq: 3, at: Date.now() } } });
	const p = Bun.spawn(['bun', CLI, 'watch', '--timeout', '3000'], { cwd: s.main, env: { ...process.env, WF_BLOCKED_MS: '1500' }, stdout: 'pipe', stderr: 'pipe' });
	await until(() => s.h.calls().some((c) => c[1] === 'process-info'));
	const state = s.h.state();
	Object.assign(state.agents![0], { agent_status: 'working', state_change_seq: 4 });
	s.h.set(state);
	expect(await p.exited).toBe(3);
	expect(s.state.delivered().dash?.idleSeq).toBeUndefined();

	Object.assign(state.agents![0], { agent_status: 'done', state_change_seq: 5 });
	s.h.set(state);
	s.state.writeDelivered({ dash: { busy: { seq: 5, at: Date.now() } } });
	const told = s.watch();
	expect(told.code).toBe(0);
	expect(told.out).toContain('idle dash: the agent stopped with no report since its last prompt (pane w1:p1). Its screen:');
});
