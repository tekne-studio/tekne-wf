// `wf.config.ts`: the only part of the flow that changes between projects.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KINDS, isKind, type Kind } from './kinds';

export type Config = {
	/** the branch the main checkout stays on; `wf ship` fast-forwards it */
	integration: string;
	/** idempotent shell command, run in the worktree at creation and after each merge of the integration branch */
	prepare?: string;
	/** shell commands run in the worktree, in order; the first failure stops the run */
	gates?: { cheap?: string[]; expensive?: string[] };
	/** globs of the paths that count as docs only: a diff where every file matches runs only the cheap gates */
	docsOnly?: string[];
	/** where the URLs for the person are, after `prepare`: `KEY=value` lines in `file` */
	look?: { file: string; keys: string[] };
	/** the agent `wf spawn` starts; `args` replace the kind's defaults */
	agent?: { kind?: Kind; args?: string[] };
	/** project lines for the task header */
	header?: string;
	/** default `AGENTS.md` */
	agentsFile?: string;
};

export type Resolved = Required<Pick<Config, 'integration'>> & {
	prepare: string;
	gates: { cheap: string[]; expensive: string[] };
	docsOnly: string[];
	look: { file: string; keys: string[] } | null;
	agent: { kind: Kind; args: string[] | null };
	header: string;
	agentsFile: string;
};

export const CONFIG_FILE = 'wf.config.ts';

/** Types the config in the editor; returns it as is. */
export function defineConfig(config: Config): Config {
	return config;
}

export class ConfigError extends Error {}

const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '');

/** Checks the config and fills the defaults; every problem names its field. */
export function resolve(raw: unknown): Resolved {
	const problems: string[] = [];
	const c = (raw ?? {}) as Record<string, any>;
	if (typeof raw !== 'object' || raw === null) throw new ConfigError(`${CONFIG_FILE} must export a config object (export default defineConfig({ … }))`);
	const known = ['integration', 'prepare', 'gates', 'docsOnly', 'look', 'agent', 'header', 'agentsFile'];
	for (const k of Object.keys(c)) if (!known.includes(k)) problems.push(`${k}: unknown field (known: ${known.join(', ')})`);

	if (typeof c.integration !== 'string' || !c.integration.trim()) problems.push('integration: the integration branch, a non-empty string (e.g. "dev")');
	if (c.prepare !== undefined && typeof c.prepare !== 'string') problems.push('prepare: a shell command string');
	if (c.gates !== undefined) {
		if (typeof c.gates !== 'object' || c.gates === null || Array.isArray(c.gates)) problems.push('gates: { cheap?: string[], expensive?: string[] }');
		else {
			for (const k of Object.keys(c.gates)) if (k !== 'cheap' && k !== 'expensive') problems.push(`gates.${k}: unknown (cheap, expensive)`);
			for (const k of ['cheap', 'expensive']) if (c.gates[k] !== undefined && !strings(c.gates[k])) problems.push(`gates.${k}: a list of shell commands`);
		}
	}
	if (c.docsOnly !== undefined && !strings(c.docsOnly)) problems.push('docsOnly: a list of globs, e.g. ["docs/**", "**/*.md"]');
	if (c.look !== undefined && (typeof c.look?.file !== 'string' || !strings(c.look?.keys) || c.look.keys.length === 0))
		problems.push('look: { file: string, keys: string[] }, e.g. { file: ".env.local", keys: ["APP_URL"] }');
	if (c.agent !== undefined) {
		if (c.agent.kind !== undefined && !isKind(c.agent.kind)) problems.push(`agent.kind: one of ${Object.keys(KINDS).join(', ')}`);
		if (c.agent.args !== undefined && !(Array.isArray(c.agent.args) && c.agent.args.every((a: unknown) => typeof a === 'string')))
			problems.push('agent.args: a list of strings');
	}
	if (c.header !== undefined && typeof c.header !== 'string') problems.push('header: a string');
	if (c.agentsFile !== undefined && (typeof c.agentsFile !== 'string' || !c.agentsFile.trim())) problems.push('agentsFile: a path, default "AGENTS.md"');
	if (problems.length) throw new ConfigError(`${CONFIG_FILE}:\n- ${problems.join('\n- ')}`);

	return {
		integration: c.integration,
		prepare: c.prepare?.trim() ?? '',
		gates: { cheap: c.gates?.cheap ?? [], expensive: c.gates?.expensive ?? [] },
		docsOnly: c.docsOnly ?? [],
		look: c.look ? { file: c.look.file, keys: c.look.keys } : null,
		agent: { kind: c.agent?.kind ?? 'claude', args: c.agent?.args ?? null },
		header: c.header?.trim() ?? '',
		agentsFile: c.agentsFile ?? 'AGENTS.md'
	};
}

/** The config of the checkout at `root` (in a worktree, the branch's own version). */
export async function loadConfig(root: string): Promise<Resolved> {
	const file = join(root, CONFIG_FILE);
	if (!existsSync(file)) throw new ConfigError(`no ${CONFIG_FILE} in ${root}: run \`bun wf init\` in the main checkout`);
	let mod;
	try {
		mod = await import(pathToFileURL(file).href);
	} catch (e) {
		throw new ConfigError(`${file} did not load: ${(e as Error).message}`);
	}
	return resolve(mod.default);
}
