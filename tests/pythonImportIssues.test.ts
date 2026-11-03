import { describe, expect, it } from 'vitest';
import { getProfile } from '../src/indexer/profiles';

const python = getProfile('python');
if (!python) throw new Error('Python profile is not registered');

describe('GitHub Python import issue reproductions', () => {
	it('issue #2: resolves a sibling module inside a subfolder', () => {
		const resolved = python.resolveImport({
			importerPath: 'Test 2/alpha.py',
			specifier: 'beta',
			candidateExts: ['py'],
			knownPaths: new Set(['Test 2/alpha.py', 'Test 2/beta.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('Test 2/beta.py');
	});

	it('issue #3: ignores a commented-out from-import statement', () => {
		const imports = python.extractImports('#from beta import hello\n');

		expect(imports).toEqual([]);
	});

	it('issue #2: prefers a sibling module over a same-named vault-root module', () => {
		const resolved = python.resolveImport({
			importerPath: 'Test 2/alpha.py',
			specifier: 'beta',
			candidateExts: ['py'],
			knownPaths: new Set(['Test 2/beta.py', 'beta.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('Test 2/beta.py');
	});

	it('issue #2: falls back to a vault-root module when no sibling exists', () => {
		const resolved = python.resolveImport({
			importerPath: 'Test 2/alpha.py',
			specifier: 'beta',
			candidateExts: ['py'],
			knownPaths: new Set(['beta.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('beta.py');
	});

	it('issue #2: resolves dotted sibling packages', () => {
		const resolved = python.resolveImport({
			importerPath: 'Test 2/alpha.py',
			specifier: 'pkg.tools',
			candidateExts: ['py'],
			knownPaths: new Set(['Test 2/pkg/tools/__init__.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('Test 2/pkg/tools/__init__.py');
	});

	it('issue #4: resolves a module in a sibling folder via the index fallback', () => {
		const resolved = python.resolveImport({
			importerPath: 'Issue 4/Alpha/alpha.py',
			specifier: 'beta',
			candidateExts: ['py'],
			knownPaths: new Set(['Issue 4/Alpha/alpha.py', 'Issue 4/Beta/beta.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('Issue 4/Beta/beta.py');
	});

	it('issue #4: resolves a via-sys.path package by its __init__.py', () => {
		const resolved = python.resolveImport({
			importerPath: 'Issue 4/Alpha/alpha.py',
			specifier: 'pkg',
			candidateExts: ['py'],
			knownPaths: new Set(['Issue 4/Alpha/alpha.py', 'Issue 4/Beta/pkg/__init__.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('Issue 4/Beta/pkg/__init__.py');
	});

	it('issue #4: leaves ambiguous module names unresolved', () => {
		const resolved = python.resolveImport({
			importerPath: 'Issue 4/Alpha/alpha.py',
			specifier: 'beta',
			candidateExts: ['py'],
			knownPaths: new Set([
				'Issue 4/Alpha/alpha.py',
				'Issue 4/Beta/beta.py',
				'Issue 4/Gamma/beta.py',
			]),
			tsConfig: null,
		});

		expect(resolved).toBeNull();
	});

	it('issue #4: keeps returning null when no indexed file matches', () => {
		const resolved = python.resolveImport({
			importerPath: 'Issue 4/Alpha/alpha.py',
			specifier: 'missing',
			candidateExts: ['py'],
			knownPaths: new Set(['Issue 4/Alpha/alpha.py']),
			tsConfig: null,
		});

		expect(resolved).toBeNull();
	});

	it('issue #4: ignores non-Python files with the same module name', () => {
		const resolved = python.resolveImport({
			importerPath: 'Issue 4/Alpha/alpha.py',
			specifier: 'beta',
			candidateExts: ['py'],
			knownPaths: new Set(['Issue 4/Alpha/alpha.py', 'Issue 4/Beta/beta.md']),
			tsConfig: null,
		});

		expect(resolved).toBeNull();
	});

	it('issue #4: prefers the full dotted path over a bare final-segment match', () => {
		const resolved = python.resolveImport({
			importerPath: 'Test 2/alpha.py',
			specifier: 'pkg.tools',
			candidateExts: ['py'],
			knownPaths: new Set(['Test 2/alpha.py', 'Shared/pkg/tools.py', 'Other/tools.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('Shared/pkg/tools.py');
	});

	it('issue #4: falls back to the final module segment for dotted imports', () => {
		const resolved = python.resolveImport({
			importerPath: 'Issue 4/Alpha/alpha.py',
			specifier: 'pkg.missing',
			candidateExts: ['py'],
			knownPaths: new Set(['Issue 4/Alpha/alpha.py', 'Issue 4/Beta/missing.py']),
			tsConfig: null,
		});

		expect(resolved).toBe('Issue 4/Beta/missing.py');
	});
});

const commentedImportProbes: Array<{ profileId: string; source: string }> = [
	{ profileId: 'typescript', source: "// import { hello } from './beta';" },
	{ profileId: 'tsx', source: "// import { hello } from './beta';" },
	{ profileId: 'javascript', source: "// import { hello } from './beta';" },
	{ profileId: 'python', source: '#from beta import hello' },
	{ profileId: 'css', source: '/* @import "theme.css"; */' },
	{ profileId: 'c', source: '// #include "header.h"' },
	{ profileId: 'cpp', source: '// #include "header.h"' },
	{ profileId: 'go', source: '// import "example/module"' },
	{ profileId: 'rust', source: '// use crate::module;' },
	{ profileId: 'java', source: '// import com.example.Widget;' },
	{ profileId: 'lua', source: '-- require("module")' },
	{ profileId: 'php', source: "// require_once 'module.php';" },
];

describe('commented import pattern across language profiles', () => {
	for (const { profileId, source } of commentedImportProbes) {
		it(`${profileId} ignores imports inside comments`, () => {
			const profile = getProfile(profileId);
			if (!profile) throw new Error(`Profile is not registered: ${profileId}`);

			expect(profile.extractImports(source)).toEqual([]);
		});
	}
});

describe('comment scanning preserves real imports and ignores comment-like string text', () => {
	it('keeps JavaScript imports after comment markers inside a string', () => {
		const javascript = getProfile('javascript');
		if (!javascript) throw new Error('JavaScript profile is not registered');

		expect(javascript.extractImports(
			`const note = "// import { fake } from 'fake'";\nimport { real } from './real';`,
		).map(({ specifier, line }) => ({ specifier, line }))).toEqual([
			{ specifier: './real', line: 2 },
		]);
	});

	it('does not capture a module specifier from an inline comment', () => {
		const javascript = getProfile('javascript');
		if (!javascript) throw new Error('JavaScript profile is not registered');

		expect(javascript.extractImports(
			`import /* from 'fake' */ { real } from './real';`,
		).map(({ specifier }) => specifier)).toEqual(['./real']);
	});

	it('ignores imports in Python triple-quoted strings but keeps following code', () => {
		expect(python.extractImports(
			`"""\nfrom fake import module\n"""\nfrom real import hello`,
		)).toEqual([{ specifier: 'real', names: ['hello'], line: 4 }]);
	});

	it('handles Rust nested block comments', () => {
		const rust = getProfile('rust');
		if (!rust) throw new Error('Rust profile is not registered');

		expect(rust.extractImports('/* outer /* use fake::module; */ still comment */\nuse real::module;'))
			.toEqual([{ specifier: 'real::module', names: [], line: 2 }]);
	});

	it('handles Lua long comments', () => {
		const lua = getProfile('lua');
		if (!lua) throw new Error('Lua profile is not registered');

		expect(lua.extractImports('--[=[\nrequire("fake")\n]=]\nrequire("real")'))
			.toEqual([{ specifier: 'real', names: [], line: 4 }]);
	});

	it('handles C++ raw strings containing comment markers and fake includes', () => {
		const cpp = getProfile('cpp');
		if (!cpp) throw new Error('C++ profile is not registered');

		expect(cpp.extractImports('auto text = R"tag(// #include "fake.h")tag";\n#include "real.h"'))
			.toEqual([{ specifier: 'real.h', names: [], line: 2 }]);
	});

	it('ignores CSS imports inside a quoted value', () => {
		const css = getProfile('css');
		if (!css) throw new Error('CSS profile is not registered');

		expect(css.extractImports('content: "/* @import \'fake.css\'; */";\n@import "real.css";')
			.map(({ specifier }) => specifier)).toEqual(['real.css']);
	});

	it('ignores Go imports inside a raw string', () => {
		const go = getProfile('go');
		if (!go) throw new Error('Go profile is not registered');

		expect(go.extractImports('text := `import "fake/module"`\nimport "real/module"')
			.map(({ specifier }) => specifier)).toEqual(['real/module']);
	});

	it('ignores Java imports inside a text block', () => {
		const java = getProfile('java');
		if (!java) throw new Error('Java profile is not registered');

		expect(java.extractImports('String text = """\nimport fake.Module;\n""";\nimport real.Module;')
			.map(({ specifier }) => specifier)).toEqual(['real.Module']);
	});

	it('handles PHP hash comments without treating PHP attributes as comments', () => {
		const php = getProfile('php');
		if (!php) throw new Error('PHP profile is not registered');

		expect(php.extractImports("# require_once 'fake.php';\n#[ImportMeta]\nuse Real\\Thing;"))
			.toEqual([{ specifier: 'Real\\Thing', names: [], line: 3 }]);
	});

	it('ignores Rust raw string contents', () => {
		const rust = getProfile('rust');
		if (!rust) throw new Error('Rust profile is not registered');

		expect(rust.extractImports('let text = r#"use fake::module;"#;\nuse real::module;')
			.map(({ specifier }) => specifier)).toEqual(['real::module']);
	});
});
