import { afterEach, expect, test } from 'bun:test';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from '../src/claude';
import { resolve } from '../src/config';
import { renderHeader } from '../src/header';
import { OPENER, renderRole, renderRules, rulesProblems, withBlock } from '../src/rules';
import { fill, template } from '../src/template';
import { repo } from './helpers';

const CONFIG = resolve({
	integration: 'dev',
	prepare: 'bun run worktree',
	gates: { cheap: ['bun run check', 'bun kb check', 'bun run test:unit'], expensive: ['bun run test:e2e'] },
	look: { file: '.env.local', keys: ['APP_URL', 'MAILPIT_URL'] },
	header: 'Sign-in codes arrive at MAILPIT_URL.'
});

const agent = (c = CONFIG, o?: { kb?: boolean }) => renderRole('agent', c, o);
const orch = (c = CONFIG, o?: { kb?: boolean }) => renderRole('orchestrator', c, o);
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

test('the block says what every agent needs at every turn, under 300 words, and points to wf --skill', () => {
	const r = renderRules(CONFIG);
	expect(words(r)).toBeLessThan(300);
	expect(r).toContain('One orchestrator, a Claude Code session in the main checkout on `dev`, leads the agents. Each task, whoever brings it, gets its own worktree, branch and agent, in a herdr pane the person watches, and a follow-up on a task goes to its agent; never two agents in one working directory.');
	expect(r).toContain('Never merge, push or close a worktree from inside it: the orchestrator ships it.');
	// the commands print the SendMessage they need; the block says to send it, once
	expect(r).toContain('`bun wf` runs the flow; when `ask`, `tell` or `report` prints a SendMessage, send it.');
	expect(r.match(/SendMessage/g)).toHaveLength(1);
	expect(r).toContain('use `herdr` (`herdr --skill`)');
	expect(r).toContain('run `bun wf --skill`: it prints the rules for the checkout it runs in, the agent\'s in a worktree and the orchestrator\'s in the main checkout; `--all` prints both.');
	// the roles live in wf --skill, not in the block
	expect(r).not.toContain('In a worktree: the agent');
	expect(r).not.toContain('In the main checkout: the orchestrator');
	expect(r).not.toContain('{{');
});

test('the roles name the project: branch, gates, URLs', () => {
	const r = `${agent()}\n\n${orch()}`;
	expect(r).toContain('git diff dev...worktree/<name>');
	expect(r).toContain('- Run the cheap gates (`bun run check`, `bun kb check`, `bun run test:unit`) and, of the expensive ones (`bun run test:e2e`), only the test files you touched.');
	expect(r).toContain('`bun wf ship <name>` brings `dev` in, runs every gate, fast-forwards `dev` and closes the worktree.');
	expect(r).toContain('what to look at (`APP_URL`, `MAILPIT_URL` in `.env.local`)');
	expect(r).toContain('Never open a worktree by hand or edit in one.');
	expect(r).toContain('- Reach an agent by SendMessage to its name (`bun wf tell <name> "<text>"` when that misses its session), or `bun wf resume <name>` when it is gone. Never type into its pane.');
	expect(r).toContain('A test that fails with no cause in the change goes to quarantine, never three reruns, and only with proof: it fails on `dev` without the change too, or passes alone and fails only under load.');
	expect(r).toContain('Then tell the agent to skip it and name it, with the proof, as an open question in its report, and ship again.');
	expect(r).not.toContain('{{');
});

test('the orchestrator is the person\'s filter; the agent asks it with wf ask; a dialog on screen stays the person\'s', () => {
	const r = `${agent()}\n\n${orch()}`;
	// the orchestrator's way to answer; the block already says to send what a command prints
	expect(r.match(/SendMessage/g)).toHaveLength(1);
	expect(r).toContain('- Stop at what is not yours to decide (a business rule, the boundary with another task): never invent. Ask by `bun wf ask "<question>"` (a long one on stdin), never by a dialog on screen (such as AskUserQuestion), then stop; a question, there or in your report, carries the options and your recommendation.');
	expect(r.match(/your recommendation/g)).toHaveLength(1);
	expect(r).toContain('When the person talks to you in your pane, follow them and say so in your report.');
	expect(r).toContain("You are the person's filter: when what exists settles an agent's question (the decisions, the docs, the person's earlier choices), answer it, naming the basis, and tell the person what you decided and why.");
	expect(r).toContain('Bring to the person only a product question nothing settles, a permission, or anything destructive or outward (a push, a publish), and relay their answer.');
	expect(r).toContain("A dialog on an agent's screen (a tool permission, an approval) is the person's: never press it.");
	// the agent's rules end with the case of no orchestrator; the orchestrator's never mention it
	expect(agent()).toContain("**Alone in a worktree**, with no orchestrator, you are both (`bun wf --skill --all` prints the orchestrator's rules too): you finish with `bun wf ship` from the worktree.");
	expect(orch()).not.toContain('Alone');
	// with no kb, the decisions are named without its commands
	expect(r).not.toContain('kb why');
	const kb = orch(CONFIG, { kb: true });
	expect(kb).toContain("when what exists settles an agent's question (`kb why`, the decisions, the docs, the person's earlier choices)");
});

test('with no kb, a decision is recorded only when the choice had a plausible alternative; with kb, its block says when', () => {
	const r = orch();
	expect(r).toContain('Record a decision (where the project keeps them) only when the choice had a plausible alternative someone would propose again, and Rejected names it; without one, the why goes in a code comment or the topic doc; one choice per decision.');
	const kb = orch(CONFIG, { kb: true });
	expect(kb).toContain('Record an answer that is a decision with `kb decision new`.');
	expect(kb).not.toContain('plausible alternative');
});

test('the agent commits as it goes and the ship tests the tip; tools change between rounds', () => {
	const r = `${agent()}\n\n${orch()}`;
	expect(r).toContain('- Work only in your worktree, and commit as you go: a commit is a checkpoint, and `bun wf ship` tests the tip.');
	expect(r).toContain("- A wf upgrade waits until a round ships and no worktree is open; an improvement to a tool found during a round goes to its roadmap, for one release at the round's end.");
	expect(orch(CONFIG, { kb: true })).toContain('- A wf or kb upgrade waits until a round ships');
});

test('with docs-only paths, the ship runs in proportion to the diff', () => {
	const r = orch(resolve({ integration: 'dev', docsOnly: ['docs/**', '**/*.md'], gates: { cheap: ['bun run check'], expensive: ['bun run test:e2e'] } }));
	expect(r).toContain('`bun wf ship <name>` brings `dev` in, runs the cheap gates alone when every changed file is docs (`docs/**`, `**/*.md`), otherwise every gate, fast-forwards `dev` and closes the worktree.');
	// with no expensive gate, there is nothing to leave out
	expect(orch(resolve({ integration: 'dev', docsOnly: ['docs/**'], gates: { cheap: ['bun run check'] } }))).toContain('runs every gate, fast-forwards');
});

test('the orchestrator commits a change with no behavior itself only where the ship would run the cheap gates alone', () => {
	const look = '- Before each spawn, one look: when the change has no behavior (your records, such as a decision, a question, a roadmap or doc line';
	const then = ' yourself, staging only its files (the person works here too), after the cheap gates and with no ship running (`bun wf status`, your background commands); anything else goes by `bun wf spawn`.';
	// with expensive gates, only in the docs the ship tests with the cheap gates alone:
	// a comment is never in them, and a label is what a reader sees
	const docs = orch(resolve({ integration: 'dev', docsOnly: ['docs/**', '**/*.md'], gates: { cheap: ['bun run check'], expensive: ['bun run test:e2e'] } }));
	expect(docs).toContain(`${look}) and touches only docs (\`docs/**\`, \`**/*.md\`), commit it on \`dev\`${then}`);
	expect(docs).not.toContain('a typo');
	// with no expensive gate, the ship runs the cheap gates on any file
	const any = orch(resolve({ integration: 'main', gates: { cheap: ['bun run test'] } }));
	expect(any).toContain(`${look}; a typo, a comment), commit it on \`main\`${then}`);
	expect(any).not.toContain('a label');
	// with expensive gates and no docs-only paths, every task gets a worktree
	const all = orch();
	expect(all).toContain('- Every task goes by `bun wf spawn`, your own records too: the ship runs every gate on every file.');
	expect(all).not.toContain('one look');
});

test('sessions stay short: one task per agent session; the orchestrator reads narrowly and hands over with the state written outside', () => {
	const r = orch();
	expect(r).toContain('- Each return of `bun wf watch` rereads your whole conversation: keep it lean, and read a report narrowly.');
	expect(r).toContain("- After a round ships, or once this session has grown long, write what lives only in the conversation, such as an answer you gave an agent that should outlast it or a yes the person still owes, in the project's records (the decisions, the roadmap, the open questions); then tell the person this session is ready to hand over (in Claude Code, `/clear`). The new session starts from `bun wf status`.");
	expect(r).not.toContain('kb question add');
	// with kb, its block names each fact's home
	expect(orch(CONFIG, { kb: true })).toContain('a yes the person still owes, in its home; then tell the person');
});

test('small fixes go in batches, one task each; the review adds what the gates cannot; the report fits the change', () => {
	const r = `${agent()}\n\n${orch()}`;
	expect(r).toContain("- Small fixes go in batches of 2 to 4, in one task file for one agent. A fix is small when its cause and place are known and fit in one line, and it touches no business rule and nothing the project's section of AGENTS.md marks as sensitive.");
	expect(r).toContain('- A batch of small fixes is one task: one commit per fix, one report; a fix that turns out bigger goes by `bun wf ask` and leaves the batch for a task of its own.');
	expect(r.match(/one commit per fix/g)).toHaveLength(1);
	// the review reads and looks; the gates are the ship's
	expect(r).toContain('- A report is a claim: read the diff (`git diff dev...worktree/<name>`), whole when small, `--stat` and then one file at a time when large, and look at what changed on screen. Leave the gates to `bun wf ship`.');
	expect(r.match(/--stat/g)).toHaveLength(1);
	// the report
	expect(r).toContain('- Finish with `bun wf report`, the report on stdin: the commits; the commands you ran and what they printed; what to look at (`APP_URL`, `MAILPIT_URL` in `.env.local`); open questions; what you noticed around. Fit it to the change: a small one gets the commits, the last lines of the gates and what to look at; leave out a section with nothing to say. Then stop.');
	// the templates name no project's domain
	for (const t of ['rules', 'agent', 'orchestrator'] as const) expect(template(t)).not.toMatch(/money|payment|invoice|course|student/);
});

test('the project section of AGENTS.md is the orchestrator\'s; the agent keeps the topic doc and proposes; the task file names what to read', () => {
	const r = `${agent()}\n\n${orch()}`;
	expect(r).toContain("- The topic doc of what you change is yours: update it in the commit of the change. A rule you think the project's section of AGENTS.md needs goes in your report, as a proposal, never into the file.");
	expect(r).toContain("- Only you write the project section of AGENTS.md, from an agent's proposal or the person's words: one line per rule, linking the doc section that explains it.");
	// with no kb, the doc sections are found in the docs; with kb, by its commands
	expect(r).toContain("- A task file names the doc sections the agent reads (found in the project's docs), so the agent needs no more than AGENTS.md and them.");
	expect(orch(CONFIG, { kb: true })).toContain('- A task file names the doc sections the agent reads (found with `kb search` or `kb why`), so the agent needs no more than AGENTS.md and them.');
});

test('a project with no gates says so', () => {
	expect(agent(resolve({ integration: 'main' }))).toContain('(none configured)');
});

test('with no expensive gates, the agent runs the cheap ones and the ship the rest', () => {
	const r = agent(resolve({ integration: 'main', gates: { cheap: ['bun run test'] } }));
	expect(r).toContain('- Run the cheap gates (`bun run test`).');
	expect(r).not.toContain('the test files you touched');
});

test('a placeholder with no value is an error', () => {
	expect(() => fill('{{missing}}', {})).toThrow('{{missing}}');
});

const KB = '# P\n\n<!-- kb:global · generated by kb gen -->\nkb rules\n<!-- /kb:global -->\n\n## This project\n\nmine\n';

test('the block goes right after kb’s, and the rest stays as it was', () => {
	const out = withBlock(KB, 'wf rules');
	expect(out).toBe('# P\n\n<!-- kb:global · generated by kb gen -->\nkb rules\n<!-- /kb:global -->\n\n' + `${OPENER}\nwf rules\n<!-- /wf:rules -->` + '\n\n## This project\n\nmine\n');
	// rewriting touches only the block
	expect(withBlock(out, 'new rules')).toBe(out.replace('wf rules', 'new rules'));
});

test('with no kb block, the block goes at the end', () => {
	expect(withBlock('# P\n\nmine\n', 'wf rules')).toBe(`# P\n\nmine\n\n${OPENER}\nwf rules\n<!-- /wf:rules -->\n`);
});

let done = () => {};
afterEach(() => done());

test('check finds a stale block and a missing link; gen writes the block', () => {
	const r = repo();
	done = r.done;
	const file = join(r.main, 'AGENTS.md');
	writeFileSync(file, KB);
	expect(rulesProblems(r.main, CONFIG, 'check').problems).toEqual([
		'CLAUDE.md is missing: ln -s AGENTS.md CLAUDE.md',
		'the wf block in AGENTS.md is missing: run `bun wf gen`'
	]);
	symlinkSync('AGENTS.md', join(r.main, 'CLAUDE.md'));
	expect(rulesProblems(r.main, CONFIG, 'gen')).toEqual({ problems: [], written: true });
	expect(readFileSync(file, 'utf8')).toContain('## This project\n\nmine');
	// the block reads the same with or without kb; the roles, by wf --skill, name kb's commands
	expect(readFileSync(file, 'utf8')).toContain('run `bun wf --skill`');
	expect(readFileSync(file, 'utf8')).not.toContain('kb decision new');
	expect(rulesProblems(r.main, CONFIG, 'check')).toEqual({ problems: [], written: false });
	writeFileSync(file, readFileSync(file, 'utf8').replace('on `dev`', 'on `main`'));
	expect(rulesProblems(r.main, CONFIG, 'check').problems).toEqual(['the wf block in AGENTS.md is stale: run `bun wf gen`']);
});

test('the header carries the place, the orchestrator, the URLs, the project lines, the agent\'s rules and the task', () => {
	const h = renderHeader({
		name: 'dash',
		path: '/w/worktree-dash',
		main: '/Dev/its',
		config: CONFIG,
		kb: true,
		urls: { APP_URL: 'http://localhost:5203' },
		task: '\nMake the dashboard.\n',
		orchestrator: { name: 'orch' } as Session
	});
	expect(h).toBe(
		'You are `dash`, in the worktree /w/worktree-dash on branch `worktree/dash`. The orchestrator is the Claude Code session `orch`, in /Dev/its.\n' +
			'- Look at it running: APP_URL http://localhost:5203\n' +
			'- Sign-in codes arrive at MAILPIT_URL.\n\n' +
			'Your rules, as `bun wf --skill` prints them in your worktree:\n\n' +
			`${agent(CONFIG, { kb: true })}\n\n` +
			'The task:\n\nMake the dashboard.'
	);
	// the agent's rules, never the orchestrator's
	expect(h).not.toContain('In the main checkout');
});

test('the header leaves out the URLs and the project lines when there are none', () => {
	const c = resolve({ integration: 'dev' });
	const h = renderHeader({ name: 'dash', path: '/w/worktree-dash', main: '/Dev/its', config: c, urls: {}, task: 'Make it.' });
	expect(h).toBe(`You are \`dash\`, in the worktree /w/worktree-dash on branch \`worktree/dash\`. The orchestrator is the session in /Dev/its.\n\nYour rules, as \`bun wf --skill\` prints them in your worktree:\n\n${agent(c)}\n\nThe task:\n\nMake it.`);
});
