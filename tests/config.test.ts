import { afterEach, expect, test } from 'bun:test';
import { ConfigError, loadConfig, resolve } from '../src/config';
import { repo, write } from './helpers';

test('fills the defaults', () => {
	const c = resolve({ integration: 'dev' });
	expect(c).toEqual({
		integration: 'dev',
		prepare: '',
		close: '',
		refresh: null,
		gates: { cheap: [], expensive: [] },
		docsOnly: [],
		look: null,
		agent: { kind: 'claude', args: null },
		header: '',
		agentsFile: 'AGENTS.md'
	});
});

test('names every field that is wrong', () => {
	const e = (() => {
		try {
			resolve({ integration: '', close: 1, refresh: { when: 'bun.lock' }, gates: ['x'], docsOnly: 'docs/**', look: { file: '.env.local' }, agent: { kind: 'codex' }, extra: 1 });
		} catch (e) {
			return e as Error;
		}
	})();
	expect(e).toBeInstanceOf(ConfigError);
	for (const field of ['extra: unknown field', 'integration:', 'close:', 'refresh:', 'gates:', 'docsOnly:', 'look:', 'agent.kind:']) expect(e?.message).toContain(field);
});

test('takes a close command', () => {
	expect(resolve({ integration: 'dev', close: ' bun run worktree --down ' }).close).toBe('bun run worktree --down');
});

test('takes a refresh, its globs and its command; one without both is refused', () => {
	const refresh = { when: ['bun.lock', '**/package.json'], run: ' bun install --frozen-lockfile ' };
	expect(resolve({ integration: 'dev', refresh }).refresh).toEqual({ when: refresh.when, run: 'bun install --frozen-lockfile' });
	for (const bad of [{ when: refresh.when }, { run: refresh.run }, { when: [], run: refresh.run }, { when: refresh.when, run: ' ' }, null])
		expect(() => resolve({ integration: 'dev', refresh: bad })).toThrow('refresh: { when: string[], run: string }');
});

let done = () => {};
afterEach(() => done());

test('loads wf.config.ts from the checkout', async () => {
	const r = repo();
	done = r.done;
	write(r.main, 'wf.config.ts', `export default { integration: 'dev', prepare: 'bun install', gates: { cheap: ['bun test'] } };\n`);
	const c = await loadConfig(r.main);
	expect(c.prepare).toBe('bun install');
	expect(c.gates.cheap).toEqual(['bun test']);
});

test('says how to start when the config is missing', async () => {
	const r = repo();
	done = r.done;
	expect(loadConfig(r.main)).rejects.toThrow('bun wf init');
});
