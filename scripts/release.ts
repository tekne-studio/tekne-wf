/**
 * Cuts a release: `bun run release`.
 *
 * It reads the commits since the last tag, works out the next version from
 * their types (see scripts/release-plan.ts), bumps package.json, turns the
 * CHANGELOG's `## Unreleased` into the new version's entry (with none, it
 * drafts one from the commits) and waits while you read it. Then it runs the
 * checks, commits `chore: release x.y.z`, tags `vx.y.z` and pushes the commit,
 * then the tag.
 *
 * It does not publish. The tag does: .github/workflows/release.yml builds
 * from a clean checkout of it and publishes to npm.tekne.studio, so what is on
 * the registry is exactly what the tag holds, never a working copy with
 * something uncommitted in it.
 *
 *   bun run release                 the version the commits call for
 *   bun run release minor           a bump of your choosing: major, minor, patch
 *   bun run release --dry-run       the plan and the draft, nothing written
 *   bun run release --entry FILE    an entry already distilled, in place of ## Unreleased, no pause
 *
 * It runs in the main checkout, on main and clean, and refuses anywhere else.
 * In the wf flow the main checkout is the orchestrator's: it stays on main and
 * `wf ship` keeps it clean, so a release there leaves every worktree alone,
 * and while the release waits on the draft, a ship refuses the changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
	DRAFT_MARKER,
	bumpFor,
	bumped,
	draftEntry,
	insertEntry,
	type Bump,
	type Commit
} from './release-plan';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(root, 'package.json');
const CHANGELOG = join(root, 'CHANGELOG.md');
const BRANCH = 'main';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const asked = args.find((a) => ['major', 'minor', 'patch'].includes(a)) as Bump | undefined;
const entryFile = args.includes('--entry') ? args[args.indexOf('--entry') + 1] : undefined;

function git(...command: string[]): string {
	const run = Bun.spawnSync(['git', ...command], { cwd: root });
	if (run.exitCode !== 0)
		throw new Error(`git ${command.join(' ')}: ${run.stderr.toString().trim()}`);
	return run.stdout.toString().trim();
}

function stop(message: string): never {
	console.error(`\n${message}\n`);
	process.exit(1);
}

// ── where we stand ───────────────────────────────────────────────────────
const problems: string[] = [];
const gitDir = git('rev-parse', '--path-format=absolute', '--git-dir');
if (gitDir !== git('rev-parse', '--path-format=absolute', '--git-common-dir')) {
	problems.push(`${root} is a worktree, not the main checkout: run the release in the main checkout`);
}
const branch = git('branch', '--show-current');
if (branch !== BRANCH) {
	problems.push(`${branch ? `on ${branch}` : 'on a detached HEAD'}, not on ${BRANCH}: git switch ${BRANCH}`);
}
const dirty = git('status', '--porcelain');
if (dirty) problems.push(`uncommitted changes:\n${dirty}`);
git('fetch', '--quiet', 'origin', BRANCH, '--tags');
if (git('rev-list', '--count', `HEAD..origin/${BRANCH}`) !== '0') {
	problems.push(`behind origin/${BRANCH}: pull first`);
}
if (problems.length && !dryRun) stop(`Not releasing:\n- ${problems.join('\n- ')}`);

const pkg = readFileSync(PACKAGE, 'utf8');
const current = JSON.parse(pkg).version as string;
const lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
if (lastTag !== `v${current}`) {
	problems.push(`the last tag is ${lastTag} but package.json says ${current}`);
	if (!dryRun) stop(`Not releasing:\n- ${problems.at(-1)}`);
}

const commits: Commit[] = git('log', `${lastTag}..HEAD`, '--format=%s%x1f%b%x1e')
	.split('\x1e')
	.map((raw) => raw.trim())
	.filter(Boolean)
	.map((raw) => {
		const [subject, body = ''] = raw.split('\x1f');
		return { subject, body };
	});

const bump = asked ?? bumpFor(commits, current);
if (!bump) {
	console.log(`\nNothing to release since ${lastTag}: no feat, fix or breaking change.\n`);
	process.exit(0);
}
const version = bumped(current, bump);
const changelog = readFileSync(CHANGELOG, 'utf8');
const entry = entryFile
	? readFileSync(entryFile, 'utf8').trim() + '\n'
	: draftEntry(version, commits, changelog);
if (entryFile && !entry.startsWith(`## ${version}\n`)) {
	stop(`${entryFile} must start with "## ${version}", the version the commits call for.`);
}

console.log(
	`\n${lastTag} → v${version} (${bump}${asked ? ', asked' : ''}), ${commits.length} commits\n`
);
console.log(entry);

if (dryRun) {
	if (problems.length) console.log(`A real run would stop here:\n- ${problems.join('\n- ')}\n`);
	process.exit(0);
}

// ── the bump and the draft ───────────────────────────────────────────────
const restore = () => {
	writeFileSync(PACKAGE, pkg);
	writeFileSync(CHANGELOG, changelog);
};
// the version line only: rewriting the whole JSON would reformat the file
writeFileSync(PACKAGE, pkg.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
writeFileSync(CHANGELOG, insertEntry(changelog, entry));

if (!entryFile) console.log('CHANGELOG.md has the draft. Distill it, save, and come back.');
while (!entryFile) {
	const answer = prompt('Enter to go on, "stop" to undo the bump and the draft:');
	if (answer?.trim().toLowerCase() === 'stop') {
		restore();
		stop('Stopped; package.json and CHANGELOG.md are back as they were.');
	}
	if (!readFileSync(CHANGELOG, 'utf8').includes(DRAFT_MARKER)) break;
	console.log('The draft marker is still in CHANGELOG.md: the entry has not been read yet.');
}

// ── checks, then commit, tag and push together ───────────────────────────
for (const script of ['check', 'kb check', 'test', 'wf check']) {
	const run = Bun.spawnSync(['bun', 'run', ...script.split(' ')], {
		cwd: root,
		stdout: 'inherit',
		stderr: 'inherit'
	});
	if (run.exitCode !== 0) stop(`bun run ${script} failed; fix it and run the release again.`);
}
if (git('status', '--porcelain', '--', '.', ':!package.json', ':!CHANGELOG.md')) {
	stop('The checks touched files other than package.json and CHANGELOG.md; commit them first.');
}

git('add', 'package.json', 'CHANGELOG.md');
git('commit', '--quiet', '-m', `chore: release ${version}`);
git('tag', '-a', `v${version}`, '-m', version);
/*
 * The commit first, then the tag in a push of its own. Sent together, the
 * tag arrived but GitHub raised no event for it (0.2.1), so the workflow that
 * publishes never ran. Should the second push fail, `git push origin vx.y.z`
 * finishes the release.
 */
git('push', 'origin', `HEAD:refs/heads/${BRANCH}`);
git('push', 'origin', `refs/tags/v${version}`);

console.log(
	`\nv${version} pushed. The tag publishes it: https://github.com/tekne-studio/tekne-wf/actions\n`
);
