/**
 * Shared regex-runner for import extraction.
 *
 * This is the exact extraction loop originally in `importRegex.ts`. It is shared
 * by every profile whose import syntax is best described by a small set of
 * regular expressions. Behavior is preserved verbatim so the registry refactor
 * is a no-op behaviorally (regression-gate requirement).
 */
import type { ImportSpec } from '../extractor';
import { findImportSourceMasks, IMPORT_SOURCE_SYNTAX, maskComments } from './_sourceMask';

/** Parse a comma-separated binding list like "a, b as c, { d }" -> ["a","b","d"]. */
function parseNames(raw: string | undefined): string[] {
	if (!raw) return [];
	const names: string[] = [];
	for (let part of raw.split(',')) {
		part = part.trim();
		if (!part) continue;
		// strip "as alias"
		const asIdx = part.indexOf(' as ');
		if (asIdx >= 0) part = part.slice(0, asIdx).trim();
		// strip braces / parens
		part = part.replace(/[{}()]/g, '').trim();
		// take the last path segment for "a.b.c"
		const segs = part.split(/[./]/).filter(Boolean);
		if (segs.length > 0) {
			const last = segs[segs.length - 1];
			if (last) names.push(last);
		}
	}
	return names;
}

/** Run global regexes over content, collecting ImportSpecs with line numbers. */
export function runImportRegexes(
	content: string,
	regexes: readonly RegExp[],
	languageId: string,
): ImportSpec[] {
	const out: ImportSpec[] = [];
	const syntax = IMPORT_SOURCE_SYNTAX[languageId];
	if (!syntax) throw new Error(`Missing import source syntax for language: ${languageId}`);
	const masks = findImportSourceMasks(content, syntax);
	const commentMaskedSource = maskComments(content, masks.comments);
	for (const re of regexes) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(commentMaskedSource)) !== null) {
			if (masks.strings[m.index]) continue;
			const spec = (m.groups?.spec ?? m[1] ?? '').trim();
			if (!spec) {
				if (m.index === re.lastIndex) re.lastIndex++;
				continue;
			}
			const names = parseNames(m.groups?.names);
			const line = content.slice(0, m.index).split('\n').length;
			out.push({ specifier: spec, names, line });
			if (m.index === re.lastIndex) re.lastIndex++;
		}
	}
	return out;
}
