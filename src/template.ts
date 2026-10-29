// The texts agents read live as files in templates/, with {{placeholders}}; a
// placeholder with no value is an error, so a template and its code never drift.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../templates/', import.meta.url));

export type Template = 'rules' | 'agent' | 'orchestrator' | 'header';

export function template(name: Template): string {
	return readFileSync(`${DIR}${name}.md`, 'utf8');
}

export function fill(text: string, values: Record<string, string>): string {
	return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
		if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
		return values[key];
	});
}

/** `a`, `b` and `c` as inline code, or `none` when the list is empty. */
export function codeList(items: string[], none = 'none configured'): string {
	return items.length ? items.map((i) => `\`${i}\``).join(', ') : none;
}
