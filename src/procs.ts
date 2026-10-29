// The processes running inside a worktree, found by their working folder. A dev server an
// agent left behind outlives its parent (PPID 1) and keeps writing in the worktree, so
// removing the folder stops at "Directory not empty" and its ports stay taken: closing
// stops every such process first.
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { realpathOr } from './git';
import { alive } from './lock';

export type Proc = { pid: number; command: string };

function signal(pid: number, sig: NodeJS.Signals): void {
	try {
		process.kill(pid, sig);
	} catch {
		// gone meanwhile
	}
}

function out(cmd: string[]): string {
	const p = Bun.spawnSync(cmd, { cwd: '/', stdout: 'pipe', stderr: 'ignore', env: process.env });
	return p.stdout.toString();
}

/** The command line of a live process; empty when it is gone. */
export function commandOf(pid: number): string {
	return out(['ps', '-o', 'command=', '-p', String(pid)]).trim();
}

/** A process's parent and process group; null when it is gone or `ps` cannot tell. */
function parentage(pid: number): { ppid: number; pgid: number } | null {
	const [ppid, pgid] = out(['ps', '-o', 'ppid=,pgid=', '-p', String(pid)]).trim().split(/\s+/).map(Number);
	return ppid && pgid ? { ppid, pgid } : null;
}

/**
 * Nobody waits on the process: the leader of its process group (the shell that started it,
 * or the harness) is gone, or pid 1 adopted it or a process between it and that leader.
 * With `&`, `nohup` or `disown` in a harness's shell, the shell exits at once and pid 1
 * adopts what it started (`bun wf`, which runs the command); as the harness's own
 * background command, the shell waits for it. A walk that leaves the group short of its
 * leader (a pipeline in a terminal) tells nothing.
 */
export function orphaned(pid: number): boolean {
	const me = parentage(pid);
	if (!me) return false;
	if (me.pgid !== pid && !alive(me.pgid)) return true;
	for (let p = { pid, ...me }; ; ) {
		// the leader's own parent goes unjudged: pid 1 is the harness itself in a container
		if (p.ppid === me.pgid) return false;
		if (p.ppid === 1) return true;
		if (p.pid === me.pgid) return false;
		const up = parentage(p.ppid);
		if (!up || up.pgid !== me.pgid) return false;
		p = { pid: p.ppid, ...up };
	}
}

/** Every process whose working folder is `root` or inside it: /proc on Linux, lsof elsewhere. */
export function processesIn(root: string): Proc[] {
	const me = realpathOr(root);
	const inside = (cwd: string) => cwd === me || cwd.startsWith(`${me}/`);
	const found: Proc[] = [];
	if (existsSync('/proc/self/cwd')) {
		for (const entry of readdirSync('/proc')) {
			if (!/^\d+$/.test(entry)) continue;
			try {
				if (inside(readlinkSync(`/proc/${entry}/cwd`))) found.push({ pid: Number(entry), command: readFileSync(`/proc/${entry}/comm`, 'utf8').trim() });
			} catch {
				// another user's process, or gone meanwhile
			}
		}
		return found;
	}
	if (!Bun.which('lsof')) return found;
	// one record per process: p<pid>, c<command>, f<fd>, n<path>
	let pid = 0;
	let command = '';
	for (const line of out(['lsof', '-d', 'cwd', '-F', 'pcn', '+c', '0']).split('\n')) {
		if (line[0] === 'p') pid = Number(line.slice(1));
		else if (line[0] === 'c') command = line.slice(1);
		else if (line[0] === 'n' && pid && inside(line.slice(1))) found.push({ pid, command });
	}
	return found;
}

/** This process and its parents: `wf ship` run alone, in the worktree's own pane, must not stop itself. */
function lineage(): Set<number> {
	const parent = new Map<number, number>();
	for (const line of out(['ps', '-A', '-o', 'pid=,ppid=']).split('\n')) {
		const [pid, ppid] = line.trim().split(/\s+/).map(Number);
		if (pid) parent.set(pid, ppid);
	}
	const mine = new Set<number>();
	for (let pid: number | undefined = process.pid; pid && !mine.has(pid); pid = parent.get(pid)) mine.add(pid);
	return mine;
}

async function gone(pids: number[], ms: number): Promise<boolean> {
	for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(100)) if (!pids.some(alive)) return true;
	return !pids.some(alive);
}

/**
 * Stops every process running inside `root` but this one, its parents and `spare` (the
 * panes' shells, which herdr ends when it closes the workspace): SIGTERM, then SIGKILL
 * after five seconds. Looks again after each round, for a process that started meanwhile.
 */
export async function stopProcesses(root: string, spare: number[] = []): Promise<Proc[]> {
	const keep = new Set([...lineage(), ...spare]);
	const stopped: Proc[] = [];
	for (let round = 0; round < 3; round++) {
		const procs = processesIn(root).filter((p) => !keep.has(p.pid) && alive(p.pid));
		if (!procs.length) break;
		const pids = procs.map((p) => p.pid);
		for (const pid of pids) signal(pid, 'SIGTERM');
		if (!(await gone(pids, 5000))) {
			for (const pid of pids) signal(pid, 'SIGKILL');
			await gone(pids, 1000);
		}
		stopped.push(...procs);
	}
	return stopped;
}
