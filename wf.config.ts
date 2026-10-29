import { defineConfig } from './src/config';

export default defineConfig({
	integration: 'main',
	prepare: 'bun install',
	gates: { cheap: ['bun run check', 'bun kb check', 'bun run test', 'bun wf check'] }
});
