import { defineConfig } from './src/config';

export default defineConfig({
	integration: 'main',
	prepare: 'bun install',
	refresh: { when: ['bun.lock', '**/package.json'], run: 'bun install --frozen-lockfile' },
	gates: { cheap: ['bun run check', 'bun kb check', 'bun run test', 'bun wf check'] }
});
