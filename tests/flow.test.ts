// spawn, tell, report, status, resume and close, end to end against the fake herdr and
// real git repositories. The CLI runs as a process, as the orchestrator and agents run it.
import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { State } from '../src/state';
import type { FakeAgent } from './fake-herdr';
import { fakeHerdr, git, repo, worktree, writer } from './helpers';

const CLI = join(import.meta.dir, '../src/cli.ts');
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

const CONFIG = `export default {
	integration: 'dev',
	prepare: 'printf "APP_URL=http://localhost:5203\\\\n" > .env.local',
	gates: { cheap: ['true'] },
	look: { file: '.env.local', keys: ['APP_URL'] }
};
`;

function setup(o: { trusted?: boolean; herdr?: Parameters<typeof fakeHerdr>[0] } = {}) {
	const r = repo('dev', { 'wf.config.ts': CONFIG, '.gitignore': '.env.local\npb_data/\n' });
	cleanups.push(r.done);
	const h = fakeHerdr(o.herdr);
	cleanups.push(h.done);
	const home = realpathSync(mkdtempSync(join(tmpdir(), 'wf-home-')));
	cleanups.push(() => rmSync(home, { recursive: true, force: true }));
	writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [r.main]: { hasTrustDialogAccepted: o.trusted ?? true } } }));
	// WF_SETTLE_MS: the fake herdr changes state at once, so spawn need not give it seconds
	const env = { ...process.env, CLAUDE_CONFIG_DIR: home, WF_WORKTREES_DIR: join(home, 'worktrees'), WF_SETTLE_MS: '0' };
	const wf = (cwd: string, args: string[], stdin?: string, extra: Record<string, string> = {}) => {
		const p = Bun.spawnSync(['bun', CLI, ...args], { cwd, env: { ...env, ...extra }, stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe' });
		return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
	};
	const task = join(home, 'task.md');
	writeFileSync(task, 'Add the dashboard.\n');
	// a running Claude Code session, as it records itself in sessions/<pid>.json
	const session = (pid: number, sessionId: string, name: string) => {
		mkdirSync(join(home, 'sessions'), { recursive: true });
		writeFileSync(join(home, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, name, cwd: home }));
	};
	return { ...r, h, env, wf, task, home, session, wtPath: join(home, 'worktrees', 'main', 'worktree-dash') };
}

/** A live pid for a session record other than this process's own. */
function livePid(): number {
	const p = Bun.spawn(['sleep', '60']);
	cleanups.push(() => p.kill());
	return p.pid;
}

test('spawn creates the worktree, prepares it, starts the agent and sends header and task', () => {
	const s = setup();
	const r = s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	expect(r.err).not.toContain('✗');
	expect(r.code).toBe(0);
	expect(r.out).toContain('✓ dash is working in');
	expect(r.out).toEndWith('\n  next: `bun wf watch` in the background\n');
	expect(git(s.wtPath, 'branch', '--show-current')).toBe('worktree/dash');
	expect(existsSync(join(s.wtPath, '.env.local'))).toBe(true);

	const calls = s.h.calls();
	expect(calls).toContainEqual(['worktree', 'create', '--cwd', s.main, '--branch', 'worktree/dash', '--base', 'dev', '--path', s.wtPath, '--label', 'dash', '--no-focus']);
	// the agent starts from its pane's shell, its first prompt the last argument, and gets its name
	const taskPath = join(s.main, '.git', 'wf', 'dash', 'task.md');
	expect(calls).toContainEqual(['pane', 'run', 'w1:p1', `claude '--permission-mode' 'auto' '--name' 'dash' '--disallowedTools' 'AskUserQuestion' 'EnterPlanMode' '--' 'Your task is in ${taskPath}: read it and do it.'`]);
	expect(calls).toContainEqual(['agent', 'rename', 'w1:p1', 'dash']);
	expect(calls.some((c) => c[1] === 'start')).toBe(false);
	const task = readFileSync(taskPath, 'utf8');
	expect(task).toStartWith('You are `dash`');
	expect(task).toContain('APP_URL http://localhost:5203');
	expect(task).toEndWith('Add the dashboard.');
	// every step through herdr is shown, so it can be redone by hand
	expect(r.err).toContain('→ herdr worktree create');
	expect(r.err).toContain('→ herdr pane run w1:p1');
	// the agent took the task: nothing is typed or pressed
	expect(calls.some((c) => c[1] === 'prompt' || c[1] === 'send-keys')).toBe(false);
	expect((s.h.state().agents![0] as FakeAgent).submitted).toEqual([`Your task is in ${taskPath}: read it and do it.`]);
	expect(JSON.parse(readFileSync(join(s.main, '.git', 'wf', 'dash', 'meta.json'), 'utf8')).sentSeq).toBe(2);
});

test('spawn and resume start the agent without the dialogs that ask the person, and with the config\'s arguments when it has them', () => {
	const s = setup();
	writeFileSync(join(s.main, 'wf.config.ts'), CONFIG.replace("integration: 'dev',", "integration: 'dev',\n\tagent: { args: ['--permission-mode', 'acceptEdits'] },"));
	expect(s.wf(s.main, ['spawn', 'dash', '--task', s.task]).code).toBe(0);
	// AskUserQuestion's dialog and a plan's approval only the person can answer: a wf agent asks with `wf ask`
	const args = ['--permission-mode', 'acceptEdits', '--disallowedTools', 'AskUserQuestion', 'EnterPlanMode'];
	const state = s.h.state();
	expect((state.agents![0] as FakeAgent).argv).toEqual([...args, '--', expect.stringContaining('Your task is in')]);
	state.agents = [];
	s.h.set(state);
	expect(s.wf(s.main, ['resume', 'dash']).code).toBe(0);
	expect(s.h.calls()).toContainEqual(['agent', 'start', 'dash', '--kind', 'claude', '--pane', 'w1:p1', '--timeout', '60000', '--', ...args, '--continue']);
});

/** Spawns dash, then ends its agent, so resume starts it again and types its nudge. */
function spawnedAndGone(s: ReturnType<typeof setup>) {
	expect(s.wf(s.main, ['spawn', 'dash', '--task', s.task]).code).toBe(0);
	const state = s.h.state();
	state.agents = [];
	s.h.set(state);
}

test('spawn types the task\'s prompt when the agent did not take it from its arguments', () => {
	const s = setup({ herdr: { launchPromptIgnored: true } });
	const r = s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	expect(r.code).toBe(0);
	expect(r.err).toContain('! dash has not started on the prompt it was started with: typing it in pane w1:p1');
	const prompts = s.h.calls().filter((c) => c[1] === 'prompt');
	expect(prompts).toHaveLength(1);
	expect(prompts[0][3]).toBe(`Your task is in ${join(s.main, '.git', 'wf', 'dash', 'task.md')}: read it and do it.`);
	expect((s.h.state().agents![0] as FakeAgent).submitted).toHaveLength(1);
});

test('resume sees the agent take its nudge: a nudge left in the input box gets Enter once', () => {
	const s = setup({ herdr: { enterLost: 1 } });
	spawnedAndGone(s);
	const r = s.wf(s.main, ['resume', 'dash']);
	expect(r.code).toBe(0);
	expect(s.h.calls().filter((c) => c[1] === 'send-keys')).toEqual([['agent', 'send-keys', 'dash', 'Enter']]);
	expect(r.err).toContain('! dash had not started: its nudge to carry on sat in the input box of pane w1:p1; Enter sent once');
	expect(s.h.calls().filter((c) => c[1] === 'prompt')).toHaveLength(1);
	const agent = s.h.state().agents![0] as FakeAgent;
	expect(agent.submitted).toHaveLength(1);
	expect(agent.submitted![0]).toStartWith('You were interrupted.');
});

test('resume sees the agent take its nudge: a nudge lost whole, the box empty after Enter, is sent once more', () => {
	const s = setup({ herdr: { promptLost: 1 } });
	spawnedAndGone(s);
	const r = s.wf(s.main, ['resume', 'dash']);
	expect(r.code).toBe(0);
	expect(s.h.calls().filter((c) => c[1] === 'send-keys')).toEqual([['agent', 'send-keys', 'dash', 'Enter']]);
	expect(s.h.calls().filter((c) => c[1] === 'prompt')).toHaveLength(2);
	expect(r.err).toContain('! dash had not started: its nudge to carry on never reached the input box of pane w1:p1; sent once more, and it started');
	const agent = s.h.state().agents![0] as FakeAgent;
	expect(agent.submitted).toHaveLength(1);
	expect(agent.submitted![0]).toStartWith('You were interrupted.');
});

test('spawn says so when the agent still has not started, with the pane, the command that unblocks it and the task file', () => {
	const s = setup({ herdr: { launchPromptIgnored: true, promptLost: 2 } });
	const r = s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	expect(r.code).toBe(1);
	expect(r.out).not.toContain('✓ dash is working');
	expect(r.err).toContain('dash has not started its task, Enter sent once and the task once more: look at pane w1:p1');
	expect(r.err).toContain('`herdr agent send-keys dash Enter`');
	expect(r.err).toContain(`the task is in ${join(s.main, '.git', 'wf', 'dash', 'task.md')}`);
	expect(s.h.calls().filter((c) => c[1] === 'send-keys')).toHaveLength(1);
	expect(s.h.calls().filter((c) => c[1] === 'prompt')).toHaveLength(2);
});

test('spawn refuses before creating anything: untrusted repository, taken name, bad name', () => {
	const s = setup({ trusted: false });
	const r = s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	expect(r.code).toBe(1);
	expect(r.err).toContain('open Claude once in');
	expect(s.h.calls().some((c) => c[1] === 'create')).toBe(false);

	git(s.main, 'branch', 'worktree/taken');
	expect(s.wf(s.main, ['spawn', 'taken', '--task', s.task]).err).toContain('already exists');
	expect(s.wf(s.main, ['spawn', 'Bad Name', '--task', s.task]).err).toContain('is not a name');
	expect(s.wf(s.main, ['spawn', 'dash']).err).toContain('the task is missing');
});

test('spawn calls the person when the agent stops at a dialog while starting, and goes on once it takes its prompt', () => {
	const s = setup({ herdr: { startBlocked: true } });
	const r = s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	expect(r.code).toBe(0);
	const calls = s.h.calls();
	expect(calls.some((c) => c[1] === 'show' && c[2] === 'wf: dash waits for you' && c.at(-1) === 'request')).toBe(true);
	expect(calls).toContainEqual(['agent', 'wait', 'dash', '--until', 'working', '--until', 'idle', '--until', 'done', '--timeout', '600000']);
	// past the dialog it took the prompt from its arguments: nothing typed
	expect(calls.some((c) => c[1] === 'prompt')).toBe(false);
	expect((s.h.state().agents![0] as FakeAgent).submitted).toHaveLength(1);
	// a stop counts only past the state from before the dialog
	expect(JSON.parse(readFileSync(join(s.main, '.git', 'wf', 'dash', 'meta.json'), 'utf8')).sentSeq).toBe(1);
});

test('report records what the agent says', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	const r = s.wf(s.wtPath, ['report'], 'Done: one commit; bun test passed.\n');
	expect(r.out).toContain('✓ report recorded');
	const common = git(s.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	expect(readFileSync(join(common, 'wf', 'dash', 'report.md'), 'utf8')).toContain('Done: one commit; bun test passed.');
	expect(s.wf(s.wtPath, ['report'], '  ').err).toContain('the report is empty');
});

test('tell never types into the pane: the person keeps what they were typing, and the message goes as a session message', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	s.session(process.pid, 's-orch', 'orch');
	// the agent's session, renamed by the person: it is found by the id herdr reports
	s.session(livePid(), 'session-dash', 'dash · footer');
	// the person, halfway through a sentence in the agent's pane
	const state = s.h.state();
	(state.agents![0] as FakeAgent).input = 'manda seu handoff pro orquestrador, e f';
	s.h.set(state);
	const before = s.h.calls().length;

	const r = s.wf(s.main, ['tell', 'dash', 'also', 'the', 'footer'], undefined, { CLAUDE_PID: String(process.pid) });
	expect(r.err).not.toContain('✗');
	expect(r.code).toBe(0);
	expect(r.out).toContain('Tell dash now, with SendMessage to "dash · footer": "also the footer"');
	expect(s.h.calls().slice(before).some((c) => c[1] === 'prompt' || c[1] === 'send-keys')).toBe(false);
	const agent = s.h.state().agents![0] as FakeAgent;
	expect(agent.input).toBe('manda seu handoff pro orquestrador, e f');
	expect(agent.submitted).toHaveLength(1);

	// blocked on screen: the message waits in the session, the dialog stays the person's
	agent.agent_status = 'blocked';
	s.h.set({ ...s.h.state(), agents: [agent] });
	const blocked = s.wf(s.main, ['tell', 'dash', 'hello'], undefined, { CLAUDE_PID: String(process.pid) });
	expect(blocked.code).toBe(0);
	expect(blocked.out).toContain('dash is blocked on screen (pane w1:p1): the message waits in its session until the person answers there');
});

test('tell refuses, typing nothing, when no session message can carry it', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	const before = s.h.calls().length;
	// no session of the agent's
	s.session(process.pid, 's-orch', 'orch');
	const lost = s.wf(s.main, ['tell', 'dash', 'hello'], undefined, { CLAUDE_PID: String(process.pid) });
	expect(lost.code).toBe(1);
	expect(lost.err).toContain("dash's Claude Code session is not running (pane w1:p1)");
	// a caller that is no Claude Code session: nothing would send it
	s.session(livePid(), 'session-dash', 'dash');
	const outside = s.wf(s.main, ['tell', 'dash', 'hello']);
	expect(outside.code).toBe(1);
	expect(outside.err).toContain('wf tell runs from a Claude Code session');
	expect(outside.err).toContain('type it in pane w1:p1');
	expect(s.wf(s.main, ['tell', 'nobody', 'hello'], undefined, { CLAUDE_PID: String(process.pid) }).err).toContain('no live agent named nobody');
	expect(s.h.calls().slice(before).some((c) => c[1] === 'prompt' || c[1] === 'send-keys')).toBe(false);
});

/** The agent's turn ended at this herdr state_change_seq, as after asking. */
function stopped(s: ReturnType<typeof setup>, seq: number): void {
	const state = s.h.state();
	state.agents![0].agent_status = 'done';
	state.agents![0].state_change_seq = seq;
	s.h.set(state);
}

const notifications = (s: ReturnType<typeof setup>) => s.h.calls().filter((c) => c[0] === 'notification');

test('with no watch running, ask goes to the orchestrator by the SendMessage it prints, and a watch started after returns neither the question nor the stop on it', () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	expect(s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) }).code).toBe(0);
	s.session(livePid(), 'session-dash', 'dash');
	const r = s.wf(s.wtPath, ['ask', 'Which', 'title', 'reads', 'best?']);
	expect(r.err).not.toContain('✗');
	expect(r.out).toContain('Ask the orchestrator now, with SendMessage to "orch": "wf: dash asks, in main: Which title reads best? (answer by SendMessage to `dash`)". Then stop: the answer comes as a message.');
	expect(notifications(s)).toEqual([]);

	// the message carried it, so the orchestrator restarting its watch is not woken again;
	// and the agent stopped on its question, which is no idle news
	stopped(s, 3);
	expect(s.wf(s.main, ['watch', '--timeout', '300']).code).toBe(3);
	const status = s.wf(s.main, ['status']).out;
	expect(status).toMatch(/dash\s+0\/0\s+claude stopped\s+-\s+answer the agent: Which title reads best\?/);
	expect(status).toMatch(/· dash asks the orchestrator \(asked \d+s ago\): Which title reads best\?/);
	expect(notifications(s)).toEqual([]);
});

test('with the orchestrator\'s watch running, ask prints no SendMessage and the watch delivers the question, for an agent it spawned and one spawned from a terminal; a long question comes on stdin', async () => {
	const s = setup();
	// spawned from a terminal: no orchestrator session recorded
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	// and a session spawned it
	s.session(process.pid, 's-orch', 'orch');
	expect(s.wf(s.main, ['spawn', 'blog', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) }).code).toBe(0);
	s.session(livePid(), 'session-blog', 'blog');
	const common = git(s.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	const watch = Bun.spawn(['bun', CLI, 'watch', '--timeout', '20000'], { cwd: s.main, env: { ...s.env, CLAUDE_PID: String(process.pid) }, stdout: 'pipe', stderr: 'pipe' });
	cleanups.push(() => watch.kill());
	for (const end = Date.now() + 10_000; !existsSync(join(common, 'wf', 'watch.pid')) && Date.now() < end; ) await Bun.sleep(50);
	const blog = s.wf(join(s.home, 'worktrees', 'main', 'worktree-blog'), ['ask', 'Which', 'title?']);
	expect(blog.out).toContain("The orchestrator's `bun wf watch` delivers it. Stop here: the answer comes as a message.");
	expect(blog.out).not.toContain('SendMessage');
	const r = s.wf(s.wtPath, ['ask'], 'Plan:\n1. one command\n2. two commands\nI recommend 1.\n');
	expect(r.err).not.toContain('✗');
	expect(r.out).toContain("The orchestrator's `bun wf watch` delivers it. Stop here: the answer comes as a message.");
	expect(r.out).not.toContain('SendMessage');
	expect(await watch.exited).toBe(0);
	expect(await new Response(watch.stdout).text()).toContain('question blog (pane w2:p1): Which title?\n\nAnswer as the person\'s filter (AGENTS.md), by SendMessage to `blog`.\n');
	const next = s.wf(s.main, ['watch', '--timeout', '300'], undefined, { CLAUDE_PID: String(process.pid) });
	expect(next.out).toContain('question dash (pane w1:p1): Plan:\n1. one command\n2. two commands\nI recommend 1.');
	expect(notifications(s)).toEqual([]);
}, 20_000);

test('ask - reads the question from stdin', () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) });
	const r = s.wf(s.wtPath, ['ask', '-'], 'Plan:\n1. one command\nI recommend 1.\n');
	expect(r.code).toBe(0);
	// no session runs for the agent: tell says why, and what to do
	expect(r.out).toContain('"wf: dash asks, in main: Plan:\\n1. one command\\nI recommend 1. (answer by `bun wf tell dash`)"');
	const common = git(s.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	expect(JSON.parse(readFileSync(join(common, 'wf', 'dash', 'question.json'), 'utf8')).question).toBe('Plan:\n1. one command\nI recommend 1.');
});

test('alone, ask calls the person with the question, and the watch leaves the agent to them', () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) });
	// the orchestrator's session ended, and no watch runs
	rmSync(join(s.home, 'sessions', `${process.pid}.json`));
	expect(s.wf(s.wtPath, ['ask']).err).toContain('`bun wf ask "<question>"`');
	const r = s.wf(s.wtPath, ['ask', 'Which', 'title', 'reads', 'best?']);
	expect(r.out).toContain('✓ no orchestrator runs for dash: the person was called. Ask them in your pane now, then stop.');
	expect(notifications(s)).toEqual([['notification', 'show', 'wf: dash waits for you', '--body', 'main · pane w1:p1: Which title reads best?', '--sound', 'request']]);
	stopped(s, 3);
	const watch = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(watch.code).toBe(3);
	expect(watch.out).toContain('nothing to act on yet');
	expect(s.wf(s.main, ['status']).out).toContain('answer the person: Which title reads best?');
});

test('a call herdr does not show is never told as made: spawn, report and ask say it did not go out', () => {
	const s = setup({ herdr: { startBlocked: true, notification: 'no_foreground_client' } });
	const spawn = s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	expect(spawn.code).toBe(0);
	expect(spawn.out).toContain('dash stopped while starting; the call to the person did not go out (pane w1:p1)');
	expect(spawn.err).toContain('herdr did not show the notification "wf: dash waits for you": no_foreground_client');
	// no orchestrator session and no watch: report and ask call the person
	const report = s.wf(s.wtPath, ['report'], 'Done.\n');
	expect(report.out).toContain('! the orchestrator runs no `bun wf watch` for main, and the call to the person did not go out');
	const ask = s.wf(s.wtPath, ['ask', 'Which title?']);
	expect(ask.out).toContain('! no orchestrator runs for dash, and the call to the person did not go out: ask them in your pane now, then stop.');
	for (const r of [spawn, report, ask]) expect(r.out).not.toContain('the person was called');
});

test('a tell answers the stop it reached: watch does not return that stop as idle, and returns the next one', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	s.session(process.pid, 's-orch', 'orch');
	s.session(livePid(), 'session-dash', 'dash');
	s.wf(s.wtPath, ['ask', 'Which title?']);
	// the agent stops on its question, and the answer comes by tell
	stopped(s, 3);
	expect(s.wf(s.main, ['tell', 'dash', 'The', 'short', 'one.'], undefined, { CLAUDE_PID: String(process.pid) }).code).toBe(0);
	const quiet = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(quiet.out).not.toContain('idle dash');
	expect(quiet.code).toBe(3);
	// it took the answer and stopped again, with no report
	stopped(s, 5);
	expect(s.wf(s.main, ['watch', '--timeout', '300']).out).toContain('idle dash');
});

test('a turn past the stop the watch saw answers the question with no tell (a SendMessage straight to the agent, the person in its pane); a dialog in the asking turn, other agents and a new session do not', () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) });
	s.wf(s.wtPath, ['ask', 'Which title?']);
	const common = git(s.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	const seq: number = JSON.parse(readFileSync(join(common, 'wf', 'dash', 'question.json'), 'utf8')).seq;
	expect(typeof seq).toBe('number');
	const at = (status: FakeAgent['agent_status'], n: number) => {
		const state = s.h.state();
		state.agents![0].agent_status = status;
		state.agents![0].state_change_seq = n;
		s.h.set(state);
	};
	const status = () => s.wf(s.main, ['status']).out;
	// one more tool call after asking shows a dialog, which the person approves: the asking turn goes on
	at('blocked', seq + 1);
	const blocked = status();
	expect(blocked).toContain('answer the person: on screen');
	expect(blocked).toContain('· dash asks the orchestrator');
	at('working', seq + 2);
	expect(status()).toMatch(/dash\s+0\/0\s+claude working\s+-\s+answer the agent: Which title\?/);
	// it stops on its question, past other agents' changes on herdr's one counter; the watch records that stop, and the stop is no news
	at('done', seq + 7);
	expect(s.wf(s.main, ['watch', '--timeout', '300'], undefined, { CLAUDE_PID: String(process.pid) }).code).toBe(3);
	expect(status()).toMatch(/dash\s+0\/0\s+claude stopped\s+-\s+answer the agent: Which title\?/);
	// `/clear` in the pane: a new session at the same seq, no turn
	at('idle', seq + 7);
	expect(status()).toContain('· dash asks the orchestrator');
	// the answer came by SendMessage straight to the agent, and no tell ran: it works again
	at('working', seq + 9);
	const working = status();
	expect(working).toMatch(/dash\s+0\/0\s+claude working\s+-\s+working/);
	expect(working).not.toContain('asks the orchestrator');
	// it stopped with no report: that stop is news
	at('done', seq + 10);
	expect(s.wf(s.main, ['watch', '--timeout', '300'], undefined, { CLAUDE_PID: String(process.pid) }).out).toContain('idle dash');
});

test('a watch started right after spawn returns nothing for the agent until it stops on its own', async () => {
	// the agent takes its task late (it did not take the prompt among its arguments): it sits
	// idle, from before the task, while spawn waits to see it start
	const s = setup({ herdr: { launchPromptIgnored: true } });
	const spawn = Bun.spawn(['bun', CLI, 'spawn', 'dash', '--task', s.task], { cwd: s.main, env: { ...s.env, WF_SETTLE_MS: '2000' }, stdout: 'pipe', stderr: 'pipe' });
	cleanups.push(() => spawn.kill());
	for (const end = Date.now() + 10_000; !existsSync(join(s.main, '.git', 'wf', 'dash', 'meta.json')) && Date.now() < end; ) await Bun.sleep(50);
	const early = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(early.out).not.toContain('idle dash');
	expect(early.code).toBe(3);
	expect(await spawn.exited).toBe(0);
	// it took the task, worked and stopped with no report: that stop is news
	stopped(s, 3);
	expect(s.wf(s.main, ['watch', '--timeout', '300']).out).toContain('idle dash');
}, 20_000);

test('spawn names the orchestrator session; with no watch, report calls the person and prints the SendMessage that carries it, and a watch started after returns it only when no message did', () => {
	const s = setup();
	// the session running spawn, as Claude Code records it; this test's own process stands in for it
	mkdirSync(join(s.home, 'sessions'));
	writeFileSync(join(s.home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's-1', name: 'orch', cwd: s.main }));
	expect(s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) }).code).toBe(0);
	expect(readFileSync(join(s.main, '.git', 'wf', 'dash', 'task.md'), 'utf8')).toContain(`The orchestrator is the Claude Code session \`orch\`, in ${s.main}.`);

	const r = s.wf(s.wtPath, ['report'], 'Done.\n');
	expect(r.out).toContain('! the orchestrator runs no `bun wf watch` for main: the person was called');
	expect(s.h.calls()).toContainEqual(['notification', 'show', 'wf: dash reported', '--body', 'main: the orchestrator runs no `bun wf watch`, so it may not see it; `bun wf status`', '--sound', 'request']);
	expect(r.out).toContain(`Tell the orchestrator now, with SendMessage to "orch": "wf: dash reported in main: ${join(s.main, '.git', 'wf', 'dash', 'report.md')}; read the diff and look at the screens, then \`bun wf ship dash\`". Then stop.`);
	expect(s.wf(s.main, ['watch', '--timeout', '300'], undefined, { CLAUDE_PID: String(process.pid) }).code).toBe(3);

	// the session gone, the agent hears so, and the next session's watch delivers it
	rmSync(join(s.home, 'sessions', `${process.pid}.json`));
	const again = s.wf(s.wtPath, ['report'], 'Done again.\n').out;
	expect(again).toContain("The orchestrator's session (orch) no longer runs. Stop here.");
	expect(again).not.toContain('SendMessage');
	const next = livePid();
	s.session(next, 's-2', 'orch');
	expect(s.wf(s.main, ['watch', '--timeout', '300'], undefined, { CLAUDE_PID: String(next) }).out).toContain('report dash:');
});

test('with a watch running, report prints no SendMessage and the watch delivers it: with the orchestrator\'s session, and after a hand-over to a new one', async () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) });
	const common = git(s.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	const reportOnce = async (text: string, orchestrator: number) => {
		const watch = Bun.spawn(['bun', CLI, 'watch', '--timeout', '20000'], { cwd: s.main, env: { ...s.env, CLAUDE_PID: String(orchestrator) }, stdout: 'pipe', stderr: 'pipe' });
		cleanups.push(() => watch.kill());
		for (const end = Date.now() + 10_000; !existsSync(join(common, 'wf', 'watch.pid')) && Date.now() < end; ) await Bun.sleep(50);
		const r = s.wf(s.wtPath, ['report'], text);
		expect(r.out).toContain("The orchestrator's `bun wf watch` delivers it. Stop here.");
		expect(r.out).not.toContain('SendMessage');
		expect(await watch.exited).toBe(0);
		return new Response(watch.stdout).text();
	};
	const out = await reportOnce('Done.\n', process.pid);
	expect(out).toContain('report dash:');
	// the action alone: the review's rule is the block's; the foot starts the watch again first
	expect(out).toContain('\n\nRead the diff and look at the screens, then `bun wf ship dash`.\n\nStart `bun wf watch` again in the background, then act.');
	// the session that spawned the agent ended; a fresh one runs the watch
	rmSync(join(s.home, 'sessions', `${process.pid}.json`));
	const fresh = livePid();
	s.session(fresh, 's-2', 'orch');
	expect(await reportOnce('Done again.\n', fresh)).toContain('Done again.');
	expect(notifications(s)).toEqual([]);
}, 30_000);

/** A stand-in for a running `wf watch` (its command names `watch`), recorded as the one session `orchestrator` started; adopted by pid 1 when `orphan`. */
function standIn(s: ReturnType<typeof setup>, orchestrator: number | null, orphan = false): void {
	let pid: number;
	if (orphan) {
		// `&` in a shell that exits at once
		const file = join(s.home, 'orphan.pid');
		Bun.spawnSync(['sh', '-c', `bun -e 'await Bun.sleep(60000)' watch > /dev/null 2>&1 & echo $! > ${file}`]);
		pid = Number(readFileSync(file, 'utf8'));
		cleanups.push(() => process.kill(pid));
	} else {
		const p = Bun.spawn(['bun', '-e', 'await Bun.sleep(60000)', 'watch']);
		cleanups.push(() => p.kill());
		pid = p.pid;
	}
	const session = orchestrator === null ? null : JSON.parse(readFileSync(join(s.home, 'sessions', `${orchestrator}.json`), 'utf8'));
	const record = { pid, startedAt: new Date().toISOString(), orchestrator: session ? { name: session.name, sessionId: session.sessionId, pid: session.pid } : undefined };
	writeFileSync(join(s.main, '.git', 'wf', 'watch.pid'), JSON.stringify(record));
}

test('ask and report leave their event to a watch only when the orchestrator reads it: its session, alive, with a live parent; an orphaned watch, another session\'s and one with none leave it to the agent\'s message', () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	expect(s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) }).code).toBe(0);
	s.session(livePid(), 'session-dash', 'dash');
	const other = livePid();
	s.session(other, 's-other', 'other');
	const state = new State(join(s.main, '.git'));
	const report = state.reportPath('dash');
	const cases: [string, () => void, boolean][] = [
		['the orchestrator\'s', () => standIn(s, process.pid), true],
		['orphaned', () => standIn(s, process.pid, true), false],
		['another session\'s', () => standIn(s, other), false],
		['a terminal\'s', () => standIn(s, null), false]
	];
	for (const [label, start, silences] of cases) {
		start();
		const calls = notifications(s).length;
		const ask = s.wf(s.wtPath, ['ask', `Which title, with ${label} watch?`]).out;
		const done = s.wf(s.wtPath, ['report'], `Done, with ${label} watch.\n`).out;
		if (silences) {
			expect(ask).toContain("The orchestrator's `bun wf watch` delivers it. Stop here: the answer comes as a message.");
			expect(done).toContain("The orchestrator's `bun wf watch` delivers it. Stop here.");
			expect(ask + done).not.toContain('SendMessage');
			expect(notifications(s).length).toBe(calls);
		} else {
			expect(ask).toContain(`Ask the orchestrator now, with SendMessage to "orch": "wf: dash asks, in main: Which title, with ${label} watch? (answer by SendMessage to \`dash\`)"`);
			expect(done).toContain(`Tell the orchestrator now, with SendMessage to "orch": "wf: dash reported in main: ${report};`);
			// the message carries it: no watch delivers it again
			expect(state.delivered().dash).toMatchObject({ question: state.question('dash')!.at, report: state.reportTime('dash') });
			expect(notifications(s).length).toBe(calls + 1);
		}
	}
});

test('a watch orphaned while it runs clears its record and stops without delivering, so the next report sends its message', async () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) });
	const pid = join(s.main, '.git', 'wf', 'watch.pid');
	const out = join(s.home, 'watch.out');
	// `&` in a shell that exits once the watch has recorded itself: pid 1 adopts the watch
	Bun.spawn(['sh', '-c', `bun ${CLI} watch --timeout 20000 > ${out} 2>&1 & while [ ! -s ${pid} ]; do sleep 0.05; done`], { cwd: s.main, env: { ...s.env, CLAUDE_PID: String(process.pid) } });
	for (const end = Date.now() + 10_000; !existsSync(pid) && Date.now() < end; ) await Bun.sleep(50);
	expect(existsSync(pid)).toBe(true);
	for (const end = Date.now() + 10_000; existsSync(pid) && Date.now() < end; ) await Bun.sleep(50);
	expect(existsSync(pid)).toBe(false);
	expect(readFileSync(out, 'utf8')).toContain('✗ the shell that started this watch is gone, so nobody reads it: it stops without delivering.');
	expect(s.wf(s.wtPath, ['report'], 'Done.\n').out).toContain('Tell the orchestrator now, with SendMessage to "orch"');
}, 20_000);

test('a watch from a terminal says it wakes no orchestrator, delivers none of a session\'s agents\' events, and never takes the place of the orchestrator\'s watch', async () => {
	const s = setup();
	s.session(process.pid, 's-orch', 'orch');
	s.wf(s.main, ['spawn', 'dash', '--task', s.task], undefined, { CLAUDE_PID: String(process.pid) });
	// the agent stopped with no report: news for its orchestrator
	stopped(s, 3);
	const terminal = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(terminal.err).toContain('! no Claude Code session started this watch, so it wakes no Claude Code orchestrator');
	expect(terminal.err).toContain('the Bash tool with `run_in_background`');
	expect(terminal.out).not.toContain('idle dash');
	expect(terminal.code).toBe(3);
	// it marked nothing: the orchestrator's watch delivers it
	expect(s.wf(s.main, ['watch', '--timeout', '300'], undefined, { CLAUDE_PID: String(process.pid) }).out).toContain('idle dash');

	const pid = join(s.main, '.git', 'wf', 'watch.pid');
	const watch = Bun.spawn(['bun', CLI, 'watch', '--timeout', '20000'], { cwd: s.main, env: { ...s.env, CLAUDE_PID: String(process.pid) }, stdout: 'pipe', stderr: 'pipe' });
	cleanups.push(() => watch.kill());
	for (const end = Date.now() + 10_000; !existsSync(pid) && Date.now() < end; ) await Bun.sleep(50);
	const refused = s.wf(s.main, ['watch', '--timeout', '300']);
	expect(refused.code).toBe(1);
	expect(refused.err).toContain(`the orchestrator's \`bun wf watch\` runs (session orch, pid ${watch.pid}), and one from here would end it and wake nobody`);
	expect(JSON.parse(readFileSync(pid, 'utf8')).pid).toBe(watch.pid);
	expect(watch.exitCode).toBeNull();
}, 20_000);

test('status lists the worktree with its agent, report and URL', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	const out = s.wf(s.main, ['status']).out;
	expect(out).toMatch(/dash\s+0\/0\s+claude working\s+-\s+working\s+http:\/\/localhost:5203/);
	expect(out).not.toContain('has no agent');
});

test('status says what comes next, whether a watch runs, and which reports wait to ship', async () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	s.wf(s.wtPath, ['report'], 'Done.\n');
	const state = s.h.state();
	state.agents![0].agent_status = 'done';
	s.h.set(state);
	const out = s.wf(s.main, ['status']).out;
	expect(out).toMatch(/dash\s+0\/0\s+claude stopped\s+\d+s ago\s+check and ship/);
	expect(out).toMatch(/! no `bun wf watch` runs for this repository: .*\n    start `bun wf watch` in the background\n/);
	expect(out).toMatch(/· dash's report waits to ship \(reported \d+s ago\)/);

	// a watch running for the repository is named instead (it has delivered the report already)
	const common = git(s.main, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	writeFileSync(join(common, 'wf', 'watch.json'), JSON.stringify({ dash: { report: Date.now() + 60_000 } }));
	const watch = Bun.spawn(['bun', CLI, 'watch', '--timeout', '20000'], { cwd: s.main, env: s.env, stdout: 'pipe', stderr: 'pipe' });
	cleanups.push(() => watch.kill());
	for (const end = Date.now() + 10_000; !existsSync(join(common, 'wf', 'watch.pid')) && Date.now() < end; ) await Bun.sleep(50);
	expect(s.wf(s.main, ['status']).out).toMatch(new RegExp(`\`bun wf watch\` runs \\(pid ${watch.pid}, started \\d+s ago\\)`));
}, 20_000);

test('status marks each worktree with no agent, and says what to do', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	const state = s.h.state();
	state.agents = [];
	s.h.set(state);
	// made by hand: one on a wf branch, one detached, as a release worktree is
	git(s.main, 'worktree', 'add', '-q', '-b', 'worktree/mig', join(s.dir, 'worktree-mig'), 'dev');
	git(s.main, 'worktree', 'add', '-q', '--detach', join(s.dir, 'release'), 'dev');
	const r = s.wf(s.main, ['status']);
	expect(r.code).toBe(0);
	expect(r.out).toMatch(/dash\s+0\/0\s+! none/);
	expect(r.out).toContain('! dash has no agent the person can watch\n    `bun wf resume dash` starts its agent again');
	expect(r.out).toContain('! mig has no agent the person can watch\n    start an agent in its pane, or `bun wf close mig`');
	expect(r.out).toContain(`! release has no agent the person can watch\n    start an agent in its pane, or \`git worktree remove ${join(s.dir, 'release')}\``);
});

test('resume refuses while an agent is live, and starts it again with --continue once it is gone', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	// with no session for the agent, the refusal names `wf tell`, which says why
	expect(s.wf(s.main, ['resume', 'dash']).err).toContain('an agent is live in pane w1:p1: reach it by `bun wf tell dash`');
	s.session(livePid(), 'session-dash', 'dash · footer');
	expect(s.wf(s.main, ['resume', 'dash']).err).toContain('an agent is live in pane w1:p1: reach it by SendMessage to `dash · footer`');
	const state = s.h.state();
	state.agents = [];
	s.h.set(state);
	const r = s.wf(s.main, ['resume', 'dash']);
	expect(r.out).toContain('✓ dash resumed');
	expect(s.h.calls()).toContainEqual(['agent', 'start', 'dash', '--kind', 'claude', '--pane', 'w1:p1', '--timeout', '60000', '--', '--permission-mode', 'auto', '--name', 'dash', '--disallowedTools', 'AskUserQuestion', 'EnterPlanMode', '--continue']);
});

test('spawn --model passes the model to the agent, and resume keeps it', () => {
	const s = setup();
	expect(s.wf(s.main, ['spawn', 'dash', '--task', s.task, '--model', 'fable']).code).toBe(0);
	const state = s.h.state();
	expect((state.agents![0] as FakeAgent).argv).toEqual(['--permission-mode', 'auto', '--name', 'dash', '--disallowedTools', 'AskUserQuestion', 'EnterPlanMode', '--model', 'fable', '--', expect.stringContaining('Your task is in')]);
	state.agents = [];
	s.h.set(state);
	expect(s.wf(s.main, ['resume', 'dash']).code).toBe(0);
	expect(s.h.calls()).toContainEqual(['agent', 'start', 'dash', '--kind', 'claude', '--pane', 'w1:p1', '--timeout', '60000', '--', '--permission-mode', 'auto', '--name', 'dash', '--disallowedTools', 'AskUserQuestion', 'EnterPlanMode', '--model', 'fable', '--continue']);
});

test('close refuses uncommitted work, then closes by path and keeps the branch unless asked', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	writeFileSync(join(s.wtPath, 'loose.txt'), 'x');
	const state = s.h.state();
	state.agents![0].agent_status = 'idle';
	s.h.set(state);
	expect(s.wf(s.main, ['close', 'dash']).err).toContain('uncommitted changes');
	const r = s.wf(s.main, ['close', 'dash', '--force']);
	expect(r.out).toContain('✓ dash closed');
	expect(s.h.calls()).toContainEqual(['worktree', 'remove', '--workspace', 'w1', '--force']);
	expect(git(s.main, 'branch', '--list', 'worktree/dash')).toContain('worktree/dash');
});

test('a worktree the orchestrator closes is no news: a watch running meanwhile never returns it as gone', async () => {
	const s = setup({ herdr: { removeMs: 3000 } });
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	stopped(s, 3);
	expect(s.wf(s.main, ['watch', '--timeout', '300']).out).toContain('idle dash');
	const watch = Bun.spawn(['bun', CLI, 'watch', '--timeout', '10000'], { cwd: s.main, env: s.env, stdout: 'pipe', stderr: 'pipe' });
	cleanups.push(() => watch.kill());
	for (const end = Date.now() + 10_000; !existsSync(join(s.main, '.git', 'wf', 'watch.pid')) && Date.now() < end; ) await Bun.sleep(50);
	// herdr ends the agent, then takes a while removing the folder
	expect(s.wf(s.main, ['close', 'dash']).out).toContain('✓ dash closed');
	expect(await watch.exited).toBe(0);
	const out = await new Response(watch.stdout).text();
	expect(out).not.toContain('gone dash');
	expect(out).toContain('nothing to watch');
}, 20_000);

test('close stops every process in the worktree, orphans included, before removing it; the pane shell is herdr\'s', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	// a dev server left behind, orphaned (PPID 1), rewriting files as pb_data and .svelte-kit are
	const server = writer(s.wtPath);
	cleanups.push(server.stop);
	const shell = Bun.spawn(['sleep', '30'], { cwd: s.wtPath });
	cleanups.push(() => shell.kill());
	const state = s.h.state();
	state.agents![0].agent_status = 'idle';
	state.shells = { 'w1:p1': shell.pid };
	s.h.set(state);
	const r = s.wf(s.main, ['close', 'dash']);
	expect(r.err).not.toContain('✗');
	expect(r.out).toContain('✓ dash closed');
	expect(server.alive()).toBe(false);
	expect(existsSync(s.wtPath)).toBe(false);
	expect(shell.killed || shell.exitCode !== null).toBe(false);
});

test('ship --reported delivers every report waiting, one after another, the oldest first; a report its agent took a turn after was answered', () => {
	const s = setup();
	const task = (name: string) => {
		expect(s.wf(s.main, ['spawn', name, '--task', s.task]).code).toBe(0);
		const wt = join(s.home, 'worktrees', 'main', `worktree-${name}`);
		git(wt, 'commit', '-q', '--allow-empty', '-m', `feat: ${name}`);
		return wt;
	};
	const a = task('alpha');
	const b = task('beta');
	task('gamma');
	const d = task('delta');
	s.wf(d, ['report'], 'delta done\n');
	s.wf(b, ['report'], 'beta done\n');
	s.wf(a, ['report'], 'alpha done\n');
	const state = s.h.state();
	// each agent stops after its report, and a watch records those stops
	for (const agent of state.agents!) {
		agent.agent_status = 'done';
		agent.state_change_seq = (agent.state_change_seq as number) + 1;
	}
	s.h.set(state);
	s.wf(s.main, ['watch', '--timeout', '300']);
	// delta's report was answered: its agent took a turn after it and stopped again
	const after = s.h.state();
	const delta = after.agents!.find((x) => x.name === 'delta')!;
	delta.state_change_seq = (delta.state_change_seq as number) + 3;
	s.h.set(after);
	const r = s.wf(s.main, ['ship', '--reported']);
	expect(r.err).not.toContain('✗');
	expect(r.code).toBe(0);
	expect(r.out).toContain('━━ beta (1 of 2)');
	expect(r.out).toContain('━━ alpha (2 of 2)');
	expect(r.out).toContain('queue:\n  ✓ beta\n  ✓ alpha');
	// alpha brought in dev with beta delivered
	const log = git(s.main, 'log', '--format=%s', 'dev').split('\n');
	expect(log[0]).toBe("Merge branch 'dev' into worktree/alpha");
	expect(log).toContain('feat: beta');
	expect(log).toContain('feat: alpha');
	// gamma has no report, and delta's was answered: they stay
	expect(git(s.main, 'branch', '--list', 'worktree/gamma')).toContain('worktree/gamma');
	expect(git(s.main, 'branch', '--list', 'worktree/delta')).toContain('worktree/delta');
	expect(s.wf(s.main, ['ship', '--reported']).err).toContain('no report waits to ship');
}, 30_000);

test('ship --reported with herdr down says that every report reads as waiting, an answered one too', () => {
	const s = setup();
	s.wf(s.main, ['spawn', 'dash', '--task', s.task]);
	git(s.wtPath, 'commit', '-q', '--allow-empty', '-m', 'feat: dash');
	s.wf(s.wtPath, ['report'], 'done\n');
	// the agent stops after its report, a watch records the stop, and a turn after it answers the report
	const move = (by: number) => {
		const state = s.h.state();
		state.agents![0].agent_status = 'done';
		state.agents![0].state_change_seq = (state.agents![0].state_change_seq as number) + by;
		s.h.set(state);
	};
	move(1);
	s.wf(s.main, ['watch', '--timeout', '300']);
	move(2);
	expect(s.wf(s.main, ['ship', '--reported']).err).toContain('no report waits to ship');
	s.h.set({ ...s.h.state(), agentListFails: true });
	const r = s.wf(s.main, ['ship', '--reported', '--dry-run']);
	expect(r.err).toContain('! herdr did not list its agents (herdr server is not running): every report reads as waiting, answered or not');
	expect(r.out).toContain('↳ worktree/dash → dev');
	expect(r.code).toBe(0);
});

test("ship's gates read the worktree's .env.local over the main checkout's .env", () => {
	const s = setup();
	// a project as it installs wf: `bun wf` runs the script, the script the bin, the bin its shebang
	const config = `export default {
	integration: 'dev',
	prepare: 'printf "KEY=worktree\\\\n" > .env.local',
	gates: { cheap: ['bun show.ts'] }
};
`;
	writeFileSync(join(s.main, 'wf.config.ts'), config);
	writeFileSync(join(s.main, 'package.json'), JSON.stringify({ name: 'proj', scripts: { wf: 'wf' } }));
	writeFileSync(join(s.main, 'show.ts'), "console.log('gate KEY=' + process.env.KEY);\n");
	writeFileSync(join(s.main, '.gitignore'), '.env\n.env.local\nnode_modules/\n');
	git(s.main, 'add', '-A');
	git(s.main, 'commit', '-q', '-m', 'chore: wf');
	mkdirSync(join(s.main, 'node_modules/.bin'), { recursive: true });
	symlinkSync(CLI, join(s.main, 'node_modules/.bin/wf'));
	writeFileSync(join(s.main, '.env'), 'KEY=main\n');
	expect(s.wf(s.main, ['spawn', 'dash', '--task', s.task]).code).toBe(0);
	git(s.wtPath, 'commit', '-q', '--allow-empty', '-m', 'feat: dash');
	const state = s.h.state();
	state.agents![0].agent_status = 'done';
	s.h.set(state);
	// as the person's shell runs it: `bun test`'s NODE_ENV=test keeps Bun from loading .env.local
	const { NODE_ENV: _, ...env } = s.env;
	const p = Bun.spawnSync(['bun', 'wf', 'ship', 'dash'], { cwd: s.main, env, stdout: 'pipe', stderr: 'pipe' });
	expect(p.stderr.toString()).not.toContain('✗');
	expect(p.exitCode).toBe(0);
	expect(p.stdout.toString()).toContain('gate KEY=worktree');
}, 30_000);

test('wf --skill prints the rules for where it runs: the agent\'s in a worktree, the orchestrator\'s in the main checkout, both with --all', () => {
	const s = setup();
	const wt = worktree(s.main, 'dash');
	const agent = s.wf(wt, ['--skill']);
	expect(agent.code).toBe(0);
	expect(agent.out).toStartWith('**In a worktree: the agent**\n');
	expect(agent.out).toContain('- Run the cheap gates (`true`).');
	expect(agent.out).toContain('what to look at (`APP_URL` in `.env.local`)');
	expect(agent.out).toContain('**Alone in a worktree**');
	expect(agent.out).not.toContain('In the main checkout');
	const orch = s.wf(s.main, ['--skill']);
	expect(orch.code).toBe(0);
	expect(orch.out).toStartWith('**In the main checkout: the orchestrator**\n');
	expect(orch.out).toContain('`bun wf ship <name>` brings `dev` in');
	expect(orch.out).not.toContain('In a worktree');
	// with no kb block in AGENTS.md, the rules name no kb command
	expect(orch.out).not.toContain('kb decision new');
	const all = s.wf(wt, ['--skill', '--all']);
	expect(all.code).toBe(0);
	expect(all.out).toBe(`${agent.out.trimEnd()}\n\n${orch.out}`);
	// kb's block in the main checkout's AGENTS.md: the roles name its commands
	writeFileSync(join(s.main, 'AGENTS.md'), '# P\n\n<!-- kb:global · generated by kb gen -->\nkb\n<!-- /kb:global -->\n');
	expect(s.wf(s.main, ['--skill']).out).toContain('Record an answer that is a decision with `kb decision new`.');
});
