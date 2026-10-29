// The header `wf spawn` sends above each task, from templates/header.md. It holds what the
// agent finds nowhere else: AGENTS.md (CLAUDE.md links it) and the commands it runs say the
// rest, on every turn. The agent's rules ride in it once, since the block in AGENTS.md
// carries only what every agent needs and points to `wf --skill`.
import type { Session } from './claude';
import type { Resolved } from './config';
import { renderRole } from './rules';
import { fill, template } from './template';

export function renderHeader(o: {
	name: string;
	path: string;
	main: string;
	config: Resolved;
	/** whether the project's agents file carries kb's block */
	kb?: boolean;
	/** the URLs read after prepare, by key */
	urls: Record<string, string>;
	task: string;
	/** the Claude Code session running `wf spawn`, when one does */
	orchestrator?: Session | null;
}): string {
	const urls = Object.entries(o.urls);
	return fill(template('header'), {
		name: o.name,
		path: o.path,
		orchestrator: o.orchestrator ? `the Claude Code session \`${o.orchestrator.name}\`, in ${o.main}` : `the session in ${o.main}`,
		look: urls.length ? `- Look at it running: ${urls.map(([k, v]) => `${k} ${v}`).join(' · ')}\n` : '',
		extra: o.config.header ? `- ${o.config.header}\n` : '',
		rules: renderRole('agent', o.config, { kb: o.kb }),
		task: o.task.trim()
	}).trim();
}
