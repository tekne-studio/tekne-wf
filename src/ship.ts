// Delivers a worktree's branch to the integration branch, the same way for any agent.
// Never pushes.
//
// 1. Refuses in a state where delivering could lose or mix work: a dirty worktree, a
//    merge in progress, a main checkout off the integration branch or dirty (someone may
//    be working there), nothing to deliver; from the main checkout, an agent still working
//    (when its last event is its report, still working a minute after it).
// 2. Brings the integration branch in (`git merge`) and prepares the worktree under the
//    repository's prepare lock, since what arrived may bring a new dependency. A conflict
//    stops and asks for a resolution.
// 3. Runs the gates, cheap then expensive, and stops at the first that fails. A diff
//    whose every file matches `docsOnly` runs the cheap gates alone. Each expensive gate
//    takes one of the machine's places (`WF_GATE_SLOTS`, a quarter of the cores by
//    default): worktrees of every repository share one CPU. Cheap gates run freely.
// 4. Under the repository's ship lock, checks whether the integration branch moved during
//    the gates: moved, back to 2; otherwise, fast-forward of the main checkout to the
//    tested commit.
// 5. Deletes the branch and closes the worktree: stops every process still running in it,
//    then removes it through herdr when it has an open workspace there, found by path;
//    otherwise `git worktree remove`.
import { existsSync, realpathSync } from 'node:fs';
import { basename } from 'node:path';
import type { Resolved } from './config';
import { WfError } from './context';
import { branchOf, git, gitLoud } from './git';
import * as herdr from './herdr';
import { gateSlots, lock, machineDir, slot } from './lock';
import { stopProcesses } from './procs';
import type { State } from './state';
import { codeList } from './template';
import { openQuestion, reportWaits } from './watch';
import { agentAt, ago, answerBy, snapshotOf } from './worktrees';

export type ShipInput = {
	root: string;
	main: string;
	commonDir: string;
	config: Resolved;
	state: State;
	/** the worktree's name, when its branch is `worktree/<name>` */
	name: string | null;
	dryRun: boolean;
	/** run by the orchestrator, from the main checkout */
	fromMain: boolean;
};

const short = (sha: string) => sha.slice(0, 9);
/** How long a main checkout with changes gets to settle before ship refuses it. */
const SETTLE_S = 5;
/**
 * How long after its report an agent gets to end its turn before ship refuses it as
 * working: the report is its last command, and its closing message takes seconds.
 */
const REPORT_TURN_S = 60;

function fmt(ms: number): string {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

const EXIT: Record<string, number> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

/**
 * A shell command in the worktree, with its output on the terminal, in a process group of
 * its own: interrupting ship ends the whole group (a test stack's servers too), not only
 * its shell. With SIGTERM, so a runner such as Playwright stops what it started itself.
 */
async function sh(command: string, cwd: string): Promise<{ ok: boolean; ms: number }> {
	const t0 = performance.now();
	const p = Bun.spawn(['sh', '-c', command], { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: process.env, detached: true });
	const stop = (signal: string) => () => {
		try {
			process.kill(-p.pid, 'SIGTERM');
		} catch {
			// the group ended meanwhile
		}
		process.exit(EXIT[signal]);
	};
	const handlers = Object.keys(EXIT).map((signal) => [signal, stop(signal)] as const);
	for (const [signal, handler] of handlers) process.on(signal, handler);
	try {
		return { ok: (await p.exited) === 0, ms: performance.now() - t0 };
	} finally {
		for (const [signal, handler] of handlers) process.off(signal, handler);
	}
}

function report(times: { gate: string; ok: boolean; ms: number }[]): void {
	if (!times.length) return;
	const label = (gate: string) => (gate.length > 40 ? `${gate.slice(0, 39)}…` : gate);
	const width = Math.max(5, ...times.map((t) => label(t.gate).length));
	console.log('\ngates:');
	for (const t of times) console.log(`  ${t.ok ? '✓' : '✗'} ${label(t.gate).padEnd(width)} ${fmt(t.ms).padStart(7)}`);
	console.log(`    ${'total'.padEnd(width)} ${fmt(times.reduce((s, t) => s + t.ms, 0)).padStart(7)}`);
}

/** Every changed file matches one of `patterns`; with no pattern or no file, false. */
export function docsOnly(files: string[], patterns: string[]): boolean {
	if (!patterns.length || !files.length) return false;
	const globs = patterns.map((p) => new Bun.Glob(p));
	return files.every((f) => globs.some((g) => g.match(f)));
}

/**
 * The herdr workspace open on this worktree, from herdr's own list. Never
 * `HERDR_WORKSPACE_ID`: whoever runs ship may sit in the main checkout's workspace, and
 * closing that one closes the wrong place.
 */
export async function workspaceFor(root: string): Promise<string | null> {
	try {
		const me = realpathSync(root);
		const list = await herdr.worktreeList(root);
		return list.find((w) => w.is_linked_worktree && existsSync(w.path) && realpathSync(w.path) === me)?.open_workspace_id ?? null;
	} catch {
		return null;
	}
}

/** The live agent in a worktree (its cwd inside it), if any. */
export async function agentIn(root: string): Promise<herdr.Agent | null> {
	try {
		return agentAt(await herdr.agentList(), root) ?? null;
	} catch {
		return null;
	}
}

/**
 * The agent in the worktree; one still working whose last event is its report (newer than
 * its last prompt and its last question) is looked at again each second until its turn
 * ends, up to `REPORT_TURN_S` after the report. `reported` is the report's time then.
 */
async function settled(o: ShipInput, branch: string): Promise<{ agent: herdr.Agent | null; reported: number | null }> {
	let agent = await agentIn(o.root);
	if (agent?.agent_status !== 'working' || !o.name) return { agent, reported: null };
	const snap = snapshotOf(o.state, [{ name: o.name, path: o.root, branch, named: true, agent }]);
	if (!reportWaits(snap, o.name) || openQuestion(snap, o.name)) return { agent, reported: null };
	const at = snap.reports[o.name];
	const until = at + REPORT_TURN_S * 1000;
	if (Date.now() < until) console.log(`… the agent reported ${ago(at)} and is still working; waiting up to ${fmt(until - Date.now())} for its turn to end`);
	while (agent?.agent_status === 'working' && Date.now() < until) {
		await Bun.sleep(1000);
		agent = await agentIn(o.root);
	}
	return { agent, reported: at };
}

/** The shells of a workspace's panes: herdr ends them when it closes the workspace. */
async function paneShells(workspace: string): Promise<number[]> {
	try {
		const pids = await Promise.all((await herdr.paneList(workspace)).map((p) => herdr.paneShell(p.pane_id)));
		return pids.filter((p): p is number => p !== null);
	} catch {
		return [];
	}
}

/**
 * Closes the worktree by path: stops the processes still running in it (a dev server left
 * behind would keep writing there, and the removal would fail), then removes it through
 * herdr when a workspace is open there, with git otherwise.
 */
export async function closeWorktree(root: string, main: string, force: boolean): Promise<void> {
	const ws = await workspaceFor(root);
	const stopped = await stopProcesses(root, ws ? await paneShells(ws) : []);
	if (stopped.length) console.log(`↳ stopped what still ran in the worktree: ${stopped.map((p) => `${p.command} (${p.pid})`).join(', ')}`);
	console.log(`↳ closing the worktree ${root} ${ws ? `through herdr (workspace ${ws})` : 'with git worktree remove'}`);
	if (ws) {
		await herdr.worktreeRemove(ws, force);
		return;
	}
	if (!(await gitLoud(main, 'worktree', 'remove', ...(force ? ['--force'] : []), root)))
		throw new WfError(`the worktree did not close; close it with \`git worktree remove ${root}\``);
}

export async function ship(o: ShipInput): Promise<void> {
	const started = performance.now();
	const I = o.config.integration;
	const self = o.fromMain && o.name ? `bun wf ship ${o.name}` : 'bun wf ship';
	const fail = (message: string, detail = ''): never => {
		throw new WfError(detail ? `${message}\n${detail.replace(/^/gm, '  ')}` : message);
	};

	// --- 1. Where we stand ----------------------------------------------------
	const branch = await branchOf(o.root);
	if (!branch) fail('the worktree has no branch (detached HEAD)');
	if (await git(o.root, 'rev-parse', '--quiet', '--verify', 'MERGE_HEAD'))
		fail(`a merge is in progress in the worktree: resolve it, finish with \`git commit\` and run \`${self}\` again`);
	const dirty = await git(o.root, 'status', '--porcelain');
	if (dirty) fail('the worktree has uncommitted changes; commit or discard them first:', dirty);

	const mainProblem = async (): Promise<[string, string?] | null> => {
		const head = await branchOf(o.main);
		if (head !== I) return [`the main checkout (${o.main}) is on ${head || 'a detached HEAD'}, not on ${I}`];
		// a build there leaves files for a moment (a docs build's temporary files): look
		// again for a few seconds before refusing
		let changes = await git(o.main, 'status', '--porcelain');
		if (changes) console.log(`… the main checkout has changes; looking again for ${SETTLE_S}s`);
		for (let i = 0; changes && i < SETTLE_S; i++) {
			await Bun.sleep(1000);
			changes = await git(o.main, 'status', '--porcelain');
		}
		if (changes) return [`the main checkout (${o.main}) has uncommitted changes, still there after ${SETTLE_S}s; someone may be working there:`, changes];
		return null;
	};
	const problem = await mainProblem();
	if (problem) fail(...problem);
	if ((await git(o.root, 'rev-list', '--count', `${I}..HEAD`)) === '0') fail(`${branch} has no commit beyond ${I}: nothing to deliver`);
	if (o.fromMain) {
		const { agent, reported } = await settled(o, branch);
		if (agent?.agent_status === 'working') {
			const stop = `ask it to stop by ${answerBy(o.name ?? '<name>', agent)}`;
			fail(`the agent in ${o.root} is still working (pane ${agent.pane_id})${reported ? `, its report ${ago(reported)}; look at its pane, or ${stop}` : `; wait for its report, or ${stop}`}`);
		}
	}

	console.log(`↳ ${branch} → ${I} (main checkout: ${o.main})${o.dryRun ? ' · --dry-run' : ''}`);
	// status shows the delivery under way; `forget` at the end takes the mark with it
	const unmark = o.name ? o.state.markShipping(o.name) : () => {};
	try {

		// --- 2 to 4. Merge, gates, fast-forward -----------------------------------
		let tested = '';
		for (;;) {
			const base = await git(o.root, 'rev-parse', I);
			console.log(`\n▶ git merge ${I} (${short(base)})`);
			if (!(await gitLoud(o.root, 'merge', '--no-edit', I))) {
				const conflicts = await git(o.root, 'diff', '--name-only', '--diff-filter=U');
				if (conflicts) fail(`conflict bringing ${I} in: resolve it, finish with \`git commit\` and run \`${self}\` again`, conflicts);
				fail(`git merge ${I} failed`);
			}
			if (o.config.prepare) {
				// the lock `wf prepare` takes: a prepare such as `bun install` must not race one in the same worktree
				const release = await lock(o.commonDir, 'prepare', 'another preparation');
				try {
					console.log(`\n▶ ${o.config.prepare}`);
					if (!(await sh(o.config.prepare, o.root)).ok) fail(`${o.config.prepare} failed`);
				} finally {
					release();
				}
			}
			tested = await git(o.root, 'rev-parse', 'HEAD');
			// the full suites test code; a diff only in the docs leaves the code as it is
			const changed = (await git(o.root, 'diff', '--name-only', '--no-renames', `${base}...HEAD`)).split('\n').filter(Boolean);
			const docs = o.config.gates.expensive.length > 0 && docsOnly(changed, o.config.docsOnly);
			if (docs)
				console.log(`\n↳ docs only: every changed file (${changed.length}) matches docsOnly (${codeList(o.config.docsOnly)}), so the cheap gates run and the expensive ones (${codeList(o.config.gates.expensive)}) stay out`);

			const times: { gate: string; ok: boolean; ms: number }[] = [];
			const gate = async (command: string) => {
				console.log(`\n▶ ${command}`);
				const r = await sh(command, o.root);
				times.push({ gate: command, ...r });
				if (!r.ok) {
					report(times);
					fail(`${command} failed: fix it, commit and run \`${self}\` again`);
				}
				console.log(`✓ ${command} (${fmt(r.ms)})`);
			};
			for (const command of o.config.gates.cheap) await gate(command);
			let moved = '';
			for (const command of docs ? [] : o.config.gates.expensive) {
				// one of the machine's places: the worktrees of every repository share its CPU
				const release = await slot(machineDir(), 'expensive-gate', gateSlots(), `${basename(o.main)} ${o.name ?? branch}: ${command}`);
				try {
					// moved while this waited: bring it in before spending the gate
					const now = await git(o.root, 'rev-parse', I);
					if (now !== base) {
						moved = now;
						break;
					}
					await gate(command);
				} finally {
					release();
				}
			}
			report(times);
			if (moved) {
				console.log(`\n↻ ${I} moved while waiting for a place for the expensive gates (${short(base)} → ${short(moved)}); bringing it in again`);
				continue;
			}

			const left = await git(o.root, 'status', '--porcelain');
			if (left) fail('the gates left changes in the worktree (missing from .gitignore?); clean up and run again:', left);
			if ((await git(o.root, 'rev-parse', 'HEAD')) !== tested) {
				console.log('\n↻ a new commit in the worktree during the gates; again');
				continue;
			}

			const release = await lock(o.commonDir, 'ship', `another delivery to ${I}`);
			const late = await mainProblem();
			if (late) {
				release();
				fail(...late);
			}
			const now = await git(o.root, 'rev-parse', I);
			if (now !== base) {
				release();
				console.log(`\n↻ ${I} moved during the gates (${short(base)} → ${short(now)}); bringing it in again`);
				continue;
			}
			if (o.dryRun) {
				release();
				const ws = await workspaceFor(o.root);
				console.log(`\n--dry-run: ${I} would go from ${short(base)} to ${short(tested)} in the main checkout; then the branch`);
				console.log(`${branch} would go and the worktree would close ${ws ? `through herdr (workspace ${ws})` : 'with git worktree remove'}. (${fmt(performance.now() - started)})`);
				return;
			}
			const ff = await gitLoud(o.main, 'merge', '--ff-only', tested);
			release();
			if (!ff) fail(`the fast-forward of ${I} failed`);
			console.log(`\n✓ ${I} at ${short(tested)}`);
			break;
		}

		// --- 5. Close the worktree ------------------------------------------------
		// Closing the workspace ends the processes in its panes, this one too when ship runs
		// in the worktree's own pane: the branch goes first, with the worktree on a detached
		// HEAD at the same commit, and the close is the very last step.
		if (!(await gitLoud(o.root, 'switch', '--quiet', '--detach')))
			fail(`${I} is already at ${short(tested)}, but the worktree's HEAD did not detach; delete the branch and close the worktree by hand`);
		if (!(await gitLoud(o.main, 'branch', '-d', branch))) {
			await gitLoud(o.root, 'switch', '--quiet', branch);
			fail(`${I} is already at ${short(tested)}, but the branch ${branch} did not go`);
		}
		console.log(`✓ branch ${branch} deleted`);
		if (o.name) o.state.forget(o.name);
		console.log(`(${fmt(performance.now() - started)})`);
		await closeWorktree(o.root, o.main, false);
		console.log('✓ worktree closed');
	} finally {
		unmark();
	}
}
