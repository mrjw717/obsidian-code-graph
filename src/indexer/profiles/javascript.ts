/**
 * JavaScript / TypeScript family profiles (ts, tsx, js/jsx/mjs/cjs).
 *
 * All three share the same import syntax, the same relative-specifier + tsconfig
 * resolution strategy, and the same tree-sitter symbol extractor (the TS grammar
 * handles plain JS too). They differ only in their grammar wasm and extensions.
 */
import type { LanguageProfile, ResolveContext } from './types';
import { extractTypeScript } from '../languages/typescript';
import { resolveAliased } from '../tsconfig';
import { resolveJsImport } from '../resolver';
import { runImportRegexes } from './_regexRunner';

// JS/TS family shares import syntax. Order matters: the plain `import … from`
// form is tried first; `export … from` and dynamic `import(…)` after. `require(…)`
// is kept for CommonJS.
//
// Whitespace note: use `\s+from\s+` (NOT `\s+ from\s+`). A literal space between
// `\s+` and `from` would require TWO whitespace chars before "from", silently
// breaking on the standard single-space `} from "..."` form. This bug existed
// in the original importRegex.ts and is the reason `import { X } from "..."`
// produced zero edges.
const JS_REGEXES: RegExp[] = [
	/import\s+(?:[^;]*?\s+from\s+)?['"](?<spec>[^'"]+)['"]/g,
	// Re-exports: `export {…} from`, `export * from`, `export type {…} from`.
	// Require `{…}` or `*` so we never match `export const x = "… from …"`.
	/export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"](?<spec>[^'"]+)['"]/g,
	/require\s*\(\s*['"](?<spec>[^'"]+)['"]\s*\)/g,
	/import\s*\(\s*['"](?<spec>[^'"]+)['"]\s*\)/g,
];

function isRelativeSpecifier(spec: string): boolean {
	return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';
}

/**
 * JS/TS resolution: try relative-path resolution first (resolveJsImport), then
 * fall back to tsconfig path-alias resolution (resolveAliased). The tsconfig is
 * passed in via the context — the indexer fetches it once per file.
 */
function resolveJsFamily(ctx: ResolveContext): string | null {
	const relative = isRelativeSpecifier(ctx.specifier)
		? resolveJsImport(
				ctx.importerPath,
				ctx.specifier,
				ctx.candidateExts,
				ctx.knownPaths,
		  )
		: null;
	if (relative) return relative;
	return resolveAliased(
		ctx.specifier,
		ctx.tsConfig,
		ctx.candidateExts,
		ctx.knownPaths,
	);
}

/** Common behavior shared by all JS-family profiles. */
const JS_FAMILY = {
	hasSymbolExtraction: true,
	usesTsConfig: true,
	extractImports: (content: string) => runImportRegexes(content, JS_REGEXES),
	resolveImport: resolveJsFamily,
	extractSymbols: extractTypeScript,
} satisfies Omit<LanguageProfile, 'id' | 'extensions' | 'grammar'>;

export const TYPESCRIPT_PROFILE: LanguageProfile = {
	id: 'typescript',
	extensions: ['ts'],
	grammar: 'tree-sitter-typescript.wasm',
	...JS_FAMILY,
};

export const TSX_PROFILE: LanguageProfile = {
	id: 'tsx',
	extensions: ['tsx'],
	grammar: 'tree-sitter-tsx.wasm',
	...JS_FAMILY,
};

export const JAVASCRIPT_PROFILE: LanguageProfile = {
	id: 'javascript',
	extensions: ['js', 'jsx', 'mjs', 'cjs'],
	grammar: 'tree-sitter-javascript.wasm',
	...JS_FAMILY,
};
