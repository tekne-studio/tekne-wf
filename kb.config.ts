import { defineConfig } from '@tekne/kb/config';

export default defineConfig({
	docs: { groups: ['Project'] },
	roadmap: { file: 'roadmap.md', now: 'Now', later: 'Later', doneWhen: 'Done when' },
	agents: { modules: ['core', 'roadmap'] }
});
