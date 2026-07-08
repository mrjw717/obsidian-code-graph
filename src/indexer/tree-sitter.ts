/**
 * tree-sitter bootstrap.
 *
 * web-tree-sitter ships a core runtime wasm (`web-tree-sitter.wasm`) plus a
 * wasm grammar per language. Both live next to main.js under `<pluginDir>/wasm/`
 * and are read here through the Obsidian vault adapter (DataAdapter).
 *
 * Reading grammar bytes via the sanctioned Obsidian API — instead of Node's
 * `fs`/`path` — keeps the plugin fully within the vault API, removes any
 * filesystem access outside it, and keeps every value strongly typed (the
 * Node `fs` module resolves to `any` under type-aware analysis that lacks
 * `@types/node`, which previously cascaded `any` into the web-tree-sitter
 * calls).
 *
 * The plugin folder's vault-relative path is supplied at runtime via
 * setAdapterAccess().
 *
 * **Fallback:** if a wasm file is missing on disk (e.g. a fresh install from a
 * GitHub release that only ships main.js + manifest.json), the embedded base64
 * bytes from `wasm-embedded.ts` are materialized via the adapter. This makes
 * the plugin self-contained — no separate wasm download step for end users.
 */
import { Parser, Language, type Tree } from 'web-tree-sitter';
import type { DataAdapter } from 'obsidian';
import { LANG_TO_GRAMMAR } from './profiles';
import { getEmbeddedWasm } from './wasm-embedded';

export interface AdapterAccess {
	/** Obsidian vault adapter used for all wasm reads/writes. */
	adapter: DataAdapter;
	/** Vault-relative plugin folder, e.g. ".obsidian/plugins/code-graph". */
	pluginDirRel: string;
}

let access: AdapterAccess | null = null;
let corePromise: Promise<void> | null = null;
const languageCache = new Map<string, Language>();

export function setAdapterAccess(a: AdapterAccess): void {
	access = a;
	corePromise = null;
	languageCache.clear();
}

function requireAccess(): AdapterAccess {
	if (!access) {
		throw new Error('[code-graph] tree-sitter adapter access not configured');
	}
	return access;
}

/** Vault-relative path to the wasm directory. */
function wasmRoot(): string {
	return `${requireAccess().pluginDirRel}/wasm`;
}

/**
 * Ensure every parent segment of `fileRel` exists. The adapter's mkdir may not
 * be recursive, so segments are created one at a time from the plugin root.
 */
async function ensureParentDir(fileRel: string): Promise<void> {
	const slash = fileRel.lastIndexOf('/');
	if (slash <= 0) return;
	const parent = fileRel.slice(0, slash);
	const segments = parent.split('/');
	let acc = '';
	for (const seg of segments) {
		acc = acc ? `${acc}/${seg}` : seg;
		const { adapter } = requireAccess();
		if (!(await adapter.exists(acc))) {
			try {
				await adapter.mkdir(acc);
			} catch {
				// Race or already exists — safe to ignore.
			}
		}
	}
}

/**
 * Ensure a wasm file exists on disk. If missing, materialize it from the
 * embedded base64 constants (generated at build time) via the adapter. This is
 * the self-contained-install fallback: a fresh GitHub release install has no
 * wasm/ directory, so we write the needed files on first load.
 *
 * Returns true if the file is available (was already there or just written);
 * false if it cannot be sourced from either disk or embedded bytes.
 */
async function ensureWasmFile(relPath: string, filename: string): Promise<boolean> {
	const { adapter } = requireAccess();
	if (await adapter.exists(relPath)) return true;
	const embedded = getEmbeddedWasm(filename);
	if (!embedded) return false;
	try {
		await ensureParentDir(relPath);
		// Copy the (possibly-viewed) Uint8Array into a standalone ArrayBuffer.
		// getEmbeddedWasm() returns a Uint8Array allocated as `new Uint8Array(n)`
		// (see wasm-embedded.ts decode()), so its underlying buffer is always a
		// real ArrayBuffer of exactly the right length. `Uint8Array.buffer` is
		// typed `ArrayBufferLike` (ArrayBuffer | SharedArrayBuffer); assert to
		// the concrete ArrayBuffer the adapter expects.
		const buffer = embedded.buffer as ArrayBuffer;
		await adapter.writeBinary(relPath, buffer);
		return true;
	} catch (err: unknown) {
		console.warn(`[code-graph] failed to write embedded wasm ${filename}:`, err);
		return false;
	}
}

/** Initialize the tree-sitter core runtime (once). */
function ensureCore(): Promise<void> {
	if (corePromise) return corePromise;
	corePromise = (async () => {
		const { adapter } = requireAccess();
		const root = wasmRoot();
		const corePath = `${root}/web-tree-sitter.wasm`;

		// Fallback: extract from embedded bytes if not on disk.
		await ensureWasmFile(corePath, 'web-tree-sitter.wasm');

		if (!(await adapter.exists(corePath))) {
			throw new Error(
				`[code-graph] tree-sitter core wasm not found at ${corePath}`,
			);
		}
		// Pass the core wasm bytes directly. This sidesteps emscripten's
		// environment detection, which can misfire inside Obsidian's Electron
		// renderer and fall back to fetch() of a file:// URL (blocked by CORS).
		const wasmBinary = await adapter.readBinary(corePath);
		// CRITICAL: provide locateFile so emscripten's findWasmBinary() uses
		// our callback instead of `new URL("web-tree-sitter.wasm",
		// import.meta.url)`. When esbuild bundles to CJS, import.meta is
		// replaced with an empty object {}, so import.meta.url is undefined,
		// and `new URL(file, undefined)` throws TypeError: Invalid URL —
		// silently killing ALL tree-sitter parsing. getResourcePath yields a
		// renderer-usable URL (app://local/...) for any support file lookup.
		await Parser.init({
			wasmBinary,
			locateFile: (file: string) => adapter.getResourcePath(`${root}/${file}`),
		});
	})();
	return corePromise;
}

/** Load (and cache) a tree-sitter grammar for a language id, e.g. "typescript". */
export async function loadLanguage(lang: string): Promise<Language | null> {
	const grammar = LANG_TO_GRAMMAR[lang];
	if (!grammar) {
		console.warn(`[code-graph] no grammar registered for lang "${lang}"`);
		return null;
	}
	const cached = languageCache.get(lang);
	if (cached) return cached;
	try {
		await ensureCore();
	} catch (err: unknown) {
		console.error('[code-graph] tree-sitter core init failed:', err);
		return null;
	}
	const { adapter } = requireAccess();
	const wasmPath = `${wasmRoot()}/grammars/${grammar}`;

	// Fallback: extract from embedded bytes if not on disk.
	await ensureWasmFile(wasmPath, grammar);

	if (!(await adapter.exists(wasmPath))) {
		console.warn(
			`[code-graph] grammar wasm not found: ${wasmPath} (lang=${lang})`,
		);
		return null;
	}
	try {
		const bytes = await adapter.readBinary(wasmPath);
		const language = await Language.load(new Uint8Array(bytes));
		languageCache.set(lang, language);
		return language;
	} catch (err: unknown) {
		console.error(
			'[code-graph] Language.load failed for %s (%s):',
			lang,
			grammar,
			err,
		);
		return null;
	}
}

/** Parse source code for a language. Returns null if the language is unsupported. */
export async function parseSource(
	lang: string,
	source: string,
): Promise<Tree | null> {
	const language = await loadLanguage(lang);
	if (!language) return null;
	const parser = new Parser();
	parser.setLanguage(language);
	return parser.parse(source);
}
