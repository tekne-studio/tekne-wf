#!/usr/bin/env -S bun --no-env-file
import { parseArgs } from 'node:util';
import { version as VERSION } from '../package.json';
import { ConfigError } from './config';
import { WfError } from './context';
import { HerdrError } from './herdr';
import { genCommand, checkCommand, skillCommand } from './commands/rules';
import { alertCommand } from './commands/alert';
import { askCommand, closeCommand, reportCommand, resumeCommand, statusCommand, tellCommand } from './commands/agents';
import { prepareCommand } from './commands/prepare';
import { doctorCommand, initCommand } from './commands/setup';
import { shipCommand } from './commands/ship';
import { spawnCommand } from './commands/spawn';
import { watchCommand } from './commands/watch';

const HELP = `wf: parallel coding agents, each in its own herdr worktree, run by one orchestrator.

In the main checkout (the orchestrator)
  wf spawn <name> --task <file|-> [--kind <k>] [--model <m>]
                                      worktree, preparation, agent and task, in one step
  wf watch [--timeout <ms>]           waits for the first thing to act on: blocked, question, report, idle, gone
  wf ship <name>… | --reported [--dry-run]
                                      merge, gates, fast-forward of the integration branch, close;
                                      several one after another; --reported: every report waiting
  wf close <name> [--force] [--delete-branch]
                                      abandons a worktree
  wf resume <name>                    starts the agent again, continuing its conversation

In a worktree (the agent)
  wf report [--file <f>]              the report, from stdin or a file
  wf ask "<question>"|-               you stop on a question, a choice or a plan (a long one on stdin):
                                      to the orchestrator when one runs, otherwise to the person
  wf ship [--dry-run]                 alone, with no orchestrator: delivers this worktree
  wf prepare [--worktree <path>] [--notify]
                                      the project's preparation, under the repository lock

Anywhere
  wf tell <name> <text>               the SendMessage that carries a message to that worktree's agent
  wf status                           worktrees, their agents and reports; marks one with no agent
  wf init                             wf.config.ts, AGENTS.md and the rules block (main checkout or worktree)
  wf gen | wf check                   writes | verifies the rules block in AGENTS.md
  wf --skill [--all]                  the rules for this checkout: the agent's in a worktree, the
                                      orchestrator's in the main checkout; --all prints both
  wf doctor                           herdr, the plugin, integrations, trust, config, worktrees with no agent

For the herdr plugin
  wf alert --pane <id>                calls the person for a blocked agent wf started

Each step that goes through herdr prints the herdr command it ran (→ herdr …).`;

const { values: opt, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		task: { type: 'string' },
		kind: { type: 'string' },
		model: { type: 'string' },
		file: { type: 'string' },
		worktree: { type: 'string' },
		pane: { type: 'string' },
		notify: { type: 'boolean' },
		timeout: { type: 'string' },
		force: { type: 'boolean' },
		'delete-branch': { type: 'boolean' },
		'dry-run': { type: 'boolean' },
		reported: { type: 'boolean' },
		skill: { type: 'boolean' },
		all: { type: 'boolean' },
		version: { type: 'boolean', short: 'v' },
		help: { type: 'boolean', short: 'h' }
	}
});

export type Options = typeof opt;

const [cmd, ...args] = positionals;

const COMMANDS: Record<string, (args: string[], opt: Options) => Promise<number | void>> = {
	gen: genCommand,
	check: checkCommand,
	spawn: spawnCommand,
	watch: watchCommand,
	ship: shipCommand,
	close: closeCommand,
	resume: resumeCommand,
	report: reportCommand,
	ask: askCommand,
	prepare: prepareCommand,
	tell: tellCommand,
	status: statusCommand,
	init: initCommand,
	doctor: doctorCommand,
	alert: alertCommand
};

async function main(): Promise<number> {
	if (opt.version) {
		console.log(VERSION);
		return 0;
	}
	if (opt.skill) return (await skillCommand(args, opt)) ?? 0;
	if (!cmd || opt.help || cmd === 'help') {
		console.log(HELP);
		return cmd || opt.help ? 0 : 2;
	}
	const run = COMMANDS[cmd];
	if (!run) {
		console.error(`unknown command: ${cmd}\n\n${HELP}`);
		return 2;
	}
	return (await run(args, opt)) ?? 0;
}

try {
	process.exitCode = await main();
} catch (e) {
	if (e instanceof WfError || e instanceof ConfigError || e instanceof HerdrError) {
		const code = e instanceof HerdrError ? ` (herdr: ${e.code})` : '';
		console.error(`\n✗ ${e.message}${code}`);
		process.exitCode = e instanceof WfError ? e.code : 1;
	} else throw e;
}
