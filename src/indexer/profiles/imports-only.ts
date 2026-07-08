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
import { resolveCInclude, resolveJsImport } from '../resolver';
import { runImportRegexes } from './_regexRunner';

function resolveAsRelative(ctx: ResolveContext): string | null {
	return resolveJsImport(
		ctx.importerPath,
		ctx.specifier,
		ctx.candidateExts,
		ctx.knownPaths,
	);
}

function resolveAsCInclude(ctx: ResolveContext): string | null {
	return resolveCInclude(ctx.importerPath, ctx.specifier, ctx.knownPaths);
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
	extractImports: (content: string) => runImportRegexes(content, CSS_REGEXES),
	resolveImport: resolveAsRelative,
};

export const C_PROFILE: LanguageProfile = {
	id: 'c',
	extensions: ['c', 'h'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, C_REGEXES),
	resolveImport: resolveAsCInclude,
};

export const CPP_PROFILE: LanguageProfile = {
	id: 'cpp',
	extensions: ['cpp', 'cc', 'cxx', 'hpp'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, CPP_REGEXES),
	resolveImport: resolveAsCInclude,
};

export const GO_PROFILE: LanguageProfile = {
	id: 'go',
	extensions: ['go'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, GO_REGEXES),
	resolveImport: resolveAsRelative,
};

export const RUST_PROFILE: LanguageProfile = {
	id: 'rust',
	extensions: ['rs'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, RUST_REGEXES),
	resolveImport: resolveAsRelative,
};

export const JAVA_PROFILE: LanguageProfile = {
	id: 'java',
	extensions: ['java'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, JAVA_REGEXES),
	resolveImport: resolveAsRelative,
};

export const LUA_PROFILE: LanguageProfile = {
	id: 'lua',
	extensions: ['lua'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, LUA_REGEXES),
	resolveImport: resolveAsRelative,
};

export const PHP_PROFILE: LanguageProfile = {
	id: 'php',
	extensions: ['php'],
	...IMPORTS_ONLY,
	extractImports: (content: string) => runImportRegexes(content, PHP_REGEXES),
	resolveImport: resolveAsRelative,
};
