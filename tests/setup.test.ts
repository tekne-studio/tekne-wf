import { afterEach, expect, test } from 'bun:test';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { State } from '../src/state';
import { git, fakeHerdr, repo, worktree } from './helpers';

const CLI = join(import.meta.dir, '../src/cli.ts');
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

function wf(cwd: string, args: string[], env: Record<string, string> = {}) {
	const p = Bun.spawnSync(['bun', CLI, ...args], { cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
	return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

function home(trusted: Record<string, boolean>) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wf-home-')));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	writeFileSync(join(dir, '.claude.json'), JSON.stringify({ projects: Object.fromEntries(Object.entries(trusted).map(([p, t]) => [p, { hasTrustDialogAccepted: t }])) }));
	return dir;
}

test('init writes the config, AGENTS.md from CLAUDE.md, the link, the script and the block', () => {
	const r = repo('dev', { 'CLAUDE.md': '# Mine\n\nmy rules\n', 'package.json': '{\n  "name": "p",\n  "scripts": {\n    "dev": "vite"\n  }\n}\n' });
	cleanups.push(r.done);
	const h = fakeHerdr({ plugins: ['tekne.wf'] });
	cleanups.push(h.done);
	const res = wf(r.main, ['init'], { CLAUDE_CONFIG_DIR: home({ [r.main]: true }), HERDR_ENV: '1' });
	expect(res.out).toContain(`✓ wf.config.ts (integration: dev)`);
	expect(readFileSync(join(r.main, 'wf.config.ts'), 'utf8')).toContain("prepare: 'bun install'");
	const agents = readFileSync(join(r.main, 'AGENTS.md'), 'utf8');
	expect(agents).toStartWith('# Mine\n\nmy rules\n');
	expect(agents).toContain('### Parallel agents: wf');
	expect(lstatSync(join(r.main, 'CLAUDE.md')).isSymbolicLink()).toBe(true);
	expect(readFileSync(join(r.main, 'package.json'), 'utf8')).toBe('{\n  "name": "p",\n  "scripts": {\n    "wf": "wf",\n    "dev": "vite"\n  }\n}\n');
	expect(res.code).toBe(0);
	// a second init changes nothing
	expect(wf(r.main, ['init'], { CLAUDE_CONFIG_DIR: home({ [r.main]: true }), HERDR_ENV: '1' }).out).not.toContain('✓ wf.config.ts (integration');
});

test('init in a worktree takes the main checkout’s branch as the integration branch, and its name as the title', () => {
	const r = repo('dev', { 'package.json': '{\n  "name": "p",\n  "scripts": {}\n}\n' });
	cleanups.push(r.done);
	const h = fakeHerdr({ plugins: ['tekne.wf'] });
	cleanups.push(h.done);
	const wt = worktree(r.main, 'adopt');
	const res = wf(wt, ['init'], { CLAUDE_CONFIG_DIR: home({ [r.main]: true }), HERDR_ENV: '1' });
	expect(res.out).toContain('✓ wf.config.ts (integration: dev)');
	expect(readFileSync(join(wt, 'wf.config.ts'), 'utf8')).toContain("integration: 'dev'");
	expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toContain('on `dev`');
	// the repository's name, the main checkout's folder: never the worktree's
	expect(readFileSync(join(wt, 'AGENTS.md'), 'utf8')).toStartWith('# main\n');
	expect(res.code).toBe(0);
});

test('doctor names what is missing and how to fix it, and never fixes trust itself', () => {
	const r = repo('dev', { 'wf.config.ts': `export default { integration: 'dev' };\n` });
	cleanups.push(r.done);
	const h = fakeHerdr({ version: '0.12.0', integrations: { claude: 'not installed' } });
	cleanups.push(h.done);
	const claudeDir = home({ [r.main]: false });
	const res = wf(r.main, ['doctor'], { CLAUDE_CONFIG_DIR: claudeDir });
	expect(res.code).toBe(1);
	expect(res.out).toContain('✗ AGENTS.md is missing');
	expect(res.out).toContain('✗ herdr 0.12.0 is outside the tested range');
	expect(res.out).toContain('✗ herdr plugin tekne.wf is not installed: nobody calls the person');
	expect(res.out).toContain('herdr integration install claude');
	expect(res.out).toContain(`open Claude once in ${r.main} and confirm`);
	expect(JSON.parse(readFileSync(join(claudeDir, '.claude.json'), 'utf8')).projects[r.main].hasTrustDialogAccepted).toBe(false);
});

test('doctor warns of a worktree with no agent, with what to do, and passes all the same', () => {
	const r = repo('dev');
	cleanups.push(r.done);
	const watched = worktree(r.main, 'dash');
	worktree(r.main, 'mig');
	const h = fakeHerdr({ plugins: ['tekne.wf'], agents: [{ name: 'dash', agent: 'claude', pane_id: 'w1:p1', workspace_id: 'w1', cwd: watched, agent_status: 'working', state_change_seq: 1 }] });
	cleanups.push(h.done);
	const env = { CLAUDE_CONFIG_DIR: home({ [r.main]: true }), HERDR_ENV: '1' };
	const res = wf(r.main, ['init'], env);
	expect(res.out).toContain('! mig has no agent the person can watch\n    start an agent in its pane, or `bun wf close mig`');
	expect(res.out).not.toContain('dash has no agent');
	expect(res.code).toBe(0);

	// once every worktree has its agent, doctor says so
	git(r.main, 'worktree', 'remove', join(r.dir, 'worktree-mig'));
	const again = wf(r.main, ['doctor'], env);
	expect(again.out).toContain('✓ an agent the person can watch in each worktree (1)');
	expect(again.code).toBe(0);

	// wf started dash: doctor says no watch runs, and names its report waiting to ship
	const state = new State(git(r.main, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
	state.writeMeta('dash', { kind: 'claude', workspace: 'w1', pane: 'w1:p1', path: watched, spawnedAt: '2026-01-01T00:00:00Z', sentAt: '2026-01-01T00:00:00Z' });
	state.writeReport('dash', 'Done.', 'abc123');
	const reported = wf(r.main, ['doctor'], env);
	expect(reported.out).toContain('! no `bun wf watch` runs for this repository');
	expect(reported.out).toMatch(/! dash's report waits to ship \(reported \d+s ago\)\n    check it, then `bun wf ship dash`, or answer by `bun wf tell dash`/);
	expect(reported.code).toBe(0);
});
