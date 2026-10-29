/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { bumpFor, bumped, draftEntry, insertEntry, parse } from '../scripts/release-plan';

const c = (subject: string, body = '') => ({ subject, body });

describe('parse', () => {
	test('a conventional subject, with or without a scope', () => {
		expect(parse(c('fix: keep the icon'))).toEqual({
			type: 'fix',
			breaking: false,
			description: 'keep the icon'
		});
		expect(parse(c('feat(menu): add a text trigger')).type).toBe('feat');
	});

	test('breaking by the bang or by the footer', () => {
		expect(parse(c('feat!: drop the old theme')).breaking).toBe(true);
		expect(parse(c('feat: drop it', 'why\n\nBREAKING CHANGE: the theme is gone')).breaking).toBe(
			true
		);
	});
});

describe('bumpFor', () => {
	test('fix is a patch, feat a minor', () => {
		expect(bumpFor([c('fix: a'), c('chore: b')], '0.2.0')).toBe('patch');
		expect(bumpFor([c('fix: a'), c('feat: b')], '0.2.0')).toBe('minor');
	});

	test('breaking is a major, but a minor below 1.0', () => {
		expect(bumpFor([c('feat!: a')], '1.4.2')).toBe('major');
		expect(bumpFor([c('feat!: a')], '0.2.0')).toBe('minor');
	});

	test('nothing a consumer installs, no release', () => {
		expect(bumpFor([c('chore: a'), c('docs: b'), c('refactor: c')], '0.2.0')).toBeNull();
		expect(bumpFor([], '0.2.0')).toBeNull();
	});
});

describe('bumped', () => {
	test('each part, resetting the ones below it', () => {
		expect(bumped('0.2.0', 'patch')).toBe('0.2.1');
		expect(bumped('0.2.3', 'minor')).toBe('0.3.0');
		expect(bumped('1.2.3', 'major')).toBe('2.0.0');
	});
});

describe('draftEntry and insertEntry', () => {
	const commits = [c('fix: let the header wrap'), c('feat: add Stepper'), c('chore: tidy')];
	const log = '# Changelog\n\nPreamble.\n\n## 0.2.0\n\nOld.\n';

	test('grouped like the changelog, with the marker that asks for a read', () => {
		const entry = draftEntry('0.3.0', commits, log);
		expect(entry).toStartWith('## 0.3.0\n\n<!-- release draft:');
		expect(entry).toContain('### Added\n\n- Add Stepper.');
		expect(entry).toContain('### Fixed\n\n- Let the header wrap.');
		expect(entry).not.toContain('tidy');
	});

	test('the entry goes above the newest release, under the preamble', () => {
		expect(insertEntry(log, '## 0.3.0\n\nNew.\n')).toBe(
			'# Changelog\n\nPreamble.\n\n## 0.3.0\n\nNew.\n\n## 0.2.0\n\nOld.\n'
		);
	});

	test('## Unreleased becomes the new version, its entries in place of the commits\'', () => {
		const unreleased =
			'# Changelog\n\nPreamble.\n\n## Unreleased\n\n### Fixed\n\n- Written as it went.\n\n## 0.2.0\n\nOld.\n';
		expect(insertEntry(unreleased, draftEntry('0.3.0', commits, unreleased))).toBe(
			'# Changelog\n\nPreamble.\n\n## 0.3.0\n\n' +
				'<!-- release draft: say in a sentence what this release is, read the lines below, then delete this comment -->\n\n' +
				'### Fixed\n\n- Written as it went.\n\n## 0.2.0\n\nOld.\n'
		);
	});

	test('an entry from a file takes the place of ## Unreleased, in a first release too', () => {
		expect(insertEntry('# Changelog\n\n## Unreleased\n\n- Drafted.\n', '## 0.1.0\n\n- Distilled.\n')).toBe(
			'# Changelog\n\n## 0.1.0\n\n- Distilled.\n'
		);
	});

	test('an empty ## Unreleased gives way to the commits\' entry', () => {
		const empty = '# Changelog\n\n## Unreleased\n\n## 0.2.0\n\nOld.\n';
		const entry = draftEntry('0.3.0', commits, empty);
		expect(entry).toContain('### Added\n\n- Add Stepper.');
		expect(insertEntry(empty, entry)).toBe(`# Changelog\n\n${entry}\n## 0.2.0\n\nOld.\n`);
	});
});
