import { describe, expect, it } from 'vitest';
import { getProfile } from '../src/indexer/profiles';
import { resolveCInclude, resolveByUniqueNameSuffix } from '../src/indexer/resolver';
import type { ResolveContext } from '../src/indexer/profiles/types';

function ctx(partial: Partial<ResolveContext>): ResolveContext {
	return {
		importerPath: 'src/app/main.ext',
		specifier: 'beta',
		candidateExts: ['ts', 'js', 'py', 'css', 'c', 'h', 'cpp', 'go', 'rs', 'java', 'lua', 'php'],
		knownPaths: new Set<string>(),
		tsConfig: null,
		...partial,
	};
}

/**
 * GitHub issue #4 found that imports resolved against an invisible root
 * (Python `sys.path`) silently produced no edge. This file covers the same
 * failure pattern in every other language family, all fixed with the shared
 * unique-name index fallback (`resolveByUniqueNameSuffix`): relative probing
 * keeps priority, and anything ambiguous stays unresolved.
 */
describe('shared unique-name fallback (issue #4 pattern)', () => {
	it('prefers a direct suffix match over the bare final segment', () => {
		expect(
			resolveByUniqueNameSuffix('ui/button', ['ts'], new Set([
				'src/app/main.ts',
				'libs/shared/ui/button.ts',
				'libs/shared/button.ts',
			]), 'src/app/main.ts'),
		).toBe('libs/shared/ui/button.ts');
	});

	it('stays unresolved when two files match the same module name', () => {
		expect(
			resolveByUniqueNameSuffix('beta', ['ts'], new Set([
				'src/app/main.ts',
				'libs/a/beta.ts',
				'libs/b/beta.ts',
			]), 'src/app/main.ts'),
		).toBeNull();
	});

	it('stays unresolved when the module name matches with several extensions', () => {
		expect(
			resolveByUniqueNameSuffix('header', ['c', 'h'], new Set([
				'append/header.c',
				'append/header.h',
			]), 'src/app/main.c'),
		).toBeNull();
	});

	it('never resolves to the importing file itself', () => {
		expect(
			resolveByUniqueNameSuffix('main', ['ts'], new Set([
				'src/app/main.ts',
			]), 'src/app/main.ts'),
		).toBeNull();
	});
});

describe('JS/TS family: bare specifiers without tsconfig coverage', () => {
	const js = getProfile('javascript');
	const ts = getProfile('typescript');
	if (!js || !ts) throw new Error('JS/TS profiles are not registered');

	it('javascript: resolves a bare specifier against an unmodeled vendor root', () => {
		expect(js.resolveImport(ctx({
			importerPath: 'app/main.js',
			specifier: 'utils/format',
			knownPaths: new Set(['app/main.js', 'libs/src/utils/format.js']),
		}))).toBe('libs/src/utils/format.js');
	});

	it('javascript: keeps relative resolution priority over the fallback', () => {
		expect(js.resolveImport(ctx({
			importerPath: 'app/main.js',
			specifier: './beta',
			knownPaths: new Set(['app/main.js', 'app/beta.js', 'libs/beta.js']),
		}))).toBe('app/beta.js');
	});

	it('typescript: falls back when the tsconfig has no matching alias', () => {
		expect(ts.resolveImport(ctx({
			importerPath: 'src/app/main.ts',
			specifier: 'components/card',
			knownPaths: new Set(['src/app/main.ts', 'web/src/components/card.tsx']),
		}))).toBe('web/src/components/card.tsx');
	});
});

describe('C/C++ families: includes reachable only through other -I roots', () => {
	const c = getProfile('c');
	const cpp = getProfile('cpp');
	if (!c || !cpp) throw new Error('C profiles are not registered');

	it('c: resolves a header from a sibling include directory', () => {
		expect(c.resolveImport(ctx({
			importerPath: 'project/src/main.c',
			specifier: 'config.h',
			knownPaths: new Set(['project/src/main.c', 'project/include/config.h']),
		}))).toBe('project/include/config.h');
	});

	it('c: keeps importer-dir probing priority over the fallback', () => {
		expect(resolveCInclude(
			'project/src/main.c',
			'config.h',
			new Set(['project/src/main.c', 'project/src/config.h', 'elsewhere/config.h']),
			['c', 'h'],
		)).toBe('project/src/config.h');
	});

	it('cpp: resolves an ambiguous-less header inside a vendored dir', () => {
		expect(cpp.resolveImport(ctx({
			importerPath: 'project/src/main.cpp',
			specifier: 'util.hpp',
			knownPaths: new Set(['project/src/main.cpp', 'vendor/lib/util.hpp']),
		}))).toBe('vendor/lib/util.hpp');
	});
});

describe('imports-only families: module-path languages', () => {
	it('go: parses grouped import blocks and resolves by final segment', () => {
		const go = getProfile('go');
		if (!go) throw new Error('Go profile is not registered');

		const source = [
			'import (',
			'\t"fmt"',
			'',
			'\t"example.com/repo/internal/bank" // comment in block',
			')',
			'',
		].join('\n');
		expect(go.extractImports(source)).toEqual([
			{ specifier: 'fmt', names: [], line: 2 },
			{ specifier: 'example.com/repo/internal/bank', names: [], line: 4 },
		]);

		expect(go.resolveImport(ctx({
			importerPath: 'cmd/server/main.go',
			specifier: 'example.com/repo/internal/bank',
			knownPaths: new Set(['cmd/server/main.go', 'internal/pkg/bank/bank.go']),
		}))).toBe('internal/pkg/bank/bank.go');
	});

	it('go: resolves a module-path import by its final segment', () => {
		const go = getProfile('go');
		if (!go) throw new Error('Go profile is not registered');

		expect(go.resolveImport(ctx({
			importerPath: 'cmd/server/main.go',
			specifier: 'example.com/repo/internal/rounding/bank',
			knownPaths: new Set(['cmd/server/main.go', 'internal/pkg/bank/bank.go']),
		}))).toBe('internal/pkg/bank/bank.go');
	});

	it('rust: resolves crate paths by module file', () => {
		const rust = getProfile('rust');
		if (!rust) throw new Error('Rust profile is not registered');

		expect(rust.resolveImport(ctx({
			importerPath: 'src/main.rs',
			specifier: 'crate::routes::web',
			knownPaths: new Set(['src/main.rs', 'src/routes/web.rs']),
		}))).toBe('src/routes/web.rs');
	});

	it('java: resolves package imports by class file', () => {
		const java = getProfile('java');
		if (!java) throw new Error('Java profile is not registered');

		expect(java.resolveImport(ctx({
			importerPath: 'src/launcher.java',
			specifier: 'com.example.widgets.Spinner',
			knownPaths: new Set(['src/launcher.java', 'src/widgets/Spinner.java']),
		}))).toBe('src/widgets/Spinner.java');
	});

	it('java: resolves static-member imports by their class segment', () => {
		const java = getProfile('java');
		if (!java) throw new Error('Java profile is not registered');

		expect(java.resolveImport(ctx({
			importerPath: 'src/boot.java',
			specifier: 't5.java.utilx.T5Ids.next',
			knownPaths: new Set(['src/boot.java', 'src/utilx/T5Ids.java']),
		}))).toBe('src/utilx/T5Ids.java');
	});

	it('lua: resolves dotted requires against package.path roots', () => {
		const lua = getProfile('lua');
		if (!lua) throw new Error('Lua profile is not registered');

		expect(lua.resolveImport(ctx({
			importerPath: 'src/boot.lua',
			specifier: 'helpers.strings',
			knownPaths: new Set(['src/boot.lua', 'vendor/helpers/strings.lua']),
		}))).toBe('vendor/helpers/strings.lua');
	});

	it('php: resolves PSR-style use statements by class name', () => {
		const php = getProfile('php');
		if (!php) throw new Error('PHP profile is not registered');

		expect(php.resolveImport(ctx({
			importerPath: 'public/index.php',
			specifier: 'App\\Modules\\Billing\\Invoice',
			knownPaths: new Set(['public/index.php', 'src/Invoice.php']),
		}))).toBe('src/Invoice.php');
	});

	it('css: resolves non-relative imports outside the importer dir', () => {
		const css = getProfile('css');
		if (!css) throw new Error('CSS profile is not registered');

		expect(css.resolveImport(ctx({
			importerPath: 'styles/main.css',
			specifier: 'theme.css',
			knownPaths: new Set(['styles/main.css', 'styles/theme/theme.css']),
		}))).toBe('styles/theme/theme.css');
	});

	it('keeps ambiguous languages unresolved (php class name in two roots)', () => {
		const php = getProfile('php');
		if (!php) throw new Error('PHP profile is not registered');

		expect(php.resolveImport(ctx({
			importerPath: 'public/index.php',
			specifier: 'App\\Modules\\Billing\\Invoice',
			knownPaths: new Set(['public/index.php', 'src/Invoice.php', 'legacy/Invoice.php']),
		}))).toBeNull();
	});
});

describe('python: plain import statements with aliases and comma lists', () => {
	const python = getProfile('python');
	if (!python) throw new Error('Python profile is not registered');

	it('parses the module out of an aliased import', () => {
		expect(python.extractImports('import numpy as np\nfrom alpha import one').sort((a, b) => a.line - b.line)).toEqual([
			{ specifier: 'numpy', names: ['np'], line: 1 },
			{ specifier: 'alpha', names: ['one'], line: 2 },
		]);
	});

	it('splits comma-separated import lists into multiple specifiers', () => {
		expect(python.extractImports('import os, sys')).toEqual([
			{ specifier: 'os', names: [], line: 1 },
			{ specifier: 'sys', names: [], line: 1 },
		]);
	});

	it('resolves an aliased sibling module that previously produced no edge', () => {
		expect(python.resolveImport(ctx({
			importerPath: 'Code Graph Test/Alpha/alpha.py',
			specifier: 'beta',
			knownPaths: new Set(['Code Graph Test/Alpha/alpha.py', 'Code Graph Test/Beta/beta.py']),
		}))).toBe('Code Graph Test/Beta/beta.py');
		expect(python.extractImports('import beta as b')).toEqual([
			{ specifier: 'beta', names: ['b'], line: 1 },
		]);
	});
});
