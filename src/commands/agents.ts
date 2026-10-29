// The commands around a running agent: tell, report, ask, resume, close, status.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { agentSession, currentSession, liveSession } from '../claude';
import type { Options } from '../cli';
import { WfError, anywhere, inMain, inWorktree } from '../context';
import { branchOf, git } from '../git';
import * as herdr from '../herdr';
import { KINDS } from '../kinds';
import { agentIn, closeWorktree, workspaceFor } from '../ship';
import { branchFor, nameFromBranch, readKeys } from '../state';
import { markDelivered, nextAction, stateWord } from '../watch';
import { NO_WATCH, START_WATCH, ago, answerBy, noAgent, noAgentFix, snapshotOf, watchLines, worktreeAgents } from '../worktrees';
import { callPerson } from './alert';
import { herdrReady, sendFirstPrompt } from './spawn';
import { worktreeOf } from './ship';

/**
 * `wf tell <name> <text>`: a message to a running agent, as a Claude Code session message.
 * The agent's pane is the person's too, and they may be typing in it: a message typed there
 * would merge with their half-written text and submit both. A session message arrives as
 * a message of its own and leaves the input box alone. Only a Claude Code session can send
 * one (SendMessage), so tell finds the agent's session and prints what to send; when none
 * can carry it, it says so and types nothing.
 */
export async function tellCommand(args: string[], _: Options): Promise<void> {
	const [name, ...words] = args;
	const text = words.join(' ').trim();
	if (!name || !text) throw new WfError('`bun wf tell <name> "<text>"`');
	const { state } = await anywhere();
	const agent = (await herdr.agentList()).find((a) => a.name === name);
	if (!agent) throw new WfError(`no live agent named ${name}: \`bun wf status\`, or \`bun wf resume ${name}\``);
	const session = agentSession(agent);
	if (!session)
		throw new WfError(`${name}'s Claude Code session is not running (pane ${agent.pane_id}), so no session message reaches it, and wf never types into a pane: look at it there, or \`bun wf resume ${name}\``);
	if (!currentSession()) throw new WfError(`wf tell runs from a Claude Code session, which sends the message with SendMessage; from a terminal, type it in pane ${agent.pane_id} yourself`);
	state.touchSent(name, agent.state_change_seq);
	if (agent.agent_status === 'blocked') console.log(`! ${name} is blocked on screen (pane ${agent.pane_id}): the message waits in its session until the person answers there`);
	console.log(`Tell ${name} now, with SendMessage to "${session.name}": ${JSON.stringify(text)}`);
}

/** A text from `--file`, or piped on stdin; `usage` says how when there is neither. */
async function readText(opt: Options, usage: string): Promise<string> {
	if (opt.file) {
		if (!existsSync(opt.file)) throw new WfError(`no file at ${opt.file}`);
		return readFileSync(opt.file, 'utf8');
	}
	if (process.stdin.isTTY) throw new WfError(usage);
	return Bun.stdin.text();
}

/**
 * `wf report`: the agent's finished work, on stdin or with --file.
 * The orchestrator wakes once per report and per question: a running watch that speaks for
 * the agent (`speaksFor`: its reader is the agent's orchestrator) delivers it, and the agent
 * sends no message; otherwise the message the agent sends carries it, and it is recorded as
 * delivered, so a watch started after it (the orchestrator's, between two returns) does not
 * deliver it again.
 */
export async function reportCommand(_: string[], opt: Options): Promise<void> {
	const ctx = await inWorktree('report');
	const name = nameFromBranch(await branchOf(ctx.root));
	if (!name) throw new WfError(`this worktree's branch is not worktree/<name>, so no orchestrator waits on it`);
	const text = await readText(opt, "pipe the report in: bun wf report <<'EOF' … EOF, or --file <path>");
	if (!text.trim()) throw new WfError('the report is empty');
	const agent = await agentIn(ctx.root);
	const path = ctx.state.writeReport(name, text, await git(ctx.root, 'rev-parse', '--short', 'HEAD'), new Date(), agent?.state_change_seq);
	console.log(`✓ report recorded (${path})`);
	const repo = basename(ctx.main);
	const meta = ctx.state.meta(name);
	// the watch sees only the worktrees `wf spawn` started
	if (meta && ctx.state.watcherFor(meta)) {
		console.log("The orchestrator's `bun wf watch` delivers it. Stop here.");
		return;
	}
	// no watch of the orchestrator's has the clock to remind anyone: the person hears of it now
	const shown = await herdr.notify(`wf: ${name} reported`, `${repo}: the orchestrator runs no \`bun wf watch\`, so it may not see it; \`bun wf status\``, 'request');
	console.log(`! the orchestrator runs no \`bun wf watch\` for ${repo}${shown ? ': the person was called' : ', and the call to the person did not go out'}`);
	const recorded = meta?.orchestrator;
	const session = recorded ? liveSession(recorded) : null;
	if (session) {
		ctx.state.writeDelivered(markDelivered(ctx.state.delivered(), { kind: 'report', name, at: ctx.state.reportTime(name) }));
		console.log(`Tell the orchestrator now, with SendMessage to "${session.name}": "wf: ${name} reported in ${repo}: ${path}; read the diff and look at the screens, then \`bun wf ship ${name}\`". Then stop.`);
	} else if (recorded) console.log(`The orchestrator's session (${recorded.name}) no longer runs. Stop here.`);
	else console.log('wf recorded no orchestrator session for this worktree. Stop here.');
}

/**
 * `wf ask "<question>"`: the agent stops on a question, a choice or a plan to approve; `-`,
 * or no argument, reads it from stdin.
 * With an orchestrator, the question is its: the orchestrator is the person's filter, and
 * brings them only what needs them, so the person is not called. Alone, the agent asks the
 * person: they are called, and the agent asks in its pane.
 *
 * An orchestrator runs when the session that spawned the agent still does (it receives the
 * message), or a watch that speaks for the agent runs (its reader is one: the session it
 * handed over to, or another harness's orchestrator when no session spawned the agent).
 * The watch sees only the worktrees `wf spawn` started. It reaches the orchestrator once,
 * as a report does.
 */
export async function askCommand(args: string[], opt: Options): Promise<void> {
	const ctx = await inWorktree('ask');
	const name = nameFromBranch(await branchOf(ctx.root));
	if (!name) throw new WfError(`this worktree's branch is not worktree/<name>, so no orchestrator watches it`);
	const usage = '`bun wf ask "<question>"`, or a long one (a plan with options) on stdin (`bun wf ask -`, or no argument) or with --file';
	const stdin = !args.length || (args.length === 1 && args[0] === '-');
	const question = (stdin ? await readText(opt, usage) : args.join(' ')).trim();
	if (!question) throw new WfError(usage);
	const repo = basename(ctx.main);
	const meta = ctx.state.meta(name);
	const session = meta?.orchestrator ? liveSession(meta.orchestrator) : null;
	const watch = meta ? ctx.state.watcherFor(meta) : null;
	const agent = await agentIn(ctx.root);
	const to = session || watch ? 'orchestrator' : 'person';
	const at = new Date().toISOString();
	const path = ctx.state.writeQuestion(name, { question, at, seq: agent?.state_change_seq, to });
	if (to === 'person') {
		if (await callPerson(ctx.state, repo, name, agent?.pane_id ?? meta?.pane ?? '?', false, question))
			console.log(`✓ no orchestrator runs for ${name}: the person was called. Ask them in your pane now, then stop.`);
		else console.log(`! no orchestrator runs for ${name}, and the call to the person did not go out: ask them in your pane now, then stop.`);
		return;
	}
	console.log(`✓ question recorded for the orchestrator (${path})`);
	if (watch) console.log("The orchestrator's `bun wf watch` delivers it. Stop here: the answer comes as a message.");
	else {
		ctx.state.writeDelivered(markDelivered(ctx.state.delivered(), { kind: 'question', name, at }));
		const text = `wf: ${name} asks, in ${repo}: ${question} (answer by ${answerBy(name, agent)})`;
		console.log(`Ask the orchestrator now, with SendMessage to "${session!.name}": ${JSON.stringify(text)}. Then stop: the answer comes as a message.`);
	}
}

export async function resumeCommand(args: string[], _: Options): Promise<void> {
	const [name] = args;
	if (!name) throw new WfError('`bun wf resume <name>`');
	const { main, config, state } = await inMain('resume');
	const meta = state.meta(name);
	if (!meta) throw new WfError(`wf started no agent in ${name}: start one in its pane, or \`bun wf close ${name}\``);
	const root = await worktreeOf(main, name);
	await herdrReady();
	const ws = await workspaceFor(root);
	if (!ws) throw new WfError(`no herdr workspace is open on ${root}; open it in herdr, then resume`);
	const panes = await herdr.paneList(ws);
	const live = panes.find((p) => p.agent);
	if (live) throw new WfError(`an agent is live in pane ${live.pane_id}: reach it by ${answerBy(name, await agentIn(root))}`);
	const pane = panes[0]?.pane_id;
	if (!pane) throw new WfError(`the workspace ${ws} has no pane`);
	const spec = KINDS[meta.kind];
	await herdr.agentStart(name, spec.herdr, pane, [...(config.agent.args ?? spec.start(name)), ...spec.always, ...(meta.model ? spec.model(meta.model) : []), ...spec.continue]);
	const nudge = `You were interrupted. Carry on with the task in ${state.taskPath(name)}; if it was done, run \`bun wf report\`.`;
	const seq = (await herdr.agentGet(name)).state_change_seq;
	state.writeMeta(name, { ...meta, workspace: ws, pane, sentAt: new Date().toISOString(), sentSeq: seq });
	await sendFirstPrompt(name, pane, nudge, seq, { is: 'nudge to carry on' });
	const delivered = state.delivered();
	if (delivered[name]) {
		delivered[name].gone = false;
		state.writeDelivered(delivered);
	}
	console.log(`✓ ${name} resumed in pane ${pane}`);
}

export async function closeCommand(args: string[], opt: Options): Promise<void> {
	const [name] = args;
	if (!name) throw new WfError('`bun wf close <name> [--force] [--delete-branch]`');
	const { main, state } = await inMain('close');
	const root = await worktreeOf(main, name);
	const force = !!opt.force;
	const dirty = await git(root, 'status', '--porcelain');
	if (dirty && !force) throw new WfError(`${root} has uncommitted changes; commit them, or --force to lose them:\n${dirty.replace(/^/gm, '  ')}`);
	const agent = await agentIn(root);
	if (agent?.agent_status === 'working' && !force) throw new WfError(`the agent in ${root} is working (pane ${agent.pane_id}); --force closes it anyway`);
	// forgotten first, as ship does: the agent ends before the folder goes, and meanwhile a
	// watch would read the worktree as gone
	state.forget(name);
	await closeWorktree(root, main, force);
	const branch = branchFor(name);
	if (opt['delete-branch']) {
		await git(main, 'branch', '-D', branch);
		console.log(`✓ branch ${branch} deleted`);
	} else console.log(`· branch ${branch} kept (--delete-branch deletes it)`);
	console.log(`✓ ${name} closed`);
}

export async function statusCommand(_: string[], __: Options): Promise<void> {
	const { main, config, state } = await anywhere();
	const I = config.integration;
	herdr.setEcho(false);
	const agents = await herdr.agentList().catch(() => null);
	const worktrees = await worktreeAgents(main, agents ?? []);
	if (!worktrees.length) {
		console.log(`no worktrees beside ${main}`);
		return;
	}
	const snap = snapshotOf(state, worktrees);
	const rows = [['name', 'behind/ahead', 'agent', 'report', 'next', 'look']];
	for (const w of worktrees) {
		const counts = w.branch ? (await git(main, 'rev-list', '--left-right', '--count', `${I}...${w.branch}`)).split(/\s+/) : [];
		const urls = config.look ? Object.values(readKeys(join(w.path, config.look.file), config.look.keys)).join(' ') : '';
		const report = snap.reports[w.name];
		rows.push([
			w.name,
			counts.length === 2 ? `${counts[0]}/${counts[1]}` : '-',
			agents === null ? '?' : w.agent ? `${w.agent.agent} ${stateWord(w.agent)}` : '! none',
			report ? ago(report) : '-',
			agents === null ? '?' : nextAction(snap, w.name, w.named && state.shipping(w.name)),
			urls || '-'
		]);
	}
	const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
	for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd());
	// with herdr silent, an agent may be there all the same: nothing is marked
	const alone = agents === null ? [] : worktrees.filter((w) => !w.agent);
	for (const w of alone) console.log(`\n! ${noAgent(w)}\n    ${noAgentFix(w, state)}`);
	if (!Object.keys(snap.metas).length) return;
	const { watch, waiting, asking } = watchLines(state, snap);
	console.log(watch ? `\n${watch}` : `\n! ${NO_WATCH}\n    ${START_WATCH}`);
	for (const w of [...asking, ...waiting]) console.log(`· ${w.line}`);
}
