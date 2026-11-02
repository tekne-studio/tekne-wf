// What each agent kind needs: how herdr starts it in a pane, how it continues its last
// conversation, how it asks to trust a folder and how a message reaches it. Another kind
// enters as one more row, once it is checked end to end.
import { claudeTrusts } from './claude';
import { kimiTrusts } from './kimi';

export type KindSpec = {
	/** the name wf's messages give it */
	title: string;
	/** herdr's `--kind`, and the command that starts the agent in its pane's shell */
	herdr: string;
	/** arguments after `--` when starting a task; the config's `agent.args` replace them for the config's kind */
	start: (name: string) => string[];
	/**
	 * arguments every start gets, the config's `agent.args` included: the tools whose dialog
	 * only the person can answer (a question's choices, a plan's approval), so the agent asks
	 * with `wf ask` and a blocked agent is one waiting on a permission
	 */
	always: string[];
	/** arguments that continue the latest conversation of the folder */
	continue: string[];
	/** arguments that pick the model, from `wf spawn --model` */
	model: (model: string) => string[];
	/** arguments, last on the command line, that hand the agent its first prompt as it starts; without them, `spawn` types it */
	prompt?: (text: string) => string[];
	/** herdr's state integration that tells working, blocked and done apart */
	integration: string;
	/**
	 * When it asks "do you trust this folder?": once per `repository`, a worktree trusted
	 * with its main checkout, so `spawn` refuses until the person has answered there; or for
	 * each `folder` it never saw, so in every new worktree, where `spawn` calls the person to
	 * answer it in the pane
	 */
	trust: 'repository' | 'folder';
	/** the kind's own record of the person's answer for a folder, read only; null when it cannot be read */
	trusts: (folder: string) => boolean | null;
	/**
	 * a Claude Code session: messages reach it as session messages and it sends its own with
	 * SendMessage. Without one, `wf tell` types a message into its input box while it is
	 * stopped, and its reports and questions reach the orchestrator through its watch
	 */
	session: boolean;
};

export const KINDS = {
	claude: {
		title: 'Claude Code',
		herdr: 'claude',
		start: (name) => ['--permission-mode', 'auto', '--name', name],
		always: ['--disallowedTools', 'AskUserQuestion', 'EnterPlanMode'],
		continue: ['--continue'],
		model: (model) => ['--model', model],
		// `--` ends the options: `--disallowedTools` takes every word after it
		prompt: (text) => ['--', text],
		integration: 'claude',
		trust: 'repository',
		trusts: claudeTrusts,
		session: true
	},
	kimi: {
		title: 'Kimi Code',
		herdr: 'kimi',
		// Ask When Needed: routine edits and commands run, risky actions ask the person
		start: () => ['-y'],
		always: [],
		continue: ['-c'],
		// an alias from Kimi's config.toml, not a provider's model id
		model: (model) => ['-m', model],
		integration: 'kimi',
		trust: 'folder',
		trusts: kimiTrusts,
		session: false
	}
} satisfies Record<string, KindSpec>;

export type Kind = keyof typeof KINDS;

export function isKind(k: string): k is Kind {
	return Object.hasOwn(KINDS, k);
}

/** The row of the kind herdr reports for an agent (its `agent` field). */
export function kindOf(herdrKind: string | null | undefined): KindSpec | undefined {
	return Object.values(KINDS).find((k: KindSpec) => k.herdr === herdrKind);
}

/** The arguments every start of `kind` gets, before the model's and the continue flag: the config's `agent.args` belong to the config's kind. */
export function startArgs(kind: Kind, name: string, config: { agent: { kind: Kind; args: string[] | null } }): string[] {
	const spec: KindSpec = KINDS[kind];
	const own = kind === config.agent.kind ? config.agent.args : null;
	return [...(own ?? spec.start(name)), ...spec.always];
}
