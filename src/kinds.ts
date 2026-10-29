// What each agent kind needs: how herdr starts it in a pane and how it continues its
// last conversation. Another kind enters as one more row, once it is checked end to end.

export type KindSpec = {
	/** herdr's `--kind`, and the command that starts the agent in its pane's shell */
	herdr: string;
	/** arguments after `--` when starting a task; the config's `agent.args` replace them */
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
	/** asks "do you trust this folder?" on a repository never trusted */
	trust: boolean;
};

export const KINDS = {
	claude: {
		herdr: 'claude',
		start: (name) => ['--permission-mode', 'auto', '--name', name],
		always: ['--disallowedTools', 'AskUserQuestion', 'EnterPlanMode'],
		continue: ['--continue'],
		model: (model) => ['--model', model],
		// `--` ends the options: `--disallowedTools` takes every word after it
		prompt: (text) => ['--', text],
		integration: 'claude',
		trust: true
	}
} satisfies Record<string, KindSpec>;

export type Kind = keyof typeof KINDS;

export function isKind(k: string): k is Kind {
	return Object.hasOwn(KINDS, k);
}
