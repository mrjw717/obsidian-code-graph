/**
 * Language profile registry — the single source of truth for "what languages
 * does this plugin understand, and how?"
 *
 * Every other module consults this registry via `getProfile(langId)` or the
 * derived maps (`EXTENSION_TO_LANG`, `LANG_TO_GRAMMAR`, `TREE_SITTER_LANGS`).
 * Adding a language = adding one profile object to `PROFILES` below; nothing
 * else needs updating.
 *
 * See `profiles/README.md` for the recipe.
 */
import type { LanguageProfile } from './types';
import { JAVASCRIPT_PROFILE, TSX_PROFILE, TYPESCRIPT_PROFILE } from './javascript';
import { PYTHON_PROFILE } from './python';
import {
	C_PROFILE,
	CPP_PROFILE,
	CSS_PROFILE,
	GO_PROFILE,
	JAVA_PROFILE,
	LUA_PROFILE,
	PHP_PROFILE,
	RUST_PROFILE,
} from './imports-only';

/**
 * The registry. Keyed by tree-sitter language id. Order is not significant.
 */
export const PROFILES: Readonly<Record<string, LanguageProfile>> = {
	typescript: TYPESCRIPT_PROFILE,
	tsx: TSX_PROFILE,
	javascript: JAVASCRIPT_PROFILE,
	python: PYTHON_PROFILE,

	css: CSS_PROFILE,
	c: C_PROFILE,
	cpp: CPP_PROFILE,
	go: GO_PROFILE,
	rust: RUST_PROFILE,
	java: JAVA_PROFILE,
	lua: LUA_PROFILE,
	php: PHP_PROFILE,
};

/**
 * Look up the profile for a tree-sitter language id.
 * Returns undefined for unsupported languages; callers should fall back to
 * imports-only behavior (or skip the file).
 */
export function getProfile(langId: string): LanguageProfile | undefined {
	return PROFILES[langId];
}

// ─── Derived maps (replaces the hand-maintained constants in types.ts) ────

/**
 * File extension (no dot) → language id. Built from the registry so it can
 * never drift from the set of registered profiles.
 */
export const EXTENSION_TO_LANG: Readonly<Record<string, string>> = (() => {
	const map: Record<string, string> = {};
	for (const profile of Object.values(PROFILES)) {
		for (const ext of profile.extensions) {
			map[ext] = profile.id;
		}
	}
	return map;
})();

/**
 * Language id → grammar wasm filename, for languages that ship a grammar.
 * Consumed by `tree-sitter.ts` `loadLanguage`.
 */
export const LANG_TO_GRAMMAR: Readonly<Record<string, string>> = (() => {
	const map: Record<string, string> = {};
	for (const profile of Object.values(PROFILES)) {
		if (profile.grammar) map[profile.id] = profile.grammar;
	}
	return map;
})();

/**
 * Languages with a wired tree-sitter symbol extractor (i.e. they can produce
 * `calls` / `inherits` edges, not just `imports`). Consumed by the indexer to
 * decide whether to parse a file's AST.
 */
export const TREE_SITTER_LANGS: ReadonlySet<string> = new Set(
	Object.values(PROFILES)
		.filter((p) => p.hasSymbolExtraction)
		.map((p) => p.id),
);
