/**
 * Resolution: turn raw specifiers / symbol references into vault-absolute file
 * paths so they can become edges. Vault paths always use '/' as separator.
 */
import type { SymbolDef } from './extractor';
import { symbolNodeId } from '../graph/model';

export interface SymbolEntry {
	symbolId: string; // e.g. "src/foo.ts#render"
	filePath: string; // e.g. "src/foo.ts"
}

export function posixDir(p: string): string {
	const i = p.lastIndexOf('/');
	return i < 0 ? '' : p.slice(0, i);
}

export function posixJoin(a: string, b: string): string {
	if (!a) return b.replace(/^\/+/, '');
	if (!b) return a;
	return a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '');
}

/** Collapse "."/".." segments in a posix path. Preserves a leading "/". */
export function normalizePosix(p: string): string {
	const isAbs = p.startsWith('/');
	const parts = p.split('/');
	const out: string[] = [];
	for (const part of parts) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (out.length > 0) out.pop();
			continue;
		}
		out.push(part);
	}
	return (isAbs ? '/' : '') + out.join('/');
}

function isRelativeSpecifier(spec: string): boolean {
	return spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..';
}

/**
 * Resolve a JS/TS-style relative specifier against the importing file's dir.
 * Tries each candidate extension, then `<dir>/index.<ext>`.
 */
export function resolveJsImport(
	importerPath: string,
	specifier: string,
	candidateExts: string[],
	knownPaths: Set<string>,
): string | null {
	if (!isRelativeSpecifier(specifier)) return null;
	const base = normalizePosix(posixJoin(posixDir(importerPath), specifier));
	const candidates: string[] = [];
	for (const ext of candidateExts) candidates.push(`${base}.${ext}`);
	for (const ext of candidateExts) candidates.push(`${base}/index.${ext}`);
	for (const c of candidates) {
		if (knownPaths.has(c)) return c;
	}
	return null;
}

/**
 * Resolve a Python import specifier (dotted, possibly relative).
 * `from .foo import x` -> package-relative module; `import a.b` -> a/b.py.
 */
export function resolvePythonImport(
	importerPath: string,
	specifier: string,
	knownPaths: Set<string>,
): string | null {
	const rel = specifier.match(/^(\.+)(.*)$/);
	let base: string;
	if (rel) {
		const dots = rel[1]?.length ?? 1;
		const rest = rel[2] ?? '';
		let dir = posixDir(importerPath);
		// each dot beyond the first walks one level up
		for (let i = 1; i < dots; i++) dir = posixDir(dir);
		const modPath = rest.replace(/\./g, '/');
		base = modPath ? normalizePosix(posixJoin(dir, modPath)) : dir;
	} else {
		base = specifier.replace(/\./g, '/');
	}
	const candidates = [`${base}.py`, `${base}/__init__.py`];
	for (const c of candidates) {
		if (knownPaths.has(c)) return c;
	}
	return null;
}

/**
 * Resolve a C/C++ include specifier against the importing file's dir first,
 * then as a vault-relative path (common -I root resolution).
 */
export function resolveCInclude(
	importerPath: string,
	specifier: string,
	knownPaths: Set<string>,
): string | null {
	const fromDir = normalizePosix(posixJoin(posixDir(importerPath), specifier));
	const candidates = [fromDir, specifier];
	for (const c of candidates) {
		if (knownPaths.has(c)) return c;
	}
	return null;
}

/** Map symbol name -> set of files that define it (project-wide symbol table). */
export function buildSymbolTable(
	definesByFile: Map<string, SymbolDef[]>,
): Map<string, Set<string>> {
	const table = new Map<string, Set<string>>();
	for (const [path, defs] of definesByFile) {
		for (const def of defs) {
			let set = table.get(def.name);
			if (!set) {
				set = new Set();
				table.set(def.name, set);
			}
			set.add(path);
		}
	}
	return table;
}

/**
 * Resolve a symbol reference to a defining file.
 * Preference: a file the importer imported that defines the symbol; else a
 * unique definition; else null (ambiguous / unknown).
 */
export function resolveReference(
	refName: string,
	resolvedImportPaths: Set<string>,
	symbolTable: Map<string, Set<string>>,
	importerPath: string,
): string | null {
	const defs = symbolTable.get(refName);
	if (!defs || defs.size === 0) return null;
	if (defs.size === 1) {
		for (const p of defs) if (p !== importerPath) return p;
		return null;
	}
	// ambiguous: prefer an imported file
	for (const p of defs) {
		if (p === importerPath) continue;
		if (resolvedImportPaths.has(p)) return p;
	}
	return null;
}

/**
 * Index file paths by basename-without-extension for [[link]] resolution.
 * Also indexes multi-segment path suffixes so [[adapters/local-storage]]
 * resolves to calculator/src/adapters/local-storage.ts.
 */
export function buildNameIndex(paths: Iterable<string>): Map<string, string[]> {
	const map = new Map<string, string[]>();
	const add = (key: string, val: string): void => {
		if (!key) return;
		let arr = map.get(key);
		if (!arr) {
			arr = [];
			map.set(key, arr);
		}
		arr.push(val);
	};
	for (const p of paths) {
		const slash = p.lastIndexOf('/');
		const base = slash >= 0 ? p.slice(slash + 1) : p;
		const dot = base.lastIndexOf('.');
		const name = dot > 0 ? base.slice(0, dot) : base;
		add(name, p); // basename entry (existing behavior)

		// Multi-segment path entries: for adapters/local-storage.ts, also
		// index "adapters/local-storage" so [[adapters/local-storage]] works.
		const withoutExt = dot > slash ? p.slice(0, slash + 1 + name.length) : p;
		const segments = withoutExt.split('/');
		for (let i = Math.max(0, segments.length - 4); i < segments.length - 1; i++) {
			add(segments.slice(i).join('/'), p);
		}
	}
	return map;
}

// ─── Symbol-level resolution ───────────────────────────────────────────────

/**
 * Build a symbol table mapping simple name → all symbol node IDs that define
 * it (across the whole project). This is the symbol-level analogue of
 * buildSymbolTable; it resolves references to specific symbol nodes, not just
 * files.
 */
export function buildSymbolIdTable(
	definesByFile: Map<string, SymbolDef[]>,
): Map<string, SymbolEntry[]> {
	const table = new Map<string, SymbolEntry[]>();
	for (const [path, defs] of definesByFile) {
		for (const def of defs) {
			const symbolId = symbolNodeId(path, def.name, def.containerName);
			let arr = table.get(def.name);
			if (!arr) {
				arr = [];
				table.set(def.name, arr);
			}
			arr.push({ symbolId, filePath: path });
		}
	}
	return table;
}

/**
 * Resolve a symbol reference to a specific symbol node ID.
 * Preference: a symbol in an imported file; else a unique definition; else
 * null (ambiguous / unknown). Mirrors resolveReference's logic but returns
 * a SymbolEntry (symbolId + filePath) instead of just a file path.
 */
export function resolveSymbolReference(
	refName: string,
	resolvedImportPaths: Set<string>,
	symbolIdTable: Map<string, SymbolEntry[]>,
	importerPath: string,
): SymbolEntry | null {
	const entries = symbolIdTable.get(refName);
	if (!entries || entries.length === 0) return null;
	// Filter out definitions in the importer's own file — those are local
	// calls (self-edges), which we skip at the symbol level too.
	const external = entries.filter((e) => e.filePath !== importerPath);
	if (external.length === 0) return null;
	if (external.length === 1) return external[0] ?? null;
	// ambiguous: prefer a symbol in an imported file
	for (const e of external) {
		if (resolvedImportPaths.has(e.filePath)) return e;
	}
	return null;
}

/**
 * Given a file's symbol definitions and a target line number, find the
 * innermost symbol whose span [line, endLine] contains the target. This maps
 * a call/reference site to its enclosing function or method, enabling
 * symbol-level CALLS edges (function → function, not file → file).
 *
 * Returns null for references at module scope (no enclosing symbol).
 */
export function findContainingSymbol(
	defs: SymbolDef[],
	line: number,
): SymbolDef | null {
	let best: SymbolDef | null = null;
	for (const def of defs) {
		if (def.line > line) continue;
		if (def.endLine && line > def.endLine) continue;
		// Tightest enclosing scope = latest start line that's ≤ target.
		if (!best || def.line > best.line) {
			best = def;
		}
	}
	return best;
}

/**
 * Resolve a [[wikilink]]-style target to a vault file path. Handles aliases
 * ("X|alias"), headings ("X#sec"), and path-shaped targets ("dir/X").
 */
export function resolveLinkTarget(
	rawTarget: string,
	nameIndex: Map<string, string[]>,
	knownPaths: Set<string>,
): string | null {
	const beforeAlias = rawTarget.split('|')[0];
	if (!beforeAlias) return null;
	const beforeHeading = beforeAlias.split('#')[0];
	const target = beforeHeading?.trim();
	if (!target) return null;

	// For path-like targets, try exact match + common extensions
	if (target.includes('/') || target.includes('.')) {
		const exts = ['', '.md', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.css'];
		for (const ext of exts) {
			if (knownPaths.has(target + ext)) return target + ext;
		}
	}

	// Name index lookup — handles basenames AND multi-segment path suffixes
	const arr = nameIndex.get(target);
	if (arr && arr.length > 0) {
		const md = arr.find((p) => p.endsWith('.md'));
		const first = arr[0];
		return md ?? first ?? null;
	}
	return null;
}
