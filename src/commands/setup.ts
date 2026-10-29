// init and doctor: setting a project up, and checking a machine and a project.
import { existsSync, lstatSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Options } from '../cli';
import { CONFIG_FILE, loadConfig } from '../config';
import { here } from '../context';
import { branchOf } from '../git';
import * as herdr from '../herdr';
import { KINDS } from '../kinds';
import { OPENER, rulesProblems } from '../rules';
import { State } from '../state';
import { claudeTrusts } from '../claude';
import { NO_WATCH, START_WATCH, answerBy, noAgent, noAgentFix, snapshotOf, watchLines, worktreeAgents } from '../worktrees';

export const PLUGIN_ID = 'tekne.wf';

function starter(integration: string, bun: boolean): string {
	// a type-only import: the config loads even before @tekne/wf is installed
	return `import type { Config } from '@tekne/wf/config';

export default {
	integration: '${integration}',
${bun ? `	// runs in each new worktree and after each merge of ${integration}; must be idempotent\n	prepare: 'bun install',\n` : ''}	// an agent runs the cheap ones in its worktree; wf ship runs them all, cheap first, and stops at the first that fails
	gates: { cheap: [], expensive: [] }
} satisfies Config;
`;
}

/** Adds `"wf": "wf"` to package.json's scripts, keeping the file's own formatting. */
function addScript(file: string): 'added' | 'present' | 'no-scripts' {
	const text = readFileSync(file, 'utf8');
	if (JSON.parse(text).scripts?.wf) return 'present';
	const m = text.match(/"scripts"\s*:\s*\{(\r?\n)([ \t]*)/);
	if (!m || m.index === undefined) return 'no-scripts';
	const at = m.index + m[0].length;
	writeFileSync(file, `${text.slice(0, at)}"wf": "wf",${m[1]}${m[2]}${text.slice(at)}`);
	return 'added';
}

export async function initCommand(_: string[], __: Options): Promise<number> {
	// in the main checkout or in a worktree: a project adopts wf through its own flow, in a
	// worktree it then ships. Either way the integration branch is the main checkout's.
	const c = await here();
	const root = c.root;
	const made: string[] = [];

	const pkg = join(root, 'package.json');
	if (!existsSync(join(root, CONFIG_FILE))) {
		const branch = (await branchOf(c.main)) || 'main';
		writeFileSync(join(root, CONFIG_FILE), starter(branch, existsSync(pkg)));
		made.push(`${CONFIG_FILE} (integration: ${branch})`);
	}
	const config = await loadConfig(root);

	const agents = join(root, config.agentsFile);
	const claude = join(root, 'CLAUDE.md');
	const isLink = (p: string) => {
		try {
			return lstatSync(p).isSymbolicLink();
		} catch {
			return false;
		}
	};
	if (!existsSync(agents)) {
		if (config.agentsFile === 'AGENTS.md' && existsSync(claude) && !isLink(claude)) {
			// an existing CLAUDE.md becomes AGENTS.md, and CLAUDE.md a link to it
			renameSync(claude, agents);
			made.push('AGENTS.md (from CLAUDE.md)');
		} else {
			// the repository's name, the main checkout's folder, wherever init runs
			writeFileSync(agents, `# ${basename(c.main)}\n\n${OPENER}\n<!-- /wf:rules -->\n`);
			made.push(config.agentsFile);
		}
	}
	if (config.agentsFile === 'AGENTS.md' && !existsSync(claude) && !isLink(claude)) {
		symlinkSync('AGENTS.md', claude);
		made.push('CLAUDE.md → AGENTS.md');
	}
	if (existsSync(pkg)) {
		const r = addScript(pkg);
		if (r === 'added') made.push('the "wf" script in package.json');
		if (r === 'no-scripts') console.log('! package.json has no "scripts": add "wf": "wf" so agents run `bun wf`');
	}
	const { problems, written } = rulesProblems(root, config, 'gen');
	if (written) made.push(`the wf block in ${config.agentsFile}`);
	for (const m of made) console.log(`✓ ${m}`);
	for (const p of problems) console.log(`✗ ${p}`);
	console.log('');
	return (await doctorCommand([], __)) || (problems.length ? 1 : 0);
}

export async function doctorCommand(_: string[], __: Options): Promise<number> {
	const c = await here();
	let failed = 0;
	const ok = (m: string) => console.log(`✓ ${m}`);
	const bad = (m: string, fix: string) => {
		failed++;
		console.log(`✗ ${m}\n    ${fix}`);
	};
	const warn = (m: string, fix: string) => console.log(`! ${m}\n    ${fix}`);
	herdr.setEcho(false);

	let config;
	try {
		config = await loadConfig(c.root);
		ok(`${CONFIG_FILE}: integration ${config.integration}, ${config.gates.cheap.length + config.gates.expensive.length} gates`);
	} catch (e) {
		bad((e as Error).message, '`bun wf init` writes a starting config');
	}
	if (config) {
		const { problems } = rulesProblems(c.root, config, 'check');
		if (problems.length) for (const p of problems) bad(p, '`bun wf gen`');
		else ok(`the wf block in ${config.agentsFile} is current`);
	}

	if (process.env.HERDR_ENV !== '1') warn('this shell is not in a herdr pane', 'run the orchestrator inside herdr, so its agents open beside it');
	if (!(await herdr.installed())) {
		bad('herdr is not installed', 'install herdr, then run `bun wf doctor` again');
		return 1;
	}
	try {
		const v = await herdr.version();
		if (herdr.inRange(v)) ok(`herdr ${v}`);
		else bad(`herdr ${v} is outside the tested range (>=${herdr.HERDR_RANGE.min} <${herdr.HERDR_RANGE.below})`, 'update wf, or run `bun run test:herdr` in tekne-wf to see what changed');
		if (await herdr.serverCompatible()) ok('herdr server running and compatible');
		else bad('the herdr server is not running or speaks another protocol', '`herdr status`');

		if ((await herdr.pluginIds()).includes(PLUGIN_ID)) ok(`herdr plugin ${PLUGIN_ID}: calls the person when an agent stays blocked`);
		else
			bad(
				`herdr plugin ${PLUGIN_ID} is not installed: nobody calls the person when an agent stays blocked, and worktrees made in herdr by hand are not prepared`,
				'herdr plugin install tekne-studio/tekne-wf/herdr'
			);

		const kind = config?.agent.kind ?? 'claude';
		const spec = KINDS[kind];
		const states = await herdr.integrations();
		if (states[spec.integration] === 'current') ok(`herdr integration ${spec.integration}: working, blocked and done tell apart`);
		else bad(`herdr integration ${spec.integration}: ${states[spec.integration] ?? 'unknown'}`, `herdr integration install ${spec.integration}`);

		// a warning: a worktree between its agent's exit and a resume is the flow's own state,
		// and what to do (resume, start, close) is the orchestrator's call, not the setup's
		const worktrees = await worktreeAgents(c.main, await herdr.agentList());
		const alone = worktrees.filter((w) => !w.agent);
		const state = new State(c.commonDir);
		for (const w of alone) warn(noAgent(w), noAgentFix(w, state));
		if (worktrees.length && !alone.length) ok(`an agent the person can watch in each worktree (${worktrees.length})`);
		const snap = snapshotOf(state, worktrees);
		if (Object.keys(snap.metas).length) {
			const { watch, waiting, asking } = watchLines(state, snap);
			if (watch) ok(watch);
			else warn(NO_WATCH, START_WATCH);
			const agent = (name: string) => worktrees.find((w) => w.named && w.name === name)?.agent;
			for (const w of waiting) warn(w.line, `check it, then \`bun wf ship ${w.name}\`, or answer by ${answerBy(w.name, agent(w.name))}`);
			for (const q of asking) warn(q.line, `the orchestrator answers by ${answerBy(q.name, agent(q.name))}`);
		}
	} catch (e) {
		bad(`herdr did not answer: ${(e as Error).message}`, '`herdr status`');
	}

	if (KINDS[config?.agent.kind ?? 'claude'].trust) {
		const trusted = claudeTrusts(c.main);
		if (trusted) ok(`Claude Code trusts ${c.main} (and so every worktree of it)`);
		else bad(`Claude Code has not trusted ${c.main}${trusted === null ? ' (its record could not be read)' : ''}`, `open Claude once in ${c.main} and confirm; wf never answers for you`);
	}
	return failed ? 1 : 0;
}
