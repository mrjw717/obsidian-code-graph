/**
 * Type declarations for the generated wasm-embedded module.
 *
 * The actual implementation (src/indexer/wasm-embedded.ts) is generated at
 * build time by scripts/embed-wasm.mjs and is gitignored. This .d.ts stub is
 * committed so that TypeScript and ESLint can resolve the module's types
 * without running the build — including the Obsidian plugin checker's static
 * analysis, which runs against the repo source without building.
 *
 * The generated module exports:
 *   - EMBEDDED_WASM: Record<string, string> — maps grammar filename → base64
 *   - getEmbeddedWasm(filename: string): Uint8Array | null — decodes + caches
 */

export declare const EMBEDDED_WASM: Record<string, string>;

export declare function getEmbeddedWasm(
	filename: string,
): Uint8Array | null;