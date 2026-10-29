// The linked worktrees and the agent in each. herdr lists agents with the folder they run
// in; an agent belongs to the worktree that folder is in. Every worktree has an agent the
// person can watch: status and doctor name one that has none, with what to do.
import { realpathSync } from 'node:fs';
import { basename } from 'node:path';
import { agentSession } from './claude';
import { linkedWorktrees, realpathOr } from './git';
import type { Agent } from './herdr';
import { nameFromBranch, type State } from './state';
import { clip, openQuestion, reportWaits, stopsOf, type Snapshot } from './watch';

/** The live agent whose folder is `root` or inside it. */
export function agentAt(agents: Agent[], root: string): Agent | undefined {
	const me = realpathOr(root);
	return agents.find((a) => {
		try {
			const cwd = realpathSync(a.cwd);
			return cwd === me || cwd.startsWith(`${me}/`);
		} catch {
			return false;
		}
	});
}

export type WorktreeAgent = {
	/** the name in `worktree/<name>`; the folder's name for a branch wf did not name */
	name: string;
	path: string;
	branch: string;
	/** the branch is `worktree/<name>`, so `wf close` reaches it */
	named: boolean;
	agent: Agent | undefined;
};

/** Each linked worktree with its live agent, from git's own list: herdr may not know one made by hand. */
export async function worktreeAgents(main: string, agents: Agent[]): Promise<WorktreeAgent[]> {
	return (await linkedWorktrees(main)).map((wt) => {
		const name = nameFromBranch(wt.branch);
		return { name: name ?? basename(wt.path), path: wt.path, branch: wt.branch, named: name !== null, agent: agentAt(agents, wt.path) };
	});
}

/**
 * How the orchestrator answers an agent: SendMessage to its session; `wf tell` when none
 * runs, which says why and what to do. Any turn the agent takes records the answer.
 */
export function answerBy(name: string, agent: Agent | null | undefined): string {
	const session = agentSession(agent);
	return session ? `SendMessage to \`${session.name}\`` : `\`bun wf tell ${name}\``;
}

export const noAgent = (w: WorktreeAgent) => `${w.name} has no agent the person can watch`;

/** What puts an agent back in a worktree that has none, or closes it. */
export function noAgentFix(w: WorktreeAgent, state: State): string {
	if (w.named && state.meta(w.name)) return `\`bun wf resume ${w.name}\` starts its agent again`;
	if (w.named) return `start an agent in its pane, or \`bun wf close ${w.name}\``;
	return `start an agent in its pane, or \`git worktree remove ${w.path}\` (\`bun wf close\` reaches only worktree/<name> branches)`;
}

export function ago(ms: number): string {
	const s = Math.round((Date.now() - ms) / 1000);
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	return `${Math.round(s / 3600)}h ago`;
}

/** What wf knows of each worktree it started, as watch reads it, with the stops the watch recorded. */
export function snapshotOf(state: State, worktrees: WorktreeAgent[]): Snapshot {
	const snap: Snapshot = { metas: {}, agents: {}, reports: {}, questions: {}, reportSeqs: {}, stops: stopsOf(state.delivered()) };
	for (const w of worktrees) {
		const meta = w.named ? state.meta(w.name) : null;
		if (meta) snap.metas[w.name] = meta;
		snap.agents[w.name] = w.agent;
		snap.reports[w.name] = w.named ? state.reportTime(w.name) : 0;
		snap.questions![w.name] = w.named ? state.question(w.name) : null;
		snap.reportSeqs![w.name] = w.named ? state.reportSeq(w.name) : undefined;
	}
	return snap;
}

type Waiting = { name: string; line: string };

/**
 * Whether a watch runs for the repository, the reports that wait for a ship and the
 * questions that wait for the orchestrator's answer: for status and doctor.
 */
export function watchLines(state: State, snap: Snapshot): { watch: string | null; waiting: Waiting[]; asking: Waiting[] } {
	const w = state.watcher();
	const watch = w ? `\`bun wf watch\` runs (pid ${w.pid}, started ${ago(Date.parse(w.startedAt))})` : null;
	const names = Object.keys(snap.metas);
	const waiting = names.filter((name) => reportWaits(snap, name)).map((name) => ({ name, line: `${name}'s report waits to ship (reported ${ago(snap.reports[name])})` }));
	const asking = names.flatMap((name) => {
		const q = openQuestion(snap, name);
		return q?.to === 'orchestrator' ? [{ name, line: `${name} asks the orchestrator (asked ${ago(Date.parse(q.at))}): ${clip(q.question, 60)}` }] : [];
	});
	return { watch, waiting, asking };
}

export const NO_WATCH = 'no `bun wf watch` runs for this repository: a report reaches the orchestrator only through the message its agent sends';
export const START_WATCH = 'start `bun wf watch` in the background';
