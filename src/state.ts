// Names, places and what wf remembers. State lives in `<git common dir>/wf/`, which the
// main checkout and every worktree see, outside the tracked tree.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { liveSession, sessionAt } from './claude';
import { alive } from './lock';
import type { Kind } from './kinds';
import { commandOf, orphaned } from './procs';

/** herdr's agent names: one name for the worktree, its branch and its agent. */
export const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const BRANCH_PREFIX = 'worktree/';

export function checkName(name: string): string | null {
	return NAME.test(name) ? null : `"${name}" is not a name: lower case, starting with a letter, up to 32 of a-z 0-9 _ - (herdr's agent names)`;
}

export const branchFor = (name: string) => `${BRANCH_PREFIX}${name}`;

/** The worktree's name from its branch; null for a branch wf did not name. */
export function nameFromBranch(branch: string): string | null {
	if (!branch.startsWith(BRANCH_PREFIX)) return null;
	const name = branch.slice(BRANCH_PREFIX.length);
	return NAME.test(name) ? name : null;
}

/** herdr's own convention: `~/.herdr/worktrees/<repo>/worktree-<name>`; `WF_WORKTREES_DIR` moves the root (the tests do). */
export function worktreePath(main: string, name: string): string {
	const root = process.env.WF_WORKTREES_DIR || join(homedir(), '.herdr', 'worktrees');
	return join(root, basename(main), `worktree-${name}`);
}

export type Meta = {
	kind: Kind;
	/** the model `wf spawn --model` chose; resume keeps it */
	model?: string;
	workspace: string;
	pane: string;
	path: string;
	spawnedAt: string;
	/** the last prompt sent: the task, a `wf tell`, a resume */
	sentAt: string;
	/** the agent's herdr state_change_seq when the last prompt went: a stop at it is from before the prompt, or the one a tell answered */
	sentSeq?: number;
	/** the last call to the person for this agent, shown or not: watch calls again REMIND_MS after it */
	alertedAt?: string;
	/** the Claude Code session that ran `wf spawn`: the agent's report message goes there */
	orchestrator?: { name: string; sessionId: string; pid: number };
};

/**
 * An agent's question, from `wf ask`: to the orchestrator when one runs, the person's
 * filter; otherwise to the person. The agent stops on it until the answer.
 */
export type Question = {
	question: string;
	at: string;
	/** the agent's herdr state_change_seq while it ran `wf ask`; the first stop past it ends that turn */
	seq?: number;
	to: 'orchestrator' | 'person';
};

/** The `wf watch` running for a repository: one at a time, a new one replaces it. */
export type Watcher = {
	pid: number;
	startedAt: string;
	/** the Claude Code session that started it, which reads what it prints; none from a terminal or another harness */
	orchestrator?: { name: string; sessionId: string; pid: number };
};

/**
 * The watch speaks for the agent: its reader is the agent's orchestrator. The session that
 * started it still runs (a `/clear` keeps its process), and the agent's orchestrator is
 * that session or no longer runs (it handed over to this one); or neither has a session
 * (another harness's orchestrator, or the person's terminal for both). A watch from the
 * person's terminal speaks for no agent a session spawned, and a session's watch for no
 * agent of another live session: their messages carry their events.
 */
export function speaksFor(w: Watcher, meta: Meta): boolean {
	if (!w.orchestrator) return !meta.orchestrator;
	const reader = sessionAt(w.orchestrator.pid);
	if (!reader) return false;
	const own = meta.orchestrator ? liveSession(meta.orchestrator) : null;
	return !own || own.pid === reader.pid;
}

export type Delivered = {
	blockedSeq?: number;
	idleSeq?: number;
	report?: number;
	gone?: boolean;
	/** the report the person was reminded of, by its time */
	reminded?: number;
	/** the question told to the orchestrator, by its time */
	question?: string;
	/** the question the person was reminded of, by its time */
	questionReminded?: string;
	/** by the seq a question or a report recorded, the first stop the watch saw past it: the turn that asked or reported ended there */
	stops?: Record<string, number>;
};

export class State {
	constructor(readonly commonDir: string) {}

	get dir(): string {
		return join(this.commonDir, 'wf');
	}

	private file(name: string, leaf: string): string {
		return join(this.dir, name, leaf);
	}

	meta(name: string): Meta | null {
		const f = this.file(name, 'meta.json');
		return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Meta) : null;
	}

	writeMeta(name: string, meta: Meta): void {
		mkdirSync(join(this.dir, name), { recursive: true });
		writeFileSync(this.file(name, 'meta.json'), JSON.stringify(meta, null, '\t') + '\n');
	}

	touchSent(name: string, seq?: number, at = new Date()): void {
		const m = this.meta(name);
		if (m) this.writeMeta(name, { ...m, sentAt: at.toISOString(), sentSeq: seq });
	}

	touchAlerted(name: string, at = new Date()): void {
		const m = this.meta(name);
		if (m) this.writeMeta(name, { ...m, alertedAt: at.toISOString() });
	}

	taskPath(name: string): string {
		return this.file(name, 'task.md');
	}

	writeTask(name: string, text: string): string {
		mkdirSync(join(this.dir, name), { recursive: true });
		writeFileSync(this.taskPath(name), text);
		return this.taskPath(name);
	}

	reportPath(name: string): string {
		return this.file(name, 'report.md');
	}

	/** `seq`: the agent's herdr `state_change_seq` while it reports; a turn past the first stop after it answers the report. */
	writeReport(name: string, text: string, head: string, at = new Date(), seq?: number): string {
		mkdirSync(join(this.dir, name), { recursive: true });
		const top = `wf report · ${at.toISOString()} · HEAD ${head}${seq === undefined ? '' : ` · seq ${seq}`}`;
		writeFileSync(this.reportPath(name), `<!-- ${top} -->\n\n${text.trim()}\n`);
		return this.reportPath(name);
	}

	/** The `seq` the report recorded; undefined without one. */
	reportSeq(name: string): number | undefined {
		const f = this.reportPath(name);
		const seq = existsSync(f) ? readFileSync(f, 'utf8').match(/^<!-- wf report · .* · seq (\d+) -->/)?.[1] : undefined;
		return seq === undefined ? undefined : Number(seq);
	}

	questionPath(name: string): string {
		return this.file(name, 'question.json');
	}

	question(name: string): Question | null {
		const f = this.questionPath(name);
		return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Question) : null;
	}

	writeQuestion(name: string, q: Question): string {
		mkdirSync(join(this.dir, name), { recursive: true });
		writeFileSync(this.questionPath(name), JSON.stringify(q, null, '\t') + '\n');
		return this.questionPath(name);
	}

	/** `wf ship` is delivering this worktree now. */
	shipping(name: string): boolean {
		try {
			return alive(Number(readFileSync(this.file(name, 'ship.pid'), 'utf8')));
		} catch {
			return false;
		}
	}

	/** Marks the delivery under way, until the returned function runs or the process ends. */
	markShipping(name: string): () => void {
		mkdirSync(join(this.dir, name), { recursive: true });
		const f = this.file(name, 'ship.pid');
		writeFileSync(f, String(process.pid));
		return () => rmSync(f, { force: true });
	}

	/** When the report was last written, in ms; 0 when there is none. */
	reportTime(name: string): number {
		const f = this.reportPath(name);
		return existsSync(f) ? statSync(f).mtimeMs : 0;
	}

	delivered(): Record<string, Delivered> {
		const f = join(this.dir, 'watch.json');
		return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
	}

	writeDelivered(all: Record<string, Delivered>): void {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(join(this.dir, 'watch.json'), JSON.stringify(all, null, '\t') + '\n');
	}

	/** The watch running for this repository; null when none is, or its pid now names another program. */
	watcher(): Watcher | null {
		const f = join(this.dir, 'watch.pid');
		try {
			const w = JSON.parse(readFileSync(f, 'utf8')) as Watcher;
			return alive(w.pid) && /\bwatch\b/.test(commandOf(w.pid)) ? w : null;
		} catch {
			return null;
		}
	}

	/** The running watch when it speaks for this agent and is not orphaned: `ask` and `report` leave their event to it. */
	watcherFor(meta: Meta): Watcher | null {
		const w = this.watcher();
		return w && speaksFor(w, meta) && !orphaned(w.pid) ? w : null;
	}

	writeWatcher(w: Watcher): void {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(join(this.dir, 'watch.pid'), JSON.stringify(w) + '\n');
	}

	/** Removes the record when it is still `pid`'s: a newer watch keeps its own. */
	clearWatcher(pid: number): void {
		const f = join(this.dir, 'watch.pid');
		try {
			if ((JSON.parse(readFileSync(f, 'utf8')) as Watcher).pid === pid) rmSync(f, { force: true });
		} catch {
			// none
		}
	}

	/** Everything wf keeps about a worktree: gone once it ships or closes. */
	forget(name: string): void {
		rmSync(join(this.dir, name), { recursive: true, force: true });
		const all = this.delivered();
		if (name in all) {
			delete all[name];
			this.writeDelivered(all);
		}
	}
}

/** `KEY=value` lines of a file, for the keys asked; missing keys are left out. */
export function readKeys(file: string, keys: string[]): Record<string, string> {
	if (!existsSync(file)) return {};
	const text = readFileSync(file, 'utf8');
	const found: Record<string, string> = {};
	for (const k of keys) {
		const v = text.match(new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(.*)$`, 'm'))?.[1]?.trim();
		if (v) found[k] = v.replace(/^(['"])(.*)\1$/, '$2');
	}
	return found;
}
