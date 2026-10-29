// Where a command runs and what it may do there. Every refusal is a WfError: the CLI
// prints it with what to do and exits 1.
import { checkouts, type Checkouts } from './git';
import { loadConfig, type Resolved } from './config';
import { State } from './state';

export class WfError extends Error {
	constructor(
		message: string,
		readonly code = 1
	) {
		super(message);
	}
}

export type Context = Checkouts & { config: Resolved; state: State };

export async function here(cwd = process.cwd()): Promise<Checkouts> {
	const c = await checkouts(cwd);
	if (!c) throw new WfError(`${cwd} is not in a git repository`);
	return c;
}

/** The main checkout, with the config of the integration branch. */
export async function inMain(command: string, cwd?: string): Promise<Context> {
	const c = await here(cwd);
	if (!c.isMain) throw new WfError(`\`wf ${command}\` runs in the main checkout (${c.main}), not in a worktree`);
	return { ...c, config: await loadConfig(c.root), state: new State(c.commonDir) };
}

/** A linked worktree, with its branch's own config. */
export async function inWorktree(command: string, cwd?: string): Promise<Context> {
	const c = await here(cwd);
	if (c.isMain) throw new WfError(`\`wf ${command}\` runs in a worktree; this is the main checkout`);
	return { ...c, config: await loadConfig(c.root), state: new State(c.commonDir) };
}

/** Either checkout. */
export async function anywhere(cwd?: string): Promise<Context> {
	const c = await here(cwd);
	return { ...c, config: await loadConfig(c.root), state: new State(c.commonDir) };
}
