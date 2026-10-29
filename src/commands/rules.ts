import type { Options } from '../cli';
import { anywhere } from '../context';
import { hasKb, renderRole, rulesProblems, type Role } from '../rules';

async function run(mode: 'gen' | 'check'): Promise<number> {
	const ctx = await anywhere();
	const { problems, written } = rulesProblems(ctx.root, ctx.config, mode);
	for (const p of problems) console.error(`✗ ${p}`);
	if (written) console.log(`✓ wrote the wf block in ${ctx.config.agentsFile}`);
	else if (!problems.length) console.log(`✓ the wf block in ${ctx.config.agentsFile} is current`);
	return problems.length ? 1 : 0;
}

export const genCommand = (_: string[], __: Options) => run('gen');
export const checkCommand = (_: string[], __: Options) => run('check');

/**
 * `wf --skill [--all]`: the rules for where it runs, from the project's config. A worktree
 * gets the agent's, the main checkout the orchestrator's, `--all` both; the block in
 * AGENTS.md points here, so a session reads only its own role at every turn.
 */
export async function skillCommand(_: string[], opt: Options): Promise<number> {
	const ctx = await anywhere();
	const roles: Role[] = opt.all ? ['agent', 'orchestrator'] : ctx.isMain ? ['orchestrator'] : ['agent'];
	const kb = hasKb(ctx.main, ctx.config);
	console.log(roles.map((r) => renderRole(r, ctx.config, { kb })).join('\n\n'));
	return 0;
}
