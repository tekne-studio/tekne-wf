import { existsSync, fstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { currentSession, sessionAt } from '../claude';
import type { Options } from '../cli';
import { WfError, inMain } from '../context';
import * as herdr from '../herdr';
import { orphaned } from '../procs';
import { speaksFor, type Meta, type Watcher } from '../state';
import { clearReturned, clip, dueQuestions, dueReminders, dueReports, markDelivered, noteStops, openQuestion, selectEvent, stopsOf, type Snapshot } from '../watch';
import { agentAt, ago, answerBy } from '../worktrees';
import { callPerson, heldBlocked } from './alert';
import { PLUGIN_ID } from './setup';
import { herdrReady } from './spawn';

const POLL_MS = 2000;
// the restart lives here, not in the rules block: said at the moment it applies, and `&`
// gets watch's own refusal
const AGAIN = 'Start `bun wf watch` again in the background, then act.';
const HOW = "run it as your harness's own background command (in Claude Code, the Bash tool with `run_in_background`) and read what it prints; never with `&`, `nohup`, `disown` or its output discarded";
/** The exit of a watch a newer one replaced: its owner does not start it again. */
const REPLACED = 4;

/** stdout is /dev/null: what watch prints would reach nobody. */
function discarded(): boolean {
	try {
		const out = fstatSync(1);
		return out.isCharacterDevice() && out.rdev === statSync('/dev/null').rdev;
	} catch {
		return false;
	}
}

/**
 * Returns at the first event for the orchestrator; until then, calls the person again for
 * an agent left blocked, and once for a question or a report the orchestrator left waiting.
 * The person's first call is the herdr plugin's, once an agent stays blocked through the
 * hold; without the plugin, the blocked event makes it, after the same hold. A question to
 * the orchestrator calls nobody: it is the orchestrator's, the person's filter.
 *
 * An event is delivered once: a watch nobody reads would swallow it. So watch refuses an
 * output sent to /dev/null, stops without delivering once orphaned (the shell that started
 * it gone), and runs once per repository, a new watch replacing the old. It delivers only
 * the events of the agents it speaks for (`speaksFor`), whose `ask` and `report` leave
 * theirs to it; another agent's message carries its own, and a watch that speaks for it
 * delivers the rest.
 */
export async function watchCommand(_: string[], opt: Options): Promise<number> {
	const { main, state } = await inMain('watch');
	if (discarded()) throw new WfError(`\`bun wf watch\` prints what to act on, and its output goes to /dev/null: ${HOW}`);
	if (orphaned(process.pid)) throw new WfError(`the shell that started \`bun wf watch\` already exited (\`&\`, \`nohup\`, \`disown\`), so it wakes no orchestrator: ${HOW}`);
	await herdrReady();

	// the session that reads this watch, which `ask` and `report` match against the agent's orchestrator
	const session = currentSession();
	const self: Watcher = { pid: process.pid, startedAt: new Date().toISOString(), orchestrator: session ? { name: session.name, sessionId: session.sessionId, pid: session.pid } : undefined };
	const previous = state.watcher();
	if (!session) {
		// it would end the orchestrator's watch, which would hear that this one goes on for it
		const reader = previous?.orchestrator ? sessionAt(previous.orchestrator.pid) : null;
		if (reader && !orphaned(previous!.pid))
			throw new WfError(`the orchestrator's \`bun wf watch\` runs (session ${reader.name}, pid ${previous!.pid}), and one from here would end it and wake nobody: leave it; \`bun wf status\` shows what waits`);
		console.error(`! no Claude Code session started this watch, so it wakes no Claude Code orchestrator: it speaks only for agents \`wf spawn\` started outside one, and leaves the others' events to their own messages. To wake the orchestrator, ${HOW}`);
	}
	// one watch per repository: this one records itself first, so the one it replaces
	// reads, as it stops, that a newer watch took over
	state.writeWatcher(self);
	process.on('exit', () => state.clearWatcher(process.pid));
	process.on('SIGINT', () => process.exit(130));
	process.on('SIGTERM', () => {
		const now = state.watcher();
		if (now && now.pid !== process.pid) {
			console.log(`replaced by a newer \`bun wf watch\` (pid ${now.pid}), which goes on watching: do not start another`);
			process.exit(REPLACED);
		}
		process.exit(143);
	});
	if (previous && previous.pid !== process.pid) {
		try {
			process.kill(previous.pid, 'SIGTERM');
			console.log(`↻ replaced the watch started at ${previous.startedAt} (pid ${previous.pid})`);
		} catch {
			// it ended meanwhile
		}
	}

	herdr.setEcho(false);
	const timeout = opt.timeout ? Number(opt.timeout) : 0;
	if (opt.timeout && !(timeout > 0)) throw new WfError('--timeout takes milliseconds');
	const deadline = timeout ? Date.now() + timeout : 0;
	const repo = basename(main);
	const plugin = (await herdr.pluginIds().catch((): string[] => [])).includes(PLUGIN_ID);

	for (;;) {
		if (orphaned(process.pid)) {
			// cleared now, so the next `ask` or `report` sends its own message
			state.clearWatcher(process.pid);
			console.error(`✗ the shell that started this watch is gone, so nobody reads it: it stops without delivering. ${HOW}`);
			return 1;
		}
		const metas: Record<string, Meta> = {};
		if (existsSync(state.dir))
			for (const name of readdirSync(state.dir)) {
				const m = state.meta(name);
				if (m) metas[name] = m;
			}
		if (!Object.keys(metas).length) {
			console.log('nothing to watch: no worktree started by `bun wf spawn` is open');
			return 0;
		}
		const live = await herdr.agentList();
		const agents: Snapshot['agents'] = {};
		for (const [name, m] of Object.entries(metas)) agents[name] = agentAt(live, m.path);
		const reports = Object.fromEntries(Object.keys(metas).map((n) => [n, state.reportTime(n)]));
		const questions = Object.fromEntries(Object.keys(metas).map((n) => [n, state.question(n)]));
		const reportSeqs = Object.fromEntries(Object.keys(metas).map((n) => [n, state.reportSeq(n)]));
		const snap: Snapshot = { metas, agents, reports, questions, reportSeqs };
		// the stop that ended a question's or a report's turn, recorded before either is read
		const read = clearReturned(state.delivered(), agents);
		let delivered = noteStops(snap, read);
		if (delivered !== read) state.writeDelivered(delivered);
		snap.stops = stopsOf(delivered);
		for (const name of dueReminders(snap, Date.now()))
			await callPerson(state, repo, name, agents[name]!.pane_id, true, agents[name]!.agent_status === 'blocked' ? undefined : openQuestion(snap, name)?.question);

		for (const name of dueQuestions(snap, delivered, Date.now())) {
			const q = openQuestion(snap, name)!;
			await herdr.notify(`wf: ${name}'s question waits`, `${repo}: asked the orchestrator ${ago(Date.parse(q.at))}, no answer yet: ${clip(q.question, 80)}`, 'request');
			delivered = { ...delivered, [name]: { ...delivered[name], questionReminded: q.at } };
			state.writeDelivered(delivered);
		}
		for (const name of dueReports(snap, delivered, Date.now(), (n) => state.shipping(n))) {
			await herdr.notify(`wf: ${name}'s report waits`, `${repo}: reported ${ago(snap.reports[name])}, neither shipped nor answered`, 'request');
			delivered = { ...delivered, [name]: { ...delivered[name], reminded: snap.reports[name] } };
			state.writeDelivered(delivered);
		}
		// another agent's events stay for a watch that speaks for it
		const own = Object.fromEntries(Object.entries(metas).filter(([, m]) => speaksFor(self, m)));
		const event = selectEvent({ ...snap, metas: own }, delivered);
		// a worktree closed or shipped since its meta was read is no news: its agent ended with it
		if (event && !state.meta(event.name)) continue;
		// a blocked state that goes away by itself within the hold waits on nobody
		if (event?.kind === 'blocked' && !(await heldBlocked(event.pane, event.seq))) continue;
		if (event) {
			state.writeDelivered(markDelivered(delivered, event));
			if (event.kind === 'blocked') {
				const call = plugin
					? 'the herdr plugin calls them'
					: (await callPerson(state, repo, event.name, event.pane))
						? 'the person was called'
						: 'the call to the person did not go out: tell them';
				console.log(`blocked ${event.name}: pane ${event.pane} shows an approval or a question, the person's to answer; ${call}.`);
			} else if (event.kind === 'question') {
				const pane = agents[event.name]?.pane_id ?? metas[event.name].pane;
				console.log(`question ${event.name} (pane ${pane}): ${openQuestion(snap, event.name)!.question}\n`);
				// the filter rule is AGENTS.md's, read on every turn: the event names it, never restates it
				console.log(`Answer as the person's filter (AGENTS.md), by ${answerBy(event.name, agents[event.name])}.`);
			} else if (event.kind === 'report') {
				console.log(`report ${event.name}: ${state.reportPath(event.name)}\n`);
				console.log(readFileSync(state.reportPath(event.name), 'utf8').trimEnd());
				console.log(`\nRead the diff and look at the screens, then \`bun wf ship ${event.name}\`.`);
			} else if (event.kind === 'idle') {
				console.log(`idle ${event.name}: the agent stopped with no report since its last prompt (pane ${event.pane}). Its screen:\n`);
				console.log((await herdr.agentRead(event.pane, 20).catch(() => '(screen unreadable)')).trimEnd());
				console.log(`\nAnswer by ${answerBy(event.name, agents[event.name])}.`);
			} else {
				console.log(`gone ${event.name}: no agent in its worktree; \`bun wf resume ${event.name}\` starts it again`);
			}
			console.log(`\n${AGAIN}`);
			return 0;
		}
		if (deadline && Date.now() >= deadline) {
			console.log('nothing to act on yet');
			return 3;
		}
		await Bun.sleep(Math.min(POLL_MS, deadline ? Math.max(0, deadline - Date.now()) : POLL_MS));
	}
}
