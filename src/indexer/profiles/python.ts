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

const PY_REGEXES: RegExp[] = [
	/from\s+(?<spec>[\w.][\w.]*)\s+import\s+(?<names>[^\n]+)/g,
	/^\s*import\s+(?<spec>[\w.][\w.,\s]*)$/gm,
];

function resolvePy(ctx: ResolveContext): string | null {
	return resolvePythonImport(ctx.importerPath, ctx.specifier, ctx.knownPaths);
}

export const PYTHON_PROFILE: LanguageProfile = {
	id: 'python',
	extensions: ['py'],
	grammar: 'tree-sitter-python.wasm',
	hasSymbolExtraction: true,
	usesTsConfig: false,
	extractImports: (content: string) => runImportRegexes(content, PY_REGEXES),
	resolveImport: resolvePy,
	extractSymbols: extractPython,
};
