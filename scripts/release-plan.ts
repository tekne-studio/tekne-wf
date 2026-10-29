/**
 * The pure half of `bun run release`: which version the commits call for, and
 * the CHANGELOG entry they draft. No git, no files, so it is tested
 * (tests/release-plan.test.ts); scripts/release.ts does the rest.
 */

export type Commit = { subject: string; body: string };
export type Bump = 'major' | 'minor' | 'patch';

type Parsed = { type: string; breaking: boolean; description: string };

const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/;

/** A Conventional Commit's parts; a subject that is not one parses as type `other`. */
export function parse(commit: Commit): Parsed {
	const m = CONVENTIONAL.exec(commit.subject.trim());
	const breaking = /^BREAKING[ -]CHANGE:/m.test(commit.body);
	if (!m) return { type: 'other', breaking, description: commit.subject.trim() };
	return { type: m[1], breaking: breaking || m[3] === '!', description: m[4] };
}

/**
 * The bump the commits call for, following AGENTS.md: `feat` is a minor,
 * `fix` a patch, a breaking change a major. Anything else (chore, docs,
 * refactor, test) changes nothing a consumer installs, so alone it is no
 * release at all.
 *
 * Below 1.0 a breaking change bumps the minor, as 0.2.0 did: the major stays
 * at 0 until the library promises a stable surface.
 */
export function bumpFor(commits: readonly Commit[], current: string): Bump | null {
	const parsed = commits.map(parse);
	if (parsed.some((c) => c.breaking)) return major(current) === 0 ? 'minor' : 'major';
	if (parsed.some((c) => c.type === 'feat')) return 'minor';
	if (parsed.some((c) => c.type === 'fix')) return 'patch';
	return null;
}

const major = (version: string) => Number(version.split('.')[0]);

export function bumped(version: string, bump: Bump): string {
	const [a, b, c] = version.split('.').map(Number);
	if ([a, b, c].some((n) => !Number.isInteger(n))) throw new Error(`not a version: ${version}`);
	if (bump === 'major') return `${a + 1}.0.0`;
	if (bump === 'minor') return `${a}.${b + 1}.0`;
	return `${a}.${b}.${c + 1}`;
}

/** Marks a draft that nobody has read yet; the release refuses to go on while it is there. */
export const DRAFT_MARKER = '<!-- release draft:';

/**
 * The changelog's `## Unreleased` section: where it starts and ends, and its
 * entries, trimmed. Null when there is none.
 */
function unreleased(changelog: string): { start: number; end: number; entries: string } | null {
	const m = /^## Unreleased[ \t]*(\n|$)/m.exec(changelog);
	if (!m) return null;
	const from = m.index + m[0].length;
	const next = changelog.slice(from).search(/^## /m);
	const end = next < 0 ? changelog.length : from + next;
	return { start: m.index, end, entries: changelog.slice(from, end).trim() };
}

/**
 * The new version's entry: the entries the agents wrote under `## Unreleased`,
 * or, when there are none, the ones the commits suggest, grouped the way
 * CHANGELOG.md groups them. A starting point, never the entry: the marker asks
 * for a sentence on what the release is and for the lines to be read (distilled,
 * when they come from the commits), and the release waits until it is gone.
 */
export function draftEntry(version: string, commits: readonly Commit[], changelog: string): string {
	const written = unreleased(changelog)?.entries;
	const parsed = commits.map(parse);
	const line = (c: Parsed) => `- ${c.description[0].toUpperCase()}${c.description.slice(1)}.`;
	const section = (title: string, items: Parsed[]) =>
		items.length ? `### ${title}\n\n${items.map(line).join('\n')}\n\n` : '';
	const suggested = () =>
		section(
			'Breaking',
			parsed.filter((c) => c.breaking)
		) +
		section(
			'Added',
			parsed.filter((c) => !c.breaking && c.type === 'feat')
		) +
		section(
			'Fixed',
			parsed.filter((c) => !c.breaking && c.type === 'fix')
		);

	return (
		(
			`## ${version}\n\n` +
			`${DRAFT_MARKER} say in a sentence what this release is, ${written ? 'read' : 'distill'} the lines below, then delete this comment -->\n\n` +
			(written || suggested())
		).trimEnd() + '\n'
	);
}

/**
 * The changelog with `entry` in place of `## Unreleased`, or, with none, above
 * the newest release, under the file's preamble.
 */
export function insertEntry(changelog: string, entry: string): string {
	const u = unreleased(changelog);
	const rest = u ? changelog.slice(0, u.start) + changelog.slice(u.end) : changelog;
	const at = rest.search(/^## /m);
	if (at < 0) return `${rest.trimEnd()}\n\n${entry}`;
	return `${rest.slice(0, at)}${entry}\n${rest.slice(at)}`;
}
