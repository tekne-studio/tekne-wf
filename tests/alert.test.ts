// The person's call for a blocked agent: `wf alert` (what the herdr plugin runs), the
// plugin itself on herdr's state event, and watch's reminders.
import { afterEach, expect, test } from 'bun:test';
import { chmodSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { State, type Meta, type Question } from '../src/state';
import { QUESTION_REMIND_MS, REMIND_MS, REPORT_REMIND_MS, dueQuestions, dueReminders, dueReports } from '../src/watch';
import type { FakeState } from './fake-herdr';
import { fakeHerdr, git, repo, worktree, write } from './helpers';

const CLI = join(import.meta.dir, '../src/cli.ts');
const PLUGIN = join(import.meta.dir, '../herdr/plugin.ts');
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

function setup(plugins: string[] = [], herdr: FakeState = {}) {
	const r = repo('dev', { 'wf.config.ts': `export default { integration: 'dev' };\n` });
	cleanups.push(r.done);
	const wt = worktree(r.main, 'dash');
	const blocked = { name: 'dash', agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: wt, agent_status: 'blocked', state_change_seq: 4 };
	const h = fakeHerdr({ ...herdr, plugins, agents: [blocked] });
	cleanups.push(h.done);
	const state = new State(git(r.main, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
	const meta: Meta = { kind: 'claude', workspace: 'w1', pane: 'w1:p1', path: wt, spawnedAt: new Date().toISOString(), sentAt: new Date().toISOString() };
	const wf = (cwd: string, args: string[]) => {
		const p = Bun.spawnSync(['bun', CLI, ...args], { cwd, env: process.env, stdout: 'pipe', stderr: 'pipe' });
		return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
	};
	const calls = () => h.calls().filter((c) => c[0] === 'notification');
	return { ...r, wt, h, state, meta, wf, calls };
}

test('alert calls the person for an agent wf started, and records when', () => {
	const s = setup();
	s.state.writeMeta('dash', s.meta);
	const r = s.wf(s.main, ['alert', '--pane', 'w1:p1']);
	expect(r.out).toContain('dash: the person was called');
	expect(s.calls()).toEqual([['notification', 'show', 'wf: dash waits for you', '--body', 'main · pane w1:p1: an approval or a question on screen', '--sound', 'request']]);
	expect(s.state.meta('dash')?.alertedAt).toBeString();
});

test('a call herdr did not show is never told as made: alert fails and says so, and watch says to tell the person', () => {
	const s = setup([], { notification: 'rate_limited' });
	s.state.writeMeta('dash', s.meta);
	const alert = s.wf(s.main, ['alert', '--pane', 'w1:p1']);
	expect(alert.code).toBe(1);
	expect(alert.out).not.toContain('the person was called');
	expect(alert.err).toContain('herdr did not show the notification "wf: dash waits for you": rate_limited');
	expect(alert.err).toContain('dash: the person was not called (pane w1:p1)');
	// the attempt counts: watch calls again five minutes after it
	expect(s.state.meta('dash')?.alertedAt).toBeString();
	const watch = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(watch.out).toContain('blocked dash: pane w1:p1 shows an approval or a question');
	expect(watch.out).not.toContain('the person was called');
	expect(watch.out).toContain('the call to the person did not go out: tell them');
});

/** Waits for wf's first `herdr agent <verb>`, then has the agent work again, as auto mode answering its own dialog does. */
async function goesOn(s: ReturnType<typeof setup>, verb: string): Promise<void> {
	for (const end = Date.now() + 10_000; !s.h.calls().some((c) => c[0] === 'agent' && c[1] === verb) && Date.now() < end; ) await Bun.sleep(50);
	const state = s.h.state();
	state.agents![0].agent_status = 'working';
	state.agents![0].state_change_seq = 5;
	s.h.set(state);
}

test('alert calls nobody for a blocked state that goes away by itself within the hold', async () => {
	const s = setup();
	s.state.writeMeta('dash', s.meta);
	const p = Bun.spawn(['bun', CLI, 'alert', '--pane', 'w1:p1'], { cwd: s.main, env: { ...process.env, WF_BLOCKED_MS: '1500' }, stdout: 'pipe', stderr: 'pipe' });
	await goesOn(s, 'get');
	expect(await p.exited).toBe(0);
	expect(await new Response(p.stdout).text()).toContain('dash: blocked less than 1.5s (pane w1:p1), gone by itself: nobody called');
	expect(s.calls()).toEqual([]);
	expect(s.state.meta('dash')?.alertedAt).toBeUndefined();
}, 20_000);

test('watch returns nothing, and calls nobody, for a blocked state that goes away by itself within the hold', async () => {
	const s = setup();
	s.state.writeMeta('dash', s.meta);
	const p = Bun.spawn(['bun', CLI, 'watch', '--timeout', '3000'], { cwd: s.main, env: { ...process.env, WF_BLOCKED_MS: '1500' }, stdout: 'pipe', stderr: 'pipe' });
	await goesOn(s, 'list');
	expect(await p.exited).toBe(3);
	expect(await new Response(p.stdout).text()).toContain('nothing to act on yet');
	expect(s.calls()).toEqual([]);
}, 20_000);

test('alert leaves alone an agent wf did not start', () => {
	const s = setup();
	expect(s.wf(s.main, ['alert', '--pane', 'w1:p1']).out).toContain('not an agent wf started');
	expect(s.calls()).toEqual([]);
});

test('the plugin turns herdr’s blocked event into wf alert, and ignores every other state', () => {
	const s = setup();
	const log = join(s.dir, 'wf-called');
	write(s.main, 'node_modules/.bin/wf', `#!/bin/sh\necho "$@" >> ${log}\n`);
	chmodSync(join(s.main, 'node_modules/.bin/wf'), 0o755);
	const fire = (agent_status: string) =>
		Bun.spawnSync(['bun', PLUGIN], {
			env: { ...process.env, HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ event: 'pane_agent_status_changed', data: { pane_id: 'w1:p1', workspace_id: 'w1', agent_status, agent: 'claude' } }) }
		}).exitCode;
	writeFileSync(log, '');
	expect(fire('working')).toBe(0);
	expect(fire('done')).toBe(0);
	expect(readFileSync(log, 'utf8')).toBe('');
	expect(fire('blocked')).toBe(0);
	expect(readFileSync(log, 'utf8').trim()).toBe('alert --pane w1:p1');
});

test('reminders: only for an agent still blocked, already called, longer than five minutes ago', () => {
	const now = Date.parse('2026-10-21T12:00:00Z');
	const meta = (alertedAt?: string): Meta => ({ kind: 'claude', workspace: 'w', pane: 'p', path: '/w', spawnedAt: '', sentAt: '', alertedAt });
	const agent = (agent_status: 'blocked' | 'working') => ({ agent: 'claude', pane_id: 'p', workspace_id: 'w', cwd: '/w', agent_status, state_change_seq: 1 });
	const old = new Date(now - REMIND_MS).toISOString();
	const recent = new Date(now - 60_000).toISOString();
	expect(
		dueReminders(
			{
				metas: { a: meta(old), b: meta(recent), c: meta(), d: meta(old) },
				agents: { a: agent('blocked'), b: agent('blocked'), c: agent('blocked'), d: agent('working') },
				reports: {}
			},
			now
		)
	).toEqual(['a']);
});

test('reminders for a question asked of the person: only while they have not answered; never for one asked of the orchestrator', () => {
	const now = Date.parse('2026-10-21T12:00:00Z');
	const old = new Date(now - REMIND_MS).toISOString();
	const meta: Meta = { kind: 'claude', workspace: 'w', pane: 'p', path: '/w', spawnedAt: '', sentAt: '2026-10-21T11:00:00Z', alertedAt: old };
	const agent = (agent_status: 'done' | 'working', state_change_seq: number) => ({ agent: 'claude', pane_id: 'p', workspace_id: 'w', cwd: '/w', agent_status, state_change_seq });
	const question: Question = { question: 'Which title?', at: '2026-10-21T11:50:00Z', seq: 4, to: 'person' };
	// the watch saw the agent stop at 5 after asking at 4
	const snap = (a: ReturnType<typeof agent>, q = question) => ({ metas: { a: meta }, agents: { a }, reports: {}, questions: { a: q }, stops: { a: { 4: 5 } } });
	// stopped right after asking: the person has not answered
	expect(dueReminders(snap(agent('done', 5)), now)).toEqual(['a']);
	// the person answered (a turn since), and the conversation goes on
	expect(dueReminders(snap(agent('done', 7)), now)).toEqual([]);
	expect(dueReminders(snap(agent('working', 5)), now)).toEqual([]);
	// the orchestrator's question: the person is not called every five minutes
	expect(dueReminders(snap(agent('done', 5), { ...question, to: 'orchestrator' }), now)).toEqual([]);
});

test('a question the orchestrator has not answered after ten minutes is told to the person, once', () => {
	const now = Date.parse('2026-10-21T12:00:00Z');
	const meta: Meta = { kind: 'claude', workspace: 'w', pane: 'p', path: '/w', spawnedAt: '', sentAt: '2026-10-21T11:00:00Z' };
	const at = (ms: number, to: Question['to'] = 'orchestrator'): Question => ({ question: 'Which title?', at: new Date(now - ms).toISOString(), to });
	const snap = {
		metas: { a: meta, b: meta, c: meta, d: meta },
		agents: {},
		reports: {},
		// b is recent, c asked the person, d was answered with a tell (older than the last prompt)
		questions: { a: at(QUESTION_REMIND_MS), b: at(60_000), c: at(QUESTION_REMIND_MS, 'person'), d: { ...at(0), at: '2026-10-21T10:00:00Z' } }
	};
	expect(dueQuestions(snap, {}, now)).toEqual(['a']);
	expect(dueQuestions(snap, { a: { questionReminded: snap.questions.a.at } }, now)).toEqual([]);
});

test('with the plugin installed, watch reports a blocked agent without calling the person twice', () => {
	const s = setup(['tekne.wf']);
	s.state.writeMeta('dash', s.meta);
	const r = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(r.out).toContain('blocked dash: pane w1:p1');
	expect(r.out).toEndWith('\n\nStart `bun wf watch` again in the background, then act.\n');
	expect(s.calls()).toEqual([]);
});

test('watch calls again while an agent stays blocked', () => {
	const s = setup(['tekne.wf']);
	s.state.writeMeta('dash', { ...s.meta, alertedAt: new Date(Date.now() - REMIND_MS - 1000).toISOString() });
	// the blocked event was told already: watch is only waiting, and reminds meanwhile
	s.state.writeDelivered({ dash: { blockedSeq: 4 } });
	const r = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(r.code).toBe(3);
	expect(s.calls().map((c) => c[2])).toEqual(['wf: dash still waits for you']);
});

test('a report neither shipped nor answered after ten minutes is told to the person, once', () => {
	const now = Date.parse('2026-10-21T12:00:00Z');
	const meta: Meta = { kind: 'claude', workspace: 'w', pane: 'p', path: '/w', spawnedAt: '', sentAt: '2026-10-21T11:00:00Z' };
	const at = now - REPORT_REMIND_MS;
	const snap = { metas: { a: meta, b: meta, c: meta, d: meta }, agents: {}, reports: { a: at, b: now - 60_000, c: at, d: Date.parse('2026-10-21T10:00:00Z') } };
	// b is recent, c is shipping, d was answered with a tell (older than the last prompt)
	expect(dueReports(snap, {}, now, (n) => n === 'c')).toEqual(['a']);
	expect(dueReports(snap, { a: { reminded: at } }, now, () => false)).toEqual(['c']);
});

test('watch calls the person for a report left waiting, and only once', () => {
	const s = setup(['tekne.wf']);
	const state = s.h.state();
	state.agents![0].agent_status = 'done';
	s.h.set(state);
	s.state.writeMeta('dash', { ...s.meta, sentAt: new Date(Date.now() - 60 * 60_000).toISOString() });
	const old = new Date(Date.now() - REPORT_REMIND_MS - 60_000);
	utimesSync(s.state.writeReport('dash', 'Done.', 'abc123'), old, old);
	// the report was delivered already: the orchestrator saw it and did nothing yet
	s.state.writeDelivered({ dash: { report: s.state.reportTime('dash') } });
	expect(s.wf(s.main, ['watch', '--timeout', '300']).code).toBe(3);
	expect(s.calls().map((c) => [c[2], c[4]])).toEqual([["wf: dash's report waits", 'main: reported 11m ago, neither shipped nor answered']]);
	s.wf(s.main, ['watch', '--timeout', '300']);
	expect(s.calls().length).toBe(1);
});

test('watch calls the person for a question the orchestrator left unanswered, and only once', () => {
	const s = setup(['tekne.wf']);
	const state = s.h.state();
	state.agents![0].agent_status = 'done';
	s.h.set(state);
	s.state.writeMeta('dash', { ...s.meta, sentAt: new Date(Date.now() - 60 * 60_000).toISOString() });
	const at = new Date(Date.now() - QUESTION_REMIND_MS - 60_000).toISOString();
	s.state.writeQuestion('dash', { question: 'Which title reads best?', at, seq: 3, to: 'orchestrator' });
	// the question was delivered already: the orchestrator saw it and did not answer yet
	s.state.writeDelivered({ dash: { question: at } });
	expect(s.wf(s.main, ['watch', '--timeout', '300']).code).toBe(3);
	expect(s.calls().map((c) => [c[2], c[4]])).toEqual([["wf: dash's question waits", 'main: asked the orchestrator 11m ago, no answer yet: Which title reads best?']]);
	s.wf(s.main, ['watch', '--timeout', '300']);
	expect(s.calls().length).toBe(1);
});
