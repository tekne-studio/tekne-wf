// Kimi Code's own records, read only: its answer to "Trust this folder?".
//
// Kimi asks for every folder it never saw, a subfolder or a worktree of a trusted one too,
// and records each answer as `workspace-trust/<file>`, `{"root": <the folder>, "trustedAt"}`
// (checked with Kimi 2.4.1 on 2026-11-02). wf only reads the answer; the answer is the person's.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function kimiHome(): string {
	return process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');
}

/** true when Kimi recorded the folder as trusted; null when its records cannot be read. */
export function kimiTrusts(folder: string): boolean | null {
	const dir = join(kimiHome(), 'workspace-trust');
	if (!existsSync(dir)) return false;
	try {
		const roots = new Set([folder, realpathSync(folder)]);
		return readdirSync(dir).some((f) => {
			try {
				return roots.has(JSON.parse(readFileSync(join(dir, f), 'utf8')).root);
			} catch {
				return false;
			}
		});
	} catch {
		return null;
	}
}
