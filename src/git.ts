// Git for the commands: the checkout a command runs in, the main checkout and the
// linked worktrees.
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';

/** Git's output, trimmed; empty when the command fails. */
export async function git(dir: string, ...args: string[]): Promise<string> {
	const p = Bun.spawn(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', env: process.env });
	const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
	return code === 0 ? out.trimEnd() : '';
}

/** Git with its output on the terminal, for the steps a person reads (merge, fast-forward). */
export async function gitLoud(dir: string, ...args: string[]): Promise<boolean> {
	return (await Bun.spawn(['git', '-C', dir, ...args], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env }).exited) === 0;
}

export type Checkouts = {
	/** the checkout `dir` belongs to */
	root: string;
	/** the git common dir every worktree shares */
	commonDir: string;
	/** the main checkout: the common dir's folder */
	main: string;
	isMain: boolean;
};

/** Where `dir` stands, or null outside a repository. */
export async function checkouts(dir: string): Promise<Checkouts | null> {
	const root = await git(dir, 'rev-parse', '--show-toplevel');
	const common = await git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (!root || !common) return null;
	const commonDir = realpathSync(common);
	const main = dirname(commonDir);
	return { root: realpathSync(root), commonDir, main, isMain: realpathSync(main) === realpathSync(root) };
}

/** The branch checked out in `dir`; empty on a detached HEAD. */
export function branchOf(dir: string): Promise<string> {
	return git(dir, 'symbolic-ref', '--quiet', '--short', 'HEAD');
}

/** Linked worktrees by branch, from git itself (herdr may not know a worktree made by hand). */
export async function linkedWorktrees(main: string): Promise<{ path: string; branch: string }[]> {
	const out = await git(main, 'worktree', 'list', '--porcelain');
	const list: { path: string; branch: string }[] = [];
	for (const block of out.split('\n\n')) {
		const path = block.match(/^worktree (.+)$/m)?.[1];
		const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? '';
		if (path) list.push({ path, branch });
	}
	return list.filter((w) => realpathOr(w.path) !== realpathOr(main));
}

export function realpathOr(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}
