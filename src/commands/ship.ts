import type { Options } from '../cli';
import { loadConfig } from '../config';
import { WfError, here } from '../context';
import { branchOf, linkedWorktrees } from '../git';
import * as herdr from '../herdr';
import { ship } from '../ship';
import { State, branchFor, checkName, nameFromBranch } from '../state';
import { reportWaits } from '../watch';
import { snapshotOf, worktreeAgents } from '../worktrees';

/** The worktree of `name`, from git's own list: herdr may not know one made by hand. */
export async function worktreeOf(main: string, name: string): Promise<string> {
	const bad = checkName(name);
	if (bad) throw new WfError(bad);
	const wt = (await linkedWorktrees(main)).find((w) => w.branch === branchFor(name));
	if (!wt) throw new WfError(`no worktree on ${branchFor(name)}: \`bun wf status\` lists them`);
	return wt.path;
}

/**
 * The worktrees whose report waits to ship, the oldest report first: herdr's agents tell
 * a report its agent took a turn after, which was answered. With no agents from herdr,
 * every report reads as waiting, and the ship says so.
 */
async function reported(main: string, state: State): Promise<string[]> {
	const agents = await herdr.agentList().catch((e: Error) => {
		console.error(`! herdr did not list its agents (${e.message}): every report reads as waiting, answered or not`);
		return [];
	});
	const snap = snapshotOf(state, await worktreeAgents(main, agents));
	return Object.keys(snap.metas)
		.filter((name) => reportWaits(snap, name))
		.sort((a, b) => snap.reports[a] - snap.reports[b]);
}

export async function shipCommand(args: string[], opt: Options): Promise<number> {
	const c = await here();
	const state = new State(c.commonDir);
	const dryRun = !!opt['dry-run'];
	if (!c.isMain) {
		if (args.length || opt.reported) throw new WfError('in a worktree, `bun wf ship` delivers this one; drop the names');
		await ship({ root: c.root, main: c.main, commonDir: c.commonDir, config: await loadConfig(c.root), state, name: nameFromBranch(await branchOf(c.root)), dryRun, fromMain: false });
		return 0;
	}
	if (opt.reported && args.length) throw new WfError('`bun wf ship --reported` takes no names');
	const names = opt.reported ? await reported(c.main, state) : args;
	if (!names.length) throw new WfError(opt.reported ? 'no report waits to ship' : 'in the main checkout, name the worktrees: `bun wf ship <name>…`, or `--reported`');
	const one = async (name: string) => {
		const root = await worktreeOf(c.main, name);
		// the branch's own config: its gates are the ones that hold for what it delivers
		await ship({ root, main: c.main, commonDir: c.commonDir, config: await loadConfig(root), state, name, dryRun, fromMain: true });
	};
	if (names.length === 1) {
		await one(names[0]);
		return 0;
	}
	// one after another: each brings in what the one before delivered
	const done: [string, string | null][] = [];
	for (const name of names) {
		console.log(`\n━━ ${name} (${done.length + 1} of ${names.length})`);
		try {
			await one(name);
			done.push([name, null]);
		} catch (e) {
			if (!(e instanceof WfError)) throw e;
			console.error(`\n✗ ${e.message}`);
			done.push([name, e.message.split('\n')[0]]);
		}
	}
	console.log('\nqueue:');
	for (const [name, failed] of done) console.log(failed ? `  ✗ ${name}: ${failed}` : `  ✓ ${name}`);
	return done.some(([, failed]) => failed) ? 1 : 0;
}
