/**
 * tree-sitter bootstrap.
 *
 * web-tree-sitter ships a core runtime wasm (`web-tree-sitter.wasm`) plus a
 * wasm grammar per language. Both are copied next to main.js by esbuild
 * (see esbuild.config.mjs) and read here via Node fs. Reading grammar bytes
 * directly avoids any file:// / fetch / CORS issues inside Obsidian.
 *
 * The plugin folder absolute path is supplied at runtime via setFsAccess().
 *
 * **Fallback:** if the `wasm/` directory is not present on disk (e.g. a fresh
 * install from a GitHub release that only ships main.js + manifest.json), the
 * embedded base64 bytes from `wasm-embedded.ts` are written to disk on first
 * access. This makes the plugin self-contained — no separate wasm download or
 * manual extraction step for end users.
 */
import { Parser, Language, type Tree } from 'web-tree-sitter';
import fs from 'fs';
import path from 'path';
import { LANG_TO_GRAMMAR } from './profiles';
import { getEmbeddedWasm } from './wasm-embedded';

export interface FsAccess {
	getPluginDir(): string;
}

let fsAccess: FsAccess | null = null;
let corePromise: Promise<void> | null = null;
const languageCache = new Map<string, Language>();

export function setFsAccess(access: FsAccess): void {
	fsAccess = access;
	corePromise = null;
	languageCache.clear();
}

function pluginDir(): string {
	if (!fsAccess) {
		throw new Error('[code-graph] tree-sitter fsAccess not configured');
	}
	return fsAccess.getPluginDir();
}

function wasmRoot(): string {
	return path.join(pluginDir(), 'wasm');
}

/**
 * Ensure a wasm file exists on disk. If it's missing, try to extract it from
 * the embedded base64 constants (generated at build time). This is the
 * self-contained-install fallback: a fresh GitHub release install has no
 * wasm/ directory, so we materialize the 5 needed files on first load.
 *
 * Returns true if the file is available (was already there or just written);
 * false if it cannot be sourced from either disk or embedded bytes.
 */
function ensureWasmFile(relativePath: string, filename: string): boolean {
	const fullPath = path.join(relativePath);
	if (fs.existsSync(fullPath)) return true;
	const embedded = getEmbeddedWasm(filename);
	if (!embedded) return false;
	try {
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, embedded);
		return true;
	} catch (err) {
		console.warn(`[code-graph] failed to write embedded wasm ${filename}:`, err);
		return false;
	}
}

/** Initialize the tree-sitter core runtime (once). */
function ensureCore(): Promise<void> {
	if (corePromise) return corePromise;
	corePromise = (async () => {
		const root = wasmRoot();
		const corePath = path.join(root, 'web-tree-sitter.wasm');

		// Fallback: extract from embedded bytes if not on disk.
		ensureWasmFile(corePath, 'web-tree-sitter.wasm');

		if (!fs.existsSync(corePath)) {
			throw new Error(
				`[code-graph] tree-sitter core wasm not found at ${corePath}`,
			);
		}
		// Pass the core wasm bytes directly. This sidesteps emscripten's
		// environment detection, which can misfire inside Obsidian's Electron
		// renderer and fall back to fetch() of a file:// URL (blocked by CORS).
		const buf = fs.readFileSync(corePath);
		const wasmBinary = buf.buffer.slice(
			buf.byteOffset,
			buf.byteOffset + buf.byteLength,
		);
		// CRITICAL: provide locateFile so emscripten's findWasmBinary() uses
		// our callback instead of `new URL("web-tree-sitter.wasm",
		// import.meta.url)`. When esbuild bundles to CJS, import.meta is
		// replaced with an empty object {}, so import.meta.url is undefined,
		// and `new URL(file, undefined)` throws TypeError: Invalid URL —
		// silently killing ALL tree-sitter parsing. The locateFile callback
		// short-circuits that codepath entirely.
		await Parser.init({
			wasmBinary,
			locateFile: (file: string) => path.join(root, file),
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
	} catch (err) {
		console.error('[code-graph] tree-sitter core init failed:', err);
		return null;
	}
	const wasmPath = path.join(wasmRoot(), 'grammars', grammar);

	// Fallback: extract from embedded bytes if not on disk.
	ensureWasmFile(wasmPath, grammar);

	if (!fs.existsSync(wasmPath)) {
		console.warn(
			`[code-graph] grammar wasm not found: ${wasmPath} (lang=${lang})`,
		);
		return null;
	}
	try {
		const bytes = fs.readFileSync(wasmPath);
		const language = await Language.load(new Uint8Array(bytes));
		languageCache.set(lang, language);
		return language;
	} catch (err) {
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
