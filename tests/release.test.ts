// Where `bun run release` runs: the main checkout, on main, clean. The script acts on the
// repository it sits in, so each test copies it into a temporary repository with a bare
// origin of its own; nothing reaches the network or this repository.
import { afterEach, expect, test } from 'bun:test';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commit, git, repo } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

const PACKAGE = '{\n\t"name": "p",\n\t"version": "0.1.0"\n}\n';

/** A main checkout on main with one feat since v0.1.0, pushed to its bare origin. */
function setup(changelog = '# Changelog\n') {
	const r = repo('main', { 'package.json': PACKAGE, 'CHANGELOG.md': changelog });
	cleanups.push(r.done);
	mkdirSync(join(r.main, 'scripts'));
	for (const f of ['release.ts', 'release-plan.ts']) copyFileSync(join(import.meta.dir, '../scripts', f), join(r.main, 'scripts', f));
	commit(r.main, 'chore: the release script');
	git(r.main, 'tag', '-a', 'v0.1.0', '-m', '0.1.0');
	commit(r.main, 'feat: something to release');
	const origin = join(r.dir, 'origin.git');
	git(r.dir, 'init', '-q', '--bare', origin);
	git(r.main, 'remote', 'add', 'origin', origin);
	git(r.main, 'push', '-q', 'origin', 'main', '--tags');
	const release = (cwd: string, ...args: string[]) => {
		const p = Bun.spawnSync(['bun', join(cwd, 'scripts/release.ts'), ...args], { cwd, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
		return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
	};
	return { ...r, release };
}

test('the release plans from the main checkout, on main and clean', () => {
	const s = setup();
	const r = s.release(s.main, '--dry-run');
	expect(r.code).toBe(0);
	expect(r.out).toContain('v0.1.0 → v0.2.0');
	expect(r.out).not.toContain('A real run would stop here');
});

test('the release drafts the new version from ## Unreleased, leaving the commits out', () => {
	const s = setup('# Changelog\n\n## Unreleased\n\n### Fixed\n\n- Written as it went.\n');
	const r = s.release(s.main, '--dry-run');
	expect(r.code).toBe(0);
	expect(r.out).toContain('## 0.2.0\n\n<!-- release draft:');
	expect(r.out).toContain('### Fixed\n\n- Written as it went.');
	expect(r.out).not.toContain('Something to release');
});

test('the release refuses a worktree, even one at the tip of main, before writing anything', () => {
	const s = setup();
	const wt = join(s.dir, 'wf-release');
	git(s.main, 'worktree', 'add', '-q', '--detach', wt, 'main');
	expect(s.release(wt, '--dry-run').out).toContain('not the main checkout');
	writeFileSync(join(s.dir, 'entry.md'), '## 0.2.0\n\n- something\n');
	const r = s.release(wt, '--entry', join(s.dir, 'entry.md'));
	expect(r.code).toBe(1);
	expect(r.out).toContain('Not releasing');
	expect(r.out).toContain('not the main checkout');
	expect(readFileSync(join(wt, 'package.json'), 'utf8')).toBe(PACKAGE);
});

test('the release refuses the main checkout off main or with changes', () => {
	const s = setup();
	git(s.main, 'switch', '-q', '--detach');
	expect(s.release(s.main, '--dry-run').out).toContain('on a detached HEAD, not on main');
	git(s.main, 'switch', '-q', '-c', 'other');
	expect(s.release(s.main, '--dry-run').out).toContain('on other, not on main');
	git(s.main, 'switch', '-q', 'main');
	writeFileSync(join(s.main, 'loose.txt'), 'x');
	const r = s.release(s.main, '--dry-run');
	expect(r.out).toContain('uncommitted changes');
	expect(r.out).toContain('loose.txt');
});
