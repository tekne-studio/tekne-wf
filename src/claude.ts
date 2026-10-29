// Claude Code's own records, read only: its answer to "do you trust this folder?" and its
// live sessions, whose names SendMessage addresses.
//
// Trust: Claude Code asks once per repository, and a worktree's trust is its main
// checkout's (code.claude.com/docs/en/permissions). wf only reads the answer; the answer
// is the person's.
//
// Sessions: each running session writes `sessions/<pid>.json` (name, sessionId, cwd), and
// its shell commands get `CLAUDE_PID`. So `wf spawn`, run by the orchestrator, learns the
// orchestrator's name, `wf watch` learns which session reads it, `wf report` tells the agent
// where to send its message, and `wf tell` finds an agent's session by the id herdr reports
// for it.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { alive } from './lock';

function claudeJson(): string {
	return process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
}

function sessionsDir(): string {
	return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'sessions');
}

/** true or false from Claude's own record; null when it cannot be read. */
export function claudeTrusts(main: string): boolean | null {
	const file = claudeJson();
	if (!existsSync(file)) return null;
	try {
		const projects = JSON.parse(readFileSync(file, 'utf8')).projects ?? {};
		return projects[realpathSync(main)]?.hasTrustDialogAccepted === true;
	} catch {
		return null;
	}
}

/** A running Claude Code session; `name` is what SendMessage addresses. */
export type Session = { name: string; sessionId: string; pid: number; cwd: string };

function read(file: string): Session | null {
	try {
		const s = JSON.parse(readFileSync(file, 'utf8'));
		if (typeof s.name !== 'string' || !s.name || typeof s.pid !== 'number' || !alive(s.pid)) return null;
		return { name: s.name, sessionId: String(s.sessionId ?? ''), pid: s.pid, cwd: String(s.cwd ?? '') };
	} catch {
		return null;
	}
}

/** The session this command runs under, when a Claude Code session ran it. */
export function currentSession(): Session | null {
	const pid = Number(process.env.CLAUDE_PID);
	return pid ? sessionAt(pid) : null;
}

/** The session the Claude Code process `pid` runs now: a `/clear` starts a new one in the same process, which keeps its background commands. */
export function sessionAt(pid: number): Session | null {
	return read(join(sessionsDir(), `${pid}.json`));
}

/** That session if it still runs, under its current name: by its pid, or by its id after a restart. */
export function liveSession(s: { sessionId: string; pid: number }): Session | null {
	const same = sessionAt(s.pid);
	if (same && same.sessionId === s.sessionId) return same;
	return sessionById(s.sessionId);
}

/** The Claude Code session herdr reports for an agent, when it runs. */
export function agentSession(agent: { agent_session?: { value?: string | null } | null } | null | undefined): Session | null {
	const id = agent?.agent_session?.value;
	return id ? sessionById(id) : null;
}

/** The running session with this id, under its current name. */
export function sessionById(sessionId: string): Session | null {
	if (!sessionId || !existsSync(sessionsDir())) return null;
	for (const f of readdirSync(sessionsDir())) {
		if (!f.endsWith('.json')) continue;
		const s = read(join(sessionsDir(), f));
		if (s?.sessionId === sessionId) return s;
	}
	return null;
}
