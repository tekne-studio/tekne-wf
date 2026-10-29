// Temporary repositories for the tests: a main checkout and its worktrees, with git
// identity fixed so commits work on any machine.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ENV = { GIT_AUTHOR_NAME: 'wf', GIT_AUTHOR_EMAIL: 'wf@test', GIT_COMMITTER_NAME: 'wf', GIT_COMMITTER_EMAIL: 'wf@test' };
// wf's own git calls (merges in ship) commit too; CI has no identity of its own
Object.assign(process.env, ENV);
// the machine's places for expensive gates: the tests' own, never a real delivery's
process.env.WF_STATE_DIR ||= mkdtempSync(join(tmpdir(), 'wf-machine-'));
// the fake herdr's states change only when a test changes them: a blocked agent is held no time
process.env.WF_BLOCKED_MS ??= '0';

export function run(cwd: string, ...cmd: string[]): string {
	const p = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...ENV }, stdout: 'pipe', stderr: 'pipe' });
	if (p.exitCode !== 0) throw new Error(`${cmd.join(' ')} (in ${cwd}): ${p.stderr.toString()}`);
	return p.stdout.toString().trim();
}

export const git = (cwd: string, ...args: string[]) => run(cwd, 'git', ...args);

export function write(root: string, rel: string, text: string): void {
	mkdirSync(dirname(join(root, rel)), { recursive: true });
	writeFileSync(join(root, rel), text);
}

export function commit(root: string, message: string, files: Record<string, string> = {}): string {
	for (const [rel, text] of Object.entries(files)) write(root, rel, text);
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '--allow-empty', '-m', message);
	return git(root, 'rev-parse', 'HEAD');
}

/** A main checkout on `branch`, with one commit, in its own temporary folder. */
export function repo(branch = 'dev', files: Record<string, string> = {}): { dir: string; main: string; done: () => void } {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wf-test-')));
	const main = join(dir, 'main');
	mkdirSync(main);
	git(main, 'init', '-q', '-b', branch);
	commit(main, 'chore: start', files);
	return { dir, main, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A worktree of `main` on `worktree/<name>`, beside it. */
export function worktree(main: string, name: string, base = 'dev'): string {
	const path = join(dirname(main), `worktree-${name}`);
	git(main, 'worktree', 'add', '-q', '-b', `worktree/${name}`, path, base);
	return realpathSync(path);
}

/**
 * Points wf at the fake herdr (tests/fake-herdr.ts) with this state, until `done`.
 * `calls()` lists what wf asked herdr, one argument list per call.
 */
export function fakeHerdr(initial: import('./fake-herdr').FakeState = {}) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wf-herdr-')));
	writeFileSync(join(dir, 'state.json'), JSON.stringify(initial));
	writeFileSync(join(dir, 'calls.jsonl'), '');
	const before = { bin: process.env.HERDR_BIN_PATH, fake: process.env.FAKE_HERDR };
	process.env.HERDR_BIN_PATH = join(import.meta.dir, 'fake-herdr');
	process.env.FAKE_HERDR = dir;
	const read = (f: string) => require('node:fs').readFileSync(join(dir, f), 'utf8') as string;
	return {
		calls: (): string[][] => read('calls.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
		state: (): import('./fake-herdr').FakeState => JSON.parse(read('state.json')),
		set: (s: import('./fake-herdr').FakeState) => writeFileSync(join(dir, 'state.json'), JSON.stringify(s)),
		done: () => {
			process.env.HERDR_BIN_PATH = before.bin;
			process.env.FAKE_HERDR = before.fake;
			if (before.bin === undefined) delete process.env.HERDR_BIN_PATH;
			if (before.fake === undefined) delete process.env.FAKE_HERDR;
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

/**
 * A process left running in `dir`, orphaned (PPID 1) as a dev server is once its parent
 * dies, rewriting a file there every 50 ms. `alive()` asks the system; `stop()` ends it.
 */
export function writer(dir: string): { pid: number; alive: () => boolean; stop: () => void } {
	const loop = 'while :; do mkdir -p pb_data; date > pb_data/x; sleep 0.05; done';
	const pid = Number(run(dir, 'sh', '-c', `sh -c '${loop}' >/dev/null 2>&1 & echo $!`));
	const alive = () => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	return { pid, alive, stop: () => alive() && process.kill(pid, 'SIGKILL') };
}
