import { afterEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareWorktree } from '../src/commands/prepare';
import { WfError } from '../src/context';
import { fakeHerdr, repo, worktree, write } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const c of cleanups.splice(0)) c();
});

const CONFIG = `export default {
	integration: 'dev',
	prepare: 'printf "APP_URL=http://localhost:5203\\\\nOTHER=x\\\\n" > .env.local',
	look: { file: '.env.local', keys: ['APP_URL'] }
};
`;

function setup(config = CONFIG) {
	const r = repo('dev', { 'wf.config.ts': config, '.gitignore': '.env.local\n' });
	cleanups.push(r.done);
	const h = fakeHerdr();
	cleanups.push(h.done);
	return { ...r, h, wt: worktree(r.main, 'dash') };
}

test('runs prepare in the worktree, returns the URLs and notifies with them', async () => {
	const s = setup();
	expect(await prepareWorktree(s.wt, true)).toEqual({ APP_URL: 'http://localhost:5203' });
	expect(readFileSync(join(s.wt, '.env.local'), 'utf8')).toContain('APP_URL=');
	expect(s.h.calls()).toContainEqual(['notification', 'show', 'Worktree ready', '--body', 'dash: APP_URL http://localhost:5203', '--sound', 'none']);
});

test('refuses the main checkout', async () => {
	const s = setup();
	expect(prepareWorktree(s.main)).rejects.toBeInstanceOf(WfError);
});

test('a failing prepare is refused, and the person is called', async () => {
	const s = setup(`export default { integration: 'dev', prepare: 'exit 3' };\n`);
	expect(prepareWorktree(s.wt, true)).rejects.toThrow('exit 3 failed');
	await Bun.sleep(50);
	expect(s.h.calls().some((c) => c[2] === 'Worktree not prepared' && c.at(-1) === 'request')).toBe(true);
});

test('the plugin runs the main checkout’s wf in a new worktree, and leaves other repositories alone', () => {
	const s = setup();
	// a stand-in for the project's installed wf, recording how it was called
	const log = join(s.dir, 'wf-called');
	write(s.main, 'node_modules/.bin/wf', `#!/bin/sh\necho "$@" > ${log}\n`);
	chmodSync(join(s.main, 'node_modules/.bin/wf'), 0o755);
	const plugin = (path: string) =>
		Bun.spawnSync(['bun', join(import.meta.dir, '../herdr/plugin.ts')], {
			env: { ...process.env, HERDR_PLUGIN_EVENT_JSON: JSON.stringify({ data: { worktree: { path } } }) },
			stdout: 'pipe'
		});
	expect(plugin(s.wt).exitCode).toBe(0);
	expect(readFileSync(log, 'utf8').trim()).toBe(`prepare --worktree ${s.wt} --notify`);

	const other = repo('main');
	cleanups.push(other.done);
	const r = plugin(worktree(other.main, 'x', 'main'));
	expect(r.exitCode).toBe(0);
	expect(r.stdout.toString()).toContain('not a wf repository');
	expect(existsSync(join(other.main, 'node_modules'))).toBe(false);
});
