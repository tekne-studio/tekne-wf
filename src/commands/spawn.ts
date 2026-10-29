import { existsSync, readFileSync } from 'node:fs';
import type { Options } from '../cli';
import { WfError, inMain } from '../context';
import { git } from '../git';
import { renderHeader } from '../header';
import { hasKb } from '../rules';
import * as herdr from '../herdr';
import { KINDS, isKind, type KindSpec } from '../kinds';
import { branchFor, checkName, worktreePath } from '../state';
import { claudeTrusts, currentSession } from '../claude';
import { prepareWorktree } from './prepare';
import { PLUGIN_ID } from './setup';

async function readTask(source: string | undefined): Promise<string> {
	if (!source) throw new WfError('the task is missing: `bun wf spawn <name> --task <file>`, or `--task -` with the task on stdin');
	const text = source === '-' ? await Bun.stdin.text() : existsSync(source) ? readFileSync(source, 'utf8') : '';
	if (source !== '-' && !existsSync(source)) throw new WfError(`no task file at ${source}`);
	if (!text.trim()) throw new WfError('the task is empty');
	return text;
}

/** herdr in the tested range, its server answering; otherwise wf stops before acting. */
export async function herdrReady(): Promise<void> {
	if (!(await herdr.installed())) throw new WfError('herdr is not installed');
	const v = await herdr.version();
	if (!herdr.inRange(v))
		throw new WfError(`herdr ${v} is outside the range this wf was tested with (>=${herdr.HERDR_RANGE.min} <${herdr.HERDR_RANGE.below}); update wf, or run \`bun run test:herdr\` in tekne-wf to see what changed`);
	if (!(await herdr.serverCompatible())) throw new WfError('the herdr server is not running or speaks another protocol: `herdr status`');
}

const STARTED: herdr.Agent['agent_status'][] = ['working', 'blocked', 'done'];
/** How long a Claude Code agent takes to show the turn it took; the tests' fake herdr needs none. */
const settleMs = () => Number(process.env.WF_SETTLE_MS ?? 3000);
/** How long herdr may take to see the agent in its pane after its command, as long as `herdr agent start` waits. */
const LAUNCH_MS = 60_000;

/**
 * The agent's state proves it took the prompt: changed since `seq`, and still working
 * (or blocked on a question, or done) a moment later. herdr's own answer is no proof: with
 * a long paste, Claude Code now and then keeps the text in its input box and drops the
 * Enter, while herdr reports success, having seen a flicker of activity.
 */
async function took(name: string, seq: number): Promise<boolean> {
	for (const pause of [settleMs(), settleMs() / 3]) {
		await Bun.sleep(pause);
		const a = await herdr.agentGet(name);
		if (a.state_change_seq <= seq || !STARTED.includes(a.agent_status)) return false;
	}
	return true;
}

/**
 * Types an agent's first prompt and proves it started, its state past `seq`, the one read
 * before the prompt. A prompt left in the input box gets Enter once; a prompt lost whole
 * (Claude Code just started, herdr answering success) is sent once more. herdr's JSON does
 * not show the box, so the Enter is the probe: it submits a held prompt, and an agent still
 * not started after it had an empty box. Only for an agent just started in its own pane,
 * where nobody types yet: every later message goes as a session message (SendMessage, or
 * `wf tell`), which never types into a pane.
 */
export async function sendFirstPrompt(name: string, pane: string, text: string, seq: number, what: { is: string; file?: string }): Promise<void> {
	await herdr.agentPrompt(name, text);
	if (await took(name, seq)) return;
	await herdr.agentSendKeys(name, ['Enter']);
	if (await took(name, seq)) {
		console.error(`! ${name} had not started: its ${what.is} sat in the input box of pane ${pane}; Enter sent once, and it started`);
		return;
	}
	await herdr.agentPrompt(name, text);
	if (await took(name, seq)) {
		console.error(`! ${name} had not started: its ${what.is} never reached the input box of pane ${pane}; sent once more, and it started`);
		return;
	}
	throw new WfError(
		`${name} has not started its ${what.is}, Enter sent once and the ${what.is} once more: look at pane ${pane}. \`herdr agent send-keys ${name} Enter\` submits what sits in its input box${what.file ? `; the ${what.is} is in ${what.file}` : ''}`
	);
}

/**
 * Starts the agent from its pane's shell, its first prompt among the arguments, and names
 * it. Claude Code's input box can lose a prompt typed while it starts, and herdr's JSON does
 * not show the box; the pane's tty keeps what reaches a shell. `herdr agent start` would
 * wait for an idle box, past the whole first turn, so wf names the agent herdr sees in the
 * pane. Returns the agent once herdr tells its state.
 */
async function launch(name: string, pane: string, command: string, args: string[]): Promise<herdr.Agent> {
	await herdr.paneRun(pane, command, args);
	const end = Date.now() + LAUNCH_MS;
	let p = await herdr.paneGet(pane);
	herdr.setEcho(false);
	try {
		// herdr sees the agent first and tells its state a few seconds later
		while ((!p.agent || p.agent_status === 'unknown') && Date.now() < end) {
			await Bun.sleep(500);
			p = await herdr.paneGet(pane);
		}
	} finally {
		herdr.setEcho(true);
	}
	if (!p.agent) throw new WfError(`no agent appeared in pane ${pane} within ${LAUNCH_MS / 1000} s of its command: look at the pane; \`bun wf close ${name} --delete-branch\` removes the worktree`);
	await herdr.agentRename(pane, name);
	return herdr.agentGet(name);
}

export async function spawnCommand(args: string[], opt: Options): Promise<void> {
	const [name] = args;
	if (!name) throw new WfError('name the worktree: `bun wf spawn <name> --task <file>`');
	const bad = checkName(name);
	if (bad) throw new WfError(bad);
	const ctx = await inMain('spawn');
	const { config, state, main } = ctx;
	const kind = opt.kind ?? config.agent.kind;
	if (!isKind(kind)) throw new WfError(`unknown agent kind "${kind}" (known: ${Object.keys(KINDS).join(', ')})`);
	const spec: KindSpec = KINDS[kind];
	const task = await readTask(opt.task);

	// --- Refusals, before anything is created -------------------------------
	const branch = branchFor(name);
	const path = worktreePath(main, name);
	if (await git(main, 'rev-parse', '--quiet', '--verify', `refs/heads/${branch}`)) throw new WfError(`the branch ${branch} already exists: pick another name, or \`bun wf close ${name} --delete-branch\``);
	if (existsSync(path)) throw new WfError(`${path} already exists`);
	if (!(await git(main, 'rev-parse', '--quiet', '--verify', `refs/heads/${config.integration}`))) throw new WfError(`the integration branch ${config.integration} does not exist`);
	await herdrReady();
	if ((await herdr.agentList()).some((a) => a.name === name)) throw new WfError(`an agent named ${name} is already live in herdr`);
	if (spec.trust && claudeTrusts(main) !== true)
		throw new WfError(`Claude Code has not trusted ${main} yet, so the agent would stop at the trust question: open Claude once in ${main} and confirm, then spawn again`);
	if (!(await herdr.pluginIds()).includes(PLUGIN_ID))
		console.error(`! the herdr plugin ${PLUGIN_ID} is not installed: the person is called for a blocked agent only while \`bun wf watch\` runs (\`bun wf doctor\`)`);

	// --- Worktree and preparation -------------------------------------------
	const { workspace, pane } = await herdr.worktreeCreate({ cwd: main, branch, base: config.integration, path, label: name });
	let urls: Record<string, string>;
	try {
		urls = await prepareWorktree(path);
	} catch (e) {
		throw new WfError(`${(e as Error).message}\nthe worktree stays at ${path} for a look; \`bun wf close ${name} --delete-branch\` removes it`);
	}

	// --- Task -----------------------------------------------------------------
	// the session running spawn is the orchestrator: the agent's report message goes to it
	const session = currentSession();
	const orchestrator = session ? { name: session.name, sessionId: session.sessionId, pid: session.pid } : undefined;
	const taskPath = state.writeTask(name, renderHeader({ name, path, main, config, kb: hasKb(main, config), urls, task, orchestrator: session }));
	const prompt = `Your task is in ${taskPath}: read it and do it.`;

	// --- Agent ----------------------------------------------------------------
	const model = opt.model?.trim() || undefined;
	const startArgs = [...(config.agent.args ?? spec.start(name)), ...spec.always, ...(model ? spec.model(model) : [])];
	let agent = await launch(name, pane, spec.herdr, [...startArgs, ...(spec.prompt?.(prompt) ?? [])]);
	// a stop at this state is from before the task: watch reads the agent from the moment the meta exists
	const seq = agent.state_change_seq;
	if (agent.agent_status === 'blocked') {
		// a dialog before the agent takes its prompt (a trust or setup question) is the person's; past it, the agent goes on to its prompt
		const shown = await herdr.notify(`wf: ${name} waits for you`, `pane ${pane}: the agent stopped while starting; answer it there`, 'request');
		console.log(`… ${name} stopped while starting; ${shown ? 'the person was called' : 'the call to the person did not go out'} (pane ${pane}). Waiting up to 10 minutes.`);
		await herdr.agentWait(name, ['working', 'idle', 'done'], 600_000);
		agent = await herdr.agentGet(name);
	}
	const now = new Date().toISOString();
	state.writeMeta(name, { kind, model, workspace, pane, path, spawnedAt: now, sentAt: now, sentSeq: seq, orchestrator });
	if (!STARTED.includes(agent.agent_status) && !(await took(name, agent.state_change_seq))) {
		// a kind with no prompt argument, or a prompt the agent did not take: typed, in a pane nobody types in yet
		if (spec.prompt) console.error(`! ${name} has not started on the prompt it was started with: typing it in pane ${pane}`);
		await sendFirstPrompt(name, pane, prompt, (await herdr.agentGet(name)).state_change_seq, { is: 'task', file: taskPath });
	}

	const shown = Object.entries(urls).map(([k, v]) => `${k} ${v}`).join(' · ');
	console.log(`\n✓ ${name} is working in ${path}`);
	console.log(`  pane ${pane} (workspace ${workspace}) · branch ${branch} · ${kind}${model ? ` ${model}` : ''}`);
	if (shown) console.log(`  ${shown}`);
	console.log(`  task: ${taskPath}`);
	console.log('  next: `bun wf watch` in the background');
}
