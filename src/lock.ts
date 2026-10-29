// Locks between processes, as files that name their holder: one per repository (in the
// git common dir, which every worktree sees) and the expensive gates' places, shared by
// every repository on the machine, since their worktrees share one CPU. A dead holder's
// file (Ctrl+C halfway) is discarded.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** The process exists (EPERM: it does, under another user). */
export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Takes `file` when it is free or its holder is dead; returns the release, or null when taken. */
function take(file: string, label: string): (() => void) | null {
	mkdirSync(dirname(file), { recursive: true });
	const release = () => {
		process.off('exit', release);
		// only our own: releasing after another process took it must not delete theirs
		try {
			if (holder(file).pid === process.pid) rmSync(file, { force: true });
		} catch {
			/* already released */
		}
	};
	for (;;) {
		try {
			writeFileSync(file, `${process.pid} ${label}`, { flag: 'wx' });
			process.on('exit', release);
			return release;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
			const { pid } = holder(file);
			if (pid && alive(pid)) return null;
			rmSync(file, { force: true });
		}
	}
}

function holder(file: string): { pid: number; label: string } {
	try {
		const [pid, ...label] = readFileSync(file, 'utf8').split(' ');
		return { pid: Number(pid), label: label.join(' ') };
	} catch {
		return { pid: 0, label: '' };
	}
}

/**
 * One process at a time in the whole repository: `<common dir>/wf/<name>.lock`. Waits
 * for whoever holds it. Returns the release; the process's exit releases it too.
 */
export async function lock(commonDir: string, name: string, label: string): Promise<() => void> {
	const file = join(commonDir, 'wf', `${name}.lock`);
	for (let waiting = false; ; waiting = true) {
		const release = take(file, label);
		if (release) return release;
		if (!waiting) console.log(`… ${label} in progress (pid ${holder(file).pid || '?'}); waiting`);
		await Bun.sleep(300);
	}
}

/** Where the machine's own locks live: `WF_STATE_DIR`, or ~/.local/state/wf. */
export function machineDir(): string {
	return process.env.WF_STATE_DIR || join(homedir(), '.local', 'state', 'wf');
}

/** How many expensive gates run at once on this machine: `WF_GATE_SLOTS`, or a quarter of its cores. */
export function gateSlots(): number {
	const n = Number(process.env.WF_GATE_SLOTS);
	return Number.isInteger(n) && n > 0 ? n : Math.max(1, Math.floor(availableParallelism() / 4));
}

/**
 * One of `slots` places every process on the machine shares: `<dir>/<name>-<i>.lock`.
 * Waits while all are taken, saying who holds them. Returns the release.
 */
export async function slot(dir: string, name: string, slots: number, label: string): Promise<() => void> {
	const files = Array.from({ length: slots }, (_, i) => join(dir, `${name}-${i}.lock`));
	for (let waiting = false; ; waiting = true) {
		for (const file of files) {
			const release = take(file, label);
			if (release) return release;
		}
		if (!waiting) console.log(`… every ${name} place on this machine is taken (${files.map((f) => holder(f).label || '?').join('; ')}); waiting`);
		await Bun.sleep(500);
	}
}
