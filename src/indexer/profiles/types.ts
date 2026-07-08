/**
 * Language profile contracts.
 *
 * A LanguageProfile bundles everything the indexer needs to know about a single
 * programming language: which file extensions map to it, how to extract import
 * statements, how to resolve an import specifier to a vault file path, and
 * (optionally) how to extract symbol definitions / calls / inheritance from a
 * tree-sitter syntax tree.
 *
 * Adding a new language = adding one profile object to `registry.ts`. No other
 * switch statement needs updating — that's the whole point of this layer.
 *
 * See `profiles/README.md` for the recipe.
 */
import type { Tree } from 'web-tree-sitter';
import type { ImportSpec, SymbolExtract } from '../extractor';
import type { TsConfigInfo } from '../tsconfig';

/**
 * Everything a profile's `resolveImport` needs to turn a raw specifier into a
 * vault-absolute file path. The indexer assembles this per-file before looping
 * over imports.
 */
export interface ResolveContext {
	/** Vault-absolute path of the importing file. */
	importerPath: string;
	/** Raw module specifier as written in the source (`./foo`, `react`, ...). */
	specifier: string;
	/** Candidate code extensions (from settings), used for extension probing. */
	candidateExts: string[];
	/** Every known vault file path (the indexer's universe). */
	knownPaths: Set<string>;
	/**
	 * Pre-resolved tsconfig/jsconfig for the importer's nearest config dir.
	 * Only meaningful for profiles that declare `usesTsConfig: true`; null
	 * otherwise. The indexer fetches this once per file to avoid re-reading
	 * the config for every import.
	 */
	tsConfig: TsConfigInfo | null;
}

export interface LanguageProfile {
	/** tree-sitter language id (`'typescript'`, `'python'`, ...). */
	readonly id: string;
	/** File extensions (no leading dot) this profile handles. */
	readonly extensions: readonly string[];
	/** Grammar wasm filename, if a tree-sitter extractor is available. */
	readonly grammar?: string;
	/**
	 * True when this profile can extract `calls` / `inherits` edges via a
	 * tree-sitter extractor. When false, only `imports` edges are produced.
	 */
	readonly hasSymbolExtraction: boolean;
	/**
	 * True when import resolution should consult a tsconfig/jsconfig for path
	 * aliases (JS/TS family). Avoids disk probes for languages that don't
	 * use tsconfig.
	 */
	readonly usesTsConfig: boolean;

	/** Extract raw import specifiers from source. Language-specific. */
	extractImports(content: string): ImportSpec[];

	/** Resolve a single import specifier to a vault-absolute path, or null. */
	resolveImport(ctx: ResolveContext): string | null;

	/**
	 * Optional tree-sitter symbol extractor. Present iff `hasSymbolExtraction`.
	 * Receives the parsed tree; returns definitions, references, and inherits.
	 */
	extractSymbols?(tree: Tree): SymbolExtract;
}
