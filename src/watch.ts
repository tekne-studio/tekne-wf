// What `wf watch` returns: the first thing the orchestrator should act on, among the
// worktrees `wf spawn` started. Pure, so the order and the once-only delivery are tested
// on recorded herdr output.
import type { Agent } from './herdr';
import type { Delivered, Meta, Question } from './state';

export type WatchEvent =
	| { kind: 'blocked'; name: string; pane: string; seq: number }
	| { kind: 'question'; name: string; at: string }
	| { kind: 'report'; name: string; at: number }
	| { kind: 'idle'; name: string; pane: string; seq: number }
	| { kind: 'gone'; name: string };

export type Snapshot = {
	metas: Record<string, Meta>;
	/** the live agent in each worktree, by name */
	agents: Record<string, Agent | undefined>;
	/** each report's time in ms, 0 when there is none */
	reports: Record<string, number>;
	/** each agent's last question (`wf ask`), if it asked one */
	questions?: Record<string, Question | null | undefined>;
	/** the agent's herdr `state_change_seq` while it ran `wf report`, when herdr told it */
	reportSeqs?: Record<string, number | undefined>;
	/** the stops the watch recorded for each worktree (`Delivered.stops`) */
	stops?: Record<string, Record<string, number> | undefined>;
};

const stopped = (a: Agent | undefined) => a?.agent_status === 'idle' || a?.agent_status === 'done';

/**
 * The agent took a turn after the one that ran `seq` (`wf ask`, `wf report`): that turn
 * ended at the first stop the watch saw past `seq`, and the agent's state moved since.
 * Whoever started the turn answered: the orchestrator's SendMessage, a `wf tell`, the
 * person in the pane. herdr's `state_change_seq` is one counter for every pane, so the
 * stop is this agent's own: another agent's change moves the counter, a dialog inside the
 * turn comes before the stop, and a session change (`/clear`) leaves the seq. With no
 * stop seen, no turn.
 */
export function turnSince(snap: Snapshot, name: string, seq: number | undefined): boolean {
	const stop = seq === undefined ? undefined : snap.stops?.[name]?.[seq];
	const a = snap.agents[name];
	return stop !== undefined && a !== undefined && a.state_change_seq > stop;
}

/**
 * `delivered` with the first stop past the seq of each worktree's question and report,
 * for those two seqs only; the same object when nothing changed. An agent stopped on a
 * question or a report waits there for an answer, and the orchestrator answers after
 * starting its watch again, so the watch's look every 2 s sees that stop.
 */
export function noteStops(snap: Snapshot, delivered: Record<string, Delivered>): Record<string, Delivered> {
	let out = delivered;
	for (const name of Object.keys(snap.metas)) {
		const a = snap.agents[name];
		const old = delivered[name]?.stops ?? {};
		const stops: Record<string, number> = {};
		for (const seq of [snap.questions?.[name]?.seq, snap.reportSeqs?.[name]]) {
			if (seq === undefined) continue;
			const stop = old[seq] ?? (stopped(a) && a!.state_change_seq > seq ? a!.state_change_seq : undefined);
			if (stop !== undefined) stops[seq] = stop;
		}
		if (JSON.stringify(stops) !== JSON.stringify(old)) out = { ...out, [name]: { ...delivered[name], stops: Object.keys(stops).length ? stops : undefined } };
	}
	return out;
}

/** Each worktree's recorded stops, for a Snapshot. */
export function stopsOf(delivered: Record<string, Delivered>): Snapshot['stops'] {
	return Object.fromEntries(Object.entries(delivered).map(([name, d]) => [name, d.stops]));
}

/**
 * The question the agent waits on: it ran `wf ask` after its last prompt and its last
 * report, and took no turn since. Its next turn, report, `wf tell` or resume answers it.
 */
export function openQuestion(snap: Snapshot, name: string): Question | null {
	const q = snap.questions?.[name];
	if (!q) return null;
	const at = Date.parse(q.at);
	return at > Date.parse(snap.metas[name].sentAt) && at > (snap.reports[name] ?? 0) && !turnSince(snap, name, q.seq) ? q : null;
}

/** A report the orchestrator has neither shipped nor answered: newer than the last prompt, and no turn since. */
export function reportWaits(snap: Snapshot, name: string): boolean {
	const at = snap.reports[name] ?? 0;
	const meta = snap.metas[name];
	return at > 0 && meta !== undefined && at > Date.parse(meta.sentAt) && !turnSince(snap, name, snap.reportSeqs?.[name]);
}

/** A question on one line, cut to `max` characters: a table cell, a notification. */
export function clip(text: string, max = 40): string {
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * What comes next for a worktree, for `wf status`. herdr's `done` means the agent's turn
 * ended and it waits for input, not that its task is done: the state alone misleads.
 */
export function nextAction(snap: Snapshot, name: string, shipping = false): string {
	const a = snap.agents[name];
	if (shipping) return 'shipping';
	if (a?.agent_status === 'blocked') return 'answer the person: on screen';
	if (reportWaits(snap, name) && a?.agent_status !== 'working') return 'check and ship';
	if (!a) return snap.metas[name] ? 'no agent: resume' : 'no agent';
	const q = snap.metas[name] ? openQuestion(snap, name) : null;
	if (q?.to === 'orchestrator') return `answer the agent: ${clip(q.question)}`;
	if (q) return a.agent_status === 'working' ? 'with the person' : `answer the person: ${clip(q.question)}`;
	return a.agent_status === 'working' ? 'working' : 'stopped: read its screen';
}

/** herdr's state in words: `idle` and `done` both mean the agent stopped and waits for input. */
export function stateWord(a: Agent): string {
	return stopped(a) ? 'stopped' : a.agent_status;
}

/** The agent stopped right after asking the person, who has not answered yet: no turn since. */
export function unanswered(snap: Snapshot, name: string): boolean {
	return openQuestion(snap, name)?.to === 'person' && stopped(snap.agents[name]);
}

const ORDER: WatchEvent['kind'][] = ['blocked', 'question', 'report', 'idle', 'gone'];

/**
 * The first event not yet delivered. A blocked agent comes first (the person is waiting
 * to be called), then a question to the orchestrator, then a report, then an agent that
 * stopped without one since its last prompt, then an agent that is gone. An agent stopped
 * on its question is no idle news: the question is, or the person was called.
 */
export function selectEvent(snap: Snapshot, delivered: Record<string, Delivered>): WatchEvent | null {
	const events: WatchEvent[] = [];
	for (const name of Object.keys(snap.metas).sort()) {
		const d = delivered[name] ?? {};
		const a = snap.agents[name];
		const report = snap.reports[name] ?? 0;
		if (a?.agent_status === 'blocked' && d.blockedSeq !== a.state_change_seq) events.push({ kind: 'blocked', name, pane: a.pane_id, seq: a.state_change_seq });
		const q = openQuestion(snap, name);
		if (q?.to === 'orchestrator' && d.question !== q.at) events.push({ kind: 'question', name, at: q.at });
		if (report > (d.report ?? 0)) events.push({ kind: 'report', name, at: report });
		const meta = snap.metas[name];
		const reported = reportWaits(snap, name);
		// a stop at the state the last prompt found is from before it (the one a tell answered, a
		// new agent's before its task): the agent has not taken the prompt yet
		const early = meta.sentSeq !== undefined && a !== undefined && a.state_change_seq <= meta.sentSeq;
		if (a && stopped(a) && d.idleSeq !== a.state_change_seq && !reported && !early && !q)
			events.push({ kind: 'idle', name, pane: a.pane_id, seq: a.state_change_seq });
		if (!a && !d.gone) events.push({ kind: 'gone', name });
	}
	events.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
	return events[0] ?? null;
}

/** `delivered` with the event marked, so the next watch moves on. */
export function markDelivered(delivered: Record<string, Delivered>, e: WatchEvent): Record<string, Delivered> {
	const d = { ...(delivered[e.name] ?? {}) };
	if (e.kind === 'blocked') d.blockedSeq = e.seq;
	if (e.kind === 'question') d.question = e.at;
	if (e.kind === 'report') d.report = e.at;
	if (e.kind === 'idle') d.idleSeq = e.seq;
	if (e.kind === 'gone') d.gone = true;
	return { ...delivered, [e.name]: d };
}

/** How long a report waits for its ship, or an answer, before the person is called. */
export const REPORT_REMIND_MS = 10 * 60_000;

/**
 * Reports neither shipped nor answered REPORT_REMIND_MS after they came, each told to the
 * person once: the orchestrator may be held in a long conversation, or gone.
 */
export function dueReports(snap: Snapshot, delivered: Record<string, Delivered>, now: number, shipping: (name: string) => boolean): string[] {
	return Object.keys(snap.metas)
		.sort()
		.filter((name) => reportWaits(snap, name) && now - snap.reports[name] >= REPORT_REMIND_MS && delivered[name]?.reminded !== snap.reports[name] && !shipping(name));
}

/** How long a question waits for the orchestrator's answer before the person is called. */
export const QUESTION_REMIND_MS = 10 * 60_000;

/**
 * Questions to the orchestrator still open QUESTION_REMIND_MS after they were asked, each
 * told to the person once: nothing waits where nobody sees it, and the orchestrator may be
 * held in a long conversation or a ship.
 */
export function dueQuestions(snap: Snapshot, delivered: Record<string, Delivered>, now: number): string[] {
	return Object.keys(snap.metas)
		.sort()
		.filter((name) => {
			const q = openQuestion(snap, name);
			return q?.to === 'orchestrator' && now - Date.parse(q.at) >= QUESTION_REMIND_MS && delivered[name]?.questionReminded !== q.at;
		});
}

/** How often the person is called again while an agent stays blocked. */
export const REMIND_MS = 5 * 60_000;

/**
 * Agents still blocked, or stopped on a question the person has not answered, whose last
 * call to the person is older than REMIND_MS: a herdr notification can go unseen (rate
 * limited, no window in front). Only after a first call, which the herdr plugin, the
 * blocked event or `wf ask` with no orchestrator makes; a question to the orchestrator
 * calls nobody.
 */
export function dueReminders(snap: Snapshot, now: number): string[] {
	return Object.keys(snap.metas)
		.sort()
		.filter((name) => {
			const at = snap.metas[name].alertedAt;
			const waits = snap.agents[name]?.agent_status === 'blocked' || unanswered(snap, name);
			return waits && at !== undefined && now - Date.parse(at) >= REMIND_MS;
		});
}

/** An agent that came back clears its `gone`, so a later departure is told again. */
export function clearReturned(delivered: Record<string, Delivered>, agents: Snapshot['agents']): Record<string, Delivered> {
	const out = { ...delivered };
	for (const [name, d] of Object.entries(out)) if (d.gone && agents[name]) out[name] = { ...d, gone: false };
	return out;
}
