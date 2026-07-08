/**
 * Standalone diagnostic — runs the plugin's ACTUAL extraction pipeline
 * (profiles + tree-sitter + resolver + tsconfig) against a vault's code
 * files, without needing Obsidian.
 *
 * Prints: per-type counts, per-language counts, parse failures, sample edges,
 * and specifically validates that JSX component references (e.g. <Calculator/>)
 * now produce `calls` edges.
 *
 * Paths are configurable via env vars or argv so this is not hardwired to a
 * specific machine. Fallbacks keep the script working for the original dev.
 *
 * Usage:
 *   npx jiti scripts/diagnose-graph.ts [--vault <path>] [--scan <path>] [--scan <path> ...]
 *   # or via env:
 *   CG_VAULT_ROOT=/path/to/vault CG_SCAN_ROOTS=/path/a,/path/b npx jiti scripts/diagnose-graph.ts
 */
import fs from 'fs';
import path from 'path';
import type { DataAdapter } from 'obsidian';
import { getProfile, EXTENSION_TO_LANG } from '../src/indexer/profiles';
import { setAdapterAccess, parseSource } from '../src/indexer/tree-sitter';
import {
	buildSymbolTable,
	buildSymbolIdTable,
	resolveReference,
	resolveSymbolReference,
	findContainingSymbol,
} from '../src/indexer/resolver';
import { findTsConfig } from '../src/indexer/tsconfig';
import type { ImportSpec, SymbolExtract } from '../src/indexer/extractor';
import { EdgeAccumulator, makeSymbolNode, symbolNodeId } from '../src/graph/model';

// ── Configurable paths (env > argv > fallback) ─────────────────────────────
function parseArgs(): { vaultRoot: string; scanRoots: string[] } {
	const argv = process.argv.slice(2);
	let vaultRoot = process.env.CG_VAULT_ROOT ?? '';
	const scanRoots: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--vault' && argv[i + 1]) {
			vaultRoot = argv[++i]!;
		} else if (argv[i] === '--scan' && argv[i + 1]) {
			scanRoots.push(argv[++i]!);
		}
	}
	if (scanRoots.length === 0 && process.env.CG_SCAN_ROOTS) {
		scanRoots.push(
			...process.env.CG_SCAN_ROOTS.split(',').map((s) => s.trim()).filter(Boolean),
		);
	}
	// Fallbacks — original dev paths so the script works out-of-the-box there.
	if (!vaultRoot) {
		vaultRoot = '/home/josh/Obsidian-Plugin-Dev-Vault/Plugin-Testing';
	}
	if (scanRoots.length === 0) {
		scanRoots.push(path.join(vaultRoot, 'calculator'));
	}
	return { vaultRoot, scanRoots };
}

const { vaultRoot: VAULT_ROOT, scanRoots: SCAN_ROOTS } = parseArgs();
const PLUGIN_DIR = path.join(VAULT_ROOT, '.obsidian/plugins/code-graph');
const EXCLUDE_DIRS = new Set(['node_modules', '.next', '.git', '.turbo', 'dist', 'build']);
const CANDIDATE_EXTS = ['ts', 'tsx', 'js', 'jsx', 'py', 'css', 'c', 'h', 'cpp', 'cc', 'go', 'rs', 'java', 'lua', 'php'];

async function main(): Promise<void> {
	// 1. Point tree-sitter at the wasm dir. This script runs outside Obsidian,
	//    so wrap Node fs in a DataAdapter-shaped shim that tree-sitter.ts
	//    drives through the same code path the plugin uses in production.
	const adapterShim = {
		exists: (p: string) => Promise.resolve(fs.existsSync(p)),
		readBinary: (p: string) => {
			const buf = fs.readFileSync(p);
			const ab = buf.buffer.slice(
				buf.byteOffset,
				buf.byteOffset + buf.byteLength,
			) as ArrayBuffer;
			return Promise.resolve(ab);
		},
		writeBinary: (p: string, data: ArrayBuffer) => {
			fs.writeFileSync(p, Buffer.from(data));
			return Promise.resolve();
		},
		mkdir: (p: string) => {
			fs.mkdirSync(p, { recursive: true });
			return Promise.resolve();
		},
		getResourcePath: (p: string) => p,
	};
	setAdapterAccess({
		adapter: adapterShim as unknown as DataAdapter,
		pluginDirRel: PLUGIN_DIR,
	});

	// 2. Walk code files.
	const codeFiles: { abs: string; rel: string; ext: string; lang: string }[] = [];
	function walk(dir: string): void {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				if (EXCLUDE_DIRS.has(entry.name)) continue;
				walk(path.join(dir, entry.name));
			} else if (entry.isFile()) {
				const ext = entry.name.split('.').pop() ?? '';
				if (CANDIDATE_EXTS.includes(ext)) {
					const lang = EXTENSION_TO_LANG[ext] ?? ext;
					const rel = path.relative(VAULT_ROOT, path.join(dir, entry.name)).replace(/\\/g, '/');
					codeFiles.push({ abs: path.join(dir, entry.name), rel, ext, lang });
				}
			}
		}
	}
	for (const root of SCAN_ROOTS) {
		if (fs.existsSync(root)) walk(root);
	}

	console.log(`\n=== SCAN ===`);
	console.log(`Code files found: ${codeFiles.length}`);
	const byExt: Record<string, number> = {};
	for (const f of codeFiles) byExt[f.ext] = (byExt[f.ext] ?? 0) + 1;
	console.log(`By extension:`, byExt);

	const knownPaths = new Set(codeFiles.map((f) => f.rel));

	// 3. Pass 1: extract per file.
	interface FileData {
		rel: string;
		lang: string;
		imports: ImportSpec[];
		symbols: SymbolExtract;
	}
	const perFile: FileData[] = [];
	const parseFailures: string[] = [];
	let parsedCount = 0;

	for (const f of codeFiles) {
		const content = fs.readFileSync(f.abs, 'utf8');
		const profile = getProfile(f.lang);
		const imports = profile?.extractImports(content) ?? [];
		let symbols: SymbolExtract = { defines: [], references: [], inherits: [], implements: [], typeRefs: [] };
		if (profile?.extractSymbols) {
			try {
				const tree = await parseSource(f.lang, content);
				if (tree) {
					symbols = profile.extractSymbols(tree);
					tree.delete();
					parsedCount++;
				} else {
					parseFailures.push(`${f.rel} — parseSource returned null (grammar load failed?)`);
				}
			} catch (err) {
				parseFailures.push(`${f.rel} — ${(err as Error).message}`);
			}
		}
		perFile.push({ rel: f.rel, lang: f.lang, imports, symbols });
	}

	console.log(`\n=== TREE-SITTER ===`);
	console.log(`Files parsed via tree-sitter: ${parsedCount}`);
	if (parseFailures.length > 0) {
		console.log(`Parse failures (${parseFailures.length}):`);
		for (const f of parseFailures) console.log(`  ✗ ${f}`);
	} else {
		console.log(`No parse failures.`);
	}

	// 4. Build symbol tables (file-level + symbol-level).
	const definesByFile = new Map<string, SymbolExtract['defines']>();
	for (const fd of perFile) definesByFile.set(fd.rel, fd.symbols.defines);
	const symbolTable = buildSymbolTable(definesByFile);
	const symbolIdTable = buildSymbolIdTable(definesByFile);

	console.log(`\n=== SYMBOL TABLE ===`);
	console.log(`Distinct symbols defined in-vault: ${symbolTable.size}`);

	// 5. Pass 2: resolve edges (file-level + symbol-level).
	const acc = new EdgeAccumulator();
	const tsconfigDeps = {
		fileExists: async (p: string) => fs.existsSync(path.join(VAULT_ROOT, p)),
		readFile: async (p: string) => fs.readFileSync(path.join(VAULT_ROOT, p), 'utf8'),
	};
	const unresolvedSpecs: string[] = [];

	for (const fd of perFile) {
		const profile = getProfile(fd.lang);
		const tsConfig = profile?.usesTsConfig
			? await findTsConfig(fd.rel, tsconfigDeps)
			: null;
		const resolvedImportPaths = new Set<string>();

		// File-level imports
		for (const imp of fd.imports) {
			const resolved = profile?.resolveImport({
				importerPath: fd.rel,
				specifier: imp.specifier,
				candidateExts: CANDIDATE_EXTS,
				knownPaths,
				tsConfig,
			}) ?? null;
			if (resolved) {
				resolvedImportPaths.add(resolved);
				acc.add(fd.rel, resolved, 'imports');
			} else {
				if (imp.specifier.startsWith('./') || imp.specifier.startsWith('../') || imp.specifier.startsWith('@/')) {
					unresolvedSpecs.push(`${fd.rel} ← ${imp.specifier}`);
				}
			}
		}

		// File-level calls / inherits (backward-compatible)
		for (const ref of fd.symbols.references) {
			const resolved = resolveReference(ref.name, resolvedImportPaths, symbolTable, fd.rel);
			if (resolved) acc.add(fd.rel, resolved, 'calls');
		}
		for (const inh of fd.symbols.inherits) {
			const resolved = resolveReference(inh.baseName, resolvedImportPaths, symbolTable, fd.rel);
			if (resolved) acc.add(fd.rel, resolved, 'inherits');
		}

		// ── Symbol-level: nodes + CONTAINS + symbol-level calls/inherits/implements ──
		const fileDefs = fd.symbols.defines;

		// CONTAINS edges (file → symbol, class → method)
		for (const def of fileDefs) {
			const parentId = def.containerName
				? symbolNodeId(fd.rel, def.containerName)
				: fd.rel;
			acc.add(parentId, symbolNodeId(fd.rel, def.name, def.containerName), 'contains');
		}

		// Symbol-level CALLS
		for (const ref of fd.symbols.references) {
			const caller = findContainingSymbol(fileDefs, ref.line);
			if (!caller) continue;
			const callerId = symbolNodeId(fd.rel, caller.name, caller.containerName);
			let calleeId: string | null = null;
			const localMatches = fileDefs.filter((d) => d.name === ref.name);
			if (localMatches.length === 1) {
				calleeId = symbolNodeId(fd.rel, ref.name, localMatches[0]?.containerName);
			} else if (localMatches.length === 0) {
				const callee = resolveSymbolReference(ref.name, resolvedImportPaths, symbolIdTable, fd.rel);
				calleeId = callee?.symbolId ?? null;
			}
			if (calleeId && calleeId !== callerId) acc.add(callerId, calleeId, 'calls');
		}

		// Symbol-level INHERITS + IMPLEMENTS
		for (const inh of fd.symbols.inherits) {
			const child = findContainingSymbol(fileDefs, inh.line);
			const childId = child ? symbolNodeId(fd.rel, child.name, child.containerName) : fd.rel;
			const parentEntry = resolveSymbolReference(inh.baseName, resolvedImportPaths, symbolIdTable, fd.rel);
			if (parentEntry) acc.add(childId, parentEntry.symbolId, 'inherits');
		}
		for (const impl of fd.symbols.implements) {
			const impler = findContainingSymbol(fileDefs, impl.line);
			const implerId = impler ? symbolNodeId(fd.rel, impler.name, impler.containerName) : fd.rel;
			const ifaceEntry = resolveSymbolReference(impl.ifaceName, resolvedImportPaths, symbolIdTable, fd.rel);
			if (ifaceEntry) acc.add(implerId, ifaceEntry.symbolId, 'implements');
		}
	}

	const edges = acc.toArray();

	// 6. Report.
	console.log(`\n=== EDGES (total: ${edges.length}) ===`);
	const byType: Record<string, number> = {};
	const byLang: Record<string, Record<string, number>> = {};
	for (const e of edges) {
		byType[e.type] = (byType[e.type] ?? 0) + 1;
		const lang = perFile.find((f) => f.rel === e.src)?.lang ?? '?';
		if (!byLang[lang]) byLang[lang] = {};
		byLang[lang][e.type] = (byLang[lang][e.type] ?? 0) + 1;
	}
	console.log('By type:', byType);
	console.log('By language:', byLang);

	// 7. Validate symbol-level extraction.
	console.log(`\n=== SYMBOL-LEVEL VALIDATION ===`);
	const containsEdges = edges.filter((e) => e.type === 'contains');
	const symCalls = edges.filter((e) => e.type === 'calls' && e.src.includes('#'));
	const implEdges = edges.filter((e) => e.type === 'implements');
	console.log(`CONTAINS edges: ${containsEdges.length}`);
	console.log(`Symbol-level CALLS edges: ${symCalls.length}`);
	console.log(`IMPLEMENTS edges: ${implEdges.length}`);
	if (symCalls.length > 0) {
		console.log(`  Sample symbol calls:`);
		for (const e of symCalls.slice(0, 5)) console.log(`    ${e.src} → ${e.dst}`);
	}

	// 8. Sample edges per type.
	console.log(`\n=== SAMPLE EDGES (first 5 per type) ===`);
	for (const type of ['imports', 'calls', 'inherits', 'implements', 'contains']) {
		const sample = edges.filter((e) => e.type === type).slice(0, 5);
		console.log(`${type} (${sample.length} shown):`);
		for (const e of sample) console.log(`  ${e.src} → ${e.dst}`);
	}

	// 9. Unresolved relative specifiers (diagnostic for resolution bugs).
	if (unresolvedSpecs.length > 0) {
		console.log(`\n=== UNRESOLVED RELATIVE SPECIFIERS (${unresolvedSpecs.length}) ===`);
		for (const s of unresolvedSpecs.slice(0, 20)) console.log(`  ${s}`);
		if (unresolvedSpecs.length > 20) console.log(`  ... and ${unresolvedSpecs.length - 20} more`);
	}

	// 10. Symbols extracted from the most-referenced file (sanity check depth).
	const mostRefFile = perFile
		.map((f) => ({
			f,
			refCount: f.symbols.references.length,
		}))
		.sort((a, b) => b.refCount - a.refCount)[0]?.f;
	if (mostRefFile && mostRefFile.symbols.references.length > 0) {
		console.log(`\n=== EXTRACTION DEPTH: ${mostRefFile.rel} ===`);
		console.log(`Imports: ${mostRefFile.imports.length}`);
		console.log(`Defines: ${mostRefFile.symbols.defines.length} (${mostRefFile.symbols.defines.map(d => d.name).join(', ')})`);
		console.log(`References (calls): ${mostRefFile.symbols.references.length}`);
		console.log(`  Sample ref names: ${mostRefFile.symbols.references.slice(0, 15).map(r => r.name).join(', ')}`);
		console.log(`Inherits: ${mostRefFile.symbols.inherits.length}`);
	}
}

main().catch((err) => {
	console.error('Diagnostic failed:', err);
	process.exit(1);
});
