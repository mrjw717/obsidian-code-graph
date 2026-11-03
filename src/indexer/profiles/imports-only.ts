/**
 * Imports-only profiles: languages for which we extract `imports` edges via
 * regex but do NOT yet extract `calls` / `inherits` (no tree-sitter symbol
 * extractor wired). Resolution follows the original indexer fallbacks:
 *   - C / C++: `resolveCInclude` (relative then vault-root)
 *   - everything else: `resolveJsImport` (only resolves `./` / `../` specifiers)
 *
 * Adding a tree-sitter symbol extractor for any of these is a localized change:
 * set `hasSymbolExtraction: true`, provide an `extractSymbols` function, and the
 * indexer will start parsing. See `languages/typescript.ts` for the pattern.
 */
import type { LanguageProfile, ResolveContext } from './types';
import type { ImportSpec } from '../extractor';
import { resolveCInclude, resolveJsImport, resolveByUniqueNameSuffix } from '../resolver';
import { runImportRegexes } from './_regexRunner';

function resolveAsRelative(ctx: ResolveContext): string | null {
	return resolveJsImport(
		ctx.importerPath,
		ctx.specifier,
		ctx.candidateExts,
		ctx.knownPaths,
	);
}

function resolveAsCIncludeFor(exts: string[]) {
	return (ctx: ResolveContext): string | null =>
		resolveCInclude(ctx.importerPath, ctx.specifier, ctx.knownPaths, exts);
}

const GO_EXTS = ['go'];
const RUST_EXTS = ['rs'];
const JAVA_EXTS = ['java'];
const LUA_EXTS = ['lua'];
const PHP_EXTS = ['php'];
const CSS_EXTS = ['css'];

/**
 * These languages express imports as module paths whose actual roots
 * (Go modules, crate roots, Java classpath, Lua package.path, PHP include
 * path, CSS web roots) are invisible to static analysis. Directory probing
 * fails for everything outside the importer's folder, so fall back to a
 * unique-name match against the file index.
 */
function resolveAsModulePathFor(exts: string[], separator: RegExp | null = null) {
	return (ctx: ResolveContext): string | null => {
		const base = resolveAsRelative(ctx);
		if (base) return base;
		return resolveByUniqueNameSuffix(
			separator ? ctx.specifier.replace(separator, '/') : ctx.specifier,
			exts,
			ctx.knownPaths,
			ctx.importerPath,
		);
	};
}

/**
 * Java: directory probing cannot see classpath roots, so fall back to the
 * index. `import static pkg.Class.member` ends with the MEMBER name — the
 * class name is the second-to-last dotted segment, so when the last segment
 * is member-like (lowercase-initial after an uppercase-initial class), try
 * the class segment before the bare member name.
 */
function resolveJavaModulePath(ctx: ResolveContext): string | null {
	const base = resolveAsRelative(ctx);
	if (base) return base;
	const parts = ctx.specifier.split('.');
	const extraSuffixes: string[] = [];
	const isMember = parts.length >= 2 && /^[a-z]/.test(parts[parts.length - 1] ?? '') && /^[A-Z]/.test(parts[parts.length - 2] ?? '');
	if (isMember) extraSuffixes.push(parts[parts.length - 2] ?? '');
	return resolveByUniqueNameSuffix(ctx.specifier.replace(/\./g, '/'), JAVA_EXTS, ctx.knownPaths, ctx.importerPath, extraSuffixes);
}

const CSS_REGEXES: RegExp[] = [
	/@import\s+(?:url\s*\(\s*)?['"](?<spec>[^'"]+)['"]/g,
];

const C_REGEXES: RegExp[] = [
	/#include\s+"(?<spec>[^"]+)"/g,
	/#include\s+<(?<spec>[^>]+)>/g,
];

const CPP_REGEXES: RegExp[] = [
	/#include\s+"(?<spec>[^"]+)"/g,
	/#include\s+<(?<spec>[^>]+)>/g,
];

const GO_REGEXES: RegExp[] = [
	/import\s+"(?<spec>[^"]+)"/g,
	/import\s+\w+\s+"(?<spec>[^"]+)"/g,
];

/** Go: extract both inline and grouped (parenthesized) import declarations. */
function extractGoImports(content: string): ImportSpec[] {
	const specs = runImportRegexes(content, GO_REGEXES, 'go');
	const out = [...specs];
	const blockRe = /import\s*\(([^)]*)\)/g;
	let m: RegExpExecArray | null;
	while ((m = blockRe.exec(content)) !== null) {
		// Per-entry lines: matchAll offsets are relative to the block body, so
		// re-anchor them into the full document.
		const blockStart = m.index + m[0].indexOf(m[1] ?? '');
		for (const quote of m[1]?.matchAll(/"([^"]+)"/g) ?? []) {
			if (!quote[1]) continue;
			const line = content.slice(0, blockStart + (quote.index ?? 0)).split('\n').length;
			out.push({ specifier: quote[1], names: [], line });
		}
	}
	return out;
}

const RUST_REGEXES: RegExp[] = [
	/use\s+(?<spec>[\w:]+(?:::\{[^}]*\})?)\s*;/g,
	/extern\s+crate\s+(?<spec>\w+)/g,
];

const JAVA_REGEXES: RegExp[] = [
	/import\s+(?:static\s+)?(?<spec>[\w.]+)\s*;/g,
];

const LUA_REGEXES: RegExp[] = [
	/require\s*["(']+(?<spec>[\w./-]+)["')\s]*/g,
];

const PHP_REGEXES: RegExp[] = [
	/use\s+(?<spec>[\w\\]+)\s*;/g,
	/(?:require|include)(?:_once)?\s*['"](?<spec>[^'"]+)['"]/g,
];

/** Shared shape for every imports-only profile. */
const IMPORTS_ONLY = {
	hasSymbolExtraction: false,
	usesTsConfig: false,
} as const;

export const CSS_PROFILE: LanguageProfile = {
	id: 'css',
	extensions: ['css'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, CSS_REGEXES, 'css'),
	resolveImport: resolveAsModulePathFor(CSS_EXTS),
};

export const C_PROFILE: LanguageProfile = {
	id: 'c',
	extensions: ['c', 'h'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, C_REGEXES, 'c'),
	resolveImport: resolveAsCIncludeFor(['c', 'h']),
};

export const CPP_PROFILE: LanguageProfile = {
	id: 'cpp',
	extensions: ['cpp', 'cc', 'cxx', 'hpp'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, CPP_REGEXES, 'cpp'),
	resolveImport: resolveAsCIncludeFor(['cpp', 'cc', 'cxx', 'hpp', 'c', 'h']),
};

export const GO_PROFILE: LanguageProfile = {
	id: 'go',
	extensions: ['go'],
	...IMPORTS_ONLY,
	extractImports: extractGoImports,
	resolveImport: resolveAsModulePathFor(GO_EXTS),
};

export const RUST_PROFILE: LanguageProfile = {
	id: 'rust',
	extensions: ['rs'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, RUST_REGEXES, 'rust'),
	resolveImport: resolveAsModulePathFor(RUST_EXTS, /::/g),
};

export const JAVA_PROFILE: LanguageProfile = {
	id: 'java',
	extensions: ['java'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, JAVA_REGEXES, 'java'),
	resolveImport: resolveJavaModulePath,
};

export const LUA_PROFILE: LanguageProfile = {
	id: 'lua',
	extensions: ['lua'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, LUA_REGEXES, 'lua'),
	resolveImport: resolveAsModulePathFor(LUA_EXTS, /\./g),
};

export const PHP_PROFILE: LanguageProfile = {
	id: 'php',
	extensions: ['php'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, PHP_REGEXES, 'php'),
	resolveImport: resolveAsModulePathFor(PHP_EXTS, /[\\]/g),
};
