import { basename } from 'node:path';
import type { Options } from '../cli';
import { WfError } from '../context';
import { branchOf, checkouts } from '../git';
import * as herdr from '../herdr';
import { State, nameFromBranch } from '../state';

/**
 * Calls the person for an agent blocked on an approval or a question on screen, or asking
 * with `wf ask` with no orchestrator: theirs to answer. True when herdr showed the call.
 */
export async function callPerson(state: State, repo: string, name: string, pane: string, again = false, what = 'an approval or a question on screen'): Promise<boolean> {
	const title = again ? `wf: ${name} still waits for you` : `wf: ${name} waits for you`;
	const shown = await herdr.notify(title, `${repo} · pane ${pane}: ${what}`, 'request');
	// shown or not: watch's reminders call again from this moment
	state.touchAlerted(name);
	return shown;
}

/**
 * How long an agent stays blocked before the person is called: auto mode answers some
 * permission dialogs by itself within seconds, and a state that goes away by itself waits
 * on nobody. `WF_BLOCKED_MS` sets it (the tests' fake herdr needs none).
 */
export const holdMs = () => Number(process.env.WF_BLOCKED_MS ?? 8000);

/** The agent is still blocked at `seq` once the hold is over: a dialog that waits for the person. */
export async function heldBlocked(target: string, seq: number): Promise<boolean> {
	await Bun.sleep(holdMs());
	const a = await herdr.agentGet(target).catch(() => null);
	return a?.agent_status === 'blocked' && a.state_change_seq === seq;
}

/**
 * `wf alert --pane <id>`: what the herdr plugin runs when an agent turns blocked. Calls
 * the person when the pane is in a worktree `wf spawn` started and its agent stays blocked
 * through the hold; any other pane is left to herdr. Prints what it did, for the plugin log.
 */
export async function alertCommand(_: string[], opt: Options): Promise<void> {
	if (!opt.pane) throw new WfError('`wf alert --pane <id>` (the herdr plugin runs it)');
	const pane = await herdr.paneGet(opt.pane);
	const c = pane.cwd ? await checkouts(pane.cwd) : null;
	const name = c && !c.isMain ? nameFromBranch(await branchOf(c.root)) : null;
	const state = c ? new State(c.commonDir) : null;
	if (!c || !name || !state?.meta(name)) {
		console.log(`${opt.pane}: not an agent wf started; left to herdr`);
		return;
	}
	const a = await herdr.agentGet(opt.pane).catch(() => null);
	if (a?.agent_status !== 'blocked' || !(await heldBlocked(opt.pane, a.state_change_seq))) {
		console.log(`${name}: blocked less than ${holdMs() / 1000}s (pane ${opt.pane}), gone by itself: nobody called`);
		return;
	}
	if (!(await callPerson(state, basename(c.main), name, opt.pane))) throw new WfError(`${name}: the person was not called (pane ${opt.pane})`);
	console.log(`${name}: the person was called (pane ${opt.pane})`);
}
