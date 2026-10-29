import { basename, join } from 'node:path';
import type { Options } from '../cli';
import { ConfigError, loadConfig } from '../config';
import { WfError, here } from '../context';
import { branchOf } from '../git';
import { lock } from '../lock';
import * as herdr from '../herdr';
import { nameFromBranch, readKeys } from '../state';

/**
 * Runs the project's `prepare` in a worktree, one at a time per repository: the herdr
 * plugin and `spawn` call it, `ship` runs `prepare` under the same lock, and two worktrees
 * created together could otherwise take the same resources (a port slot each). Returns
 * the URLs from `look`.
 */
export async function prepareWorktree(root: string, notify = false): Promise<Record<string, string>> {
	const c = await here(root);
	if (c.isMain) throw new WfError('`wf prepare` runs in a worktree; this is the main checkout');
	const label = nameFromBranch(await branchOf(c.root)) ?? basename(c.root);
	const failed = async (reason: string): Promise<never> => {
		if (notify) await herdr.notify('Worktree not prepared', `${label}: ${reason}`, 'request');
		throw new WfError(reason);
	};

	let config;
	try {
		config = await loadConfig(c.root);
	} catch (e) {
		if (e instanceof ConfigError) return failed(`${e.message.split('\n')[0]}; bring the integration branch in`);
		throw e;
	}
	const release = await lock(c.commonDir, 'prepare', 'another preparation');
	try {
		if (config.prepare) {
			console.log(`▶ ${config.prepare}`);
			const p = Bun.spawn(['sh', '-c', config.prepare], { cwd: c.root, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
			if ((await p.exited) !== 0) return failed(`${config.prepare} failed`);
		}
	} finally {
		release();
	}
	const urls = config.look ? readKeys(join(c.root, config.look.file), config.look.keys) : {};
	const shown = Object.entries(urls).map(([k, v]) => `${k} ${v}`).join(' · ');
	console.log(`✓ ${label} prepared${shown ? `: ${shown}` : ''}`);
	if (notify) await herdr.notify('Worktree ready', `${label}${shown ? `: ${shown}` : ''}`);
	return urls;
}

export async function prepareCommand(_: string[], opt: Options): Promise<void> {
	await prepareWorktree(opt.worktree ?? process.cwd(), !!opt.notify);
}
