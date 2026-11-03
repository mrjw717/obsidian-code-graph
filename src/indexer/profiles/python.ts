/**
 * Python profile.
 *
 * Python import syntax (`from X import Y`, `import a.b`) is distinct from JS,
 * resolution walks dotted module names to filesystem paths, and the tree-sitter
 * extractor produces a different AST node shape (`call`, `class_definition`,
 * `function_definition`).
 */
import type { LanguageProfile, ResolveContext } from './types';
import { extractPython } from '../languages/python';
import { resolvePythonImport } from '../resolver';
import { runImportRegexes } from './_regexRunner';
import type { ImportSpec } from '../extractor';

const PY_REGEXES: RegExp[] = [
	/from\s+(?<spec>[\w.][\w.]*)\s+import\s+(?<names>[^\n]+)/g,
	// NOTE: same-line whitespace only (\t ) — `\s` would match across newlines,
	// merging the following line's `from`-import into this specifier.
	/^\s*import\s+(?<spec>[\w.][\w.,\t ]*)$/gm,
];

/**
 * Plain `import` statements may contain comma lists and aliases in the
 * captured specifier (`import os, sys`, `import numpy as np`). The regex
 * swallows them whole, which made every aliased/comma import unresolvable —
 * including for modules sitting right next to the importer. Split each one
 * into a single module specifier (with `as` aliases folded into `names`,
 * mirroring the from-import binding list behavior).
 */
function extractPyImports(content: string): ImportSpec[] {
	const specs = runImportRegexes(content, PY_REGEXES, 'python');
	const out: ImportSpec[] = [];
	for (const { specifier, names, line } of specs) {
		if (!/[\s,]/.test(specifier)) {
			out.push({ specifier, names, line });
			continue;
		}
		for (const part of specifier.split(',')) {
			const alias = part.match(/\s+as\s+([\w.]+)\s*$/);
			const module = part.replace(/\s+as\s+[\w.]+\s*$/, '').trim();
			if (!module) continue;
			out.push({ specifier: module, names: alias?.[1] ? [alias[1]] : names, line });
		}
	}
	return out;
}

function resolvePy(ctx: ResolveContext): string | null {
	return resolvePythonImport(ctx.importerPath, ctx.specifier, ctx.knownPaths);
}

export const PYTHON_PROFILE: LanguageProfile = {
	id: 'python',
	extensions: ['py'],
	grammar: 'tree-sitter-python.wasm',
	hasSymbolExtraction: true,
	usesTsConfig: false,
	extractImports: extractPyImports,
	resolveImport: resolvePy,
	extractSymbols: extractPython,
};
