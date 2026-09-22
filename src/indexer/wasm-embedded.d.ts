/**
 * Type declarations for the generated wasm-embedded module.
 *
 * The actual implementation (src/indexer/wasm-embedded.ts) is generated at
 * build time by scripts/embed-wasm.mjs and is gitignored. This .d.ts stub is
 * committed so that TypeScript and ESLint can resolve the module's types
 * without running the build — including the Obsidian plugin checker's static
 * analysis, which runs against the repo source without building.
 *
 * The generated module exports GZIP-compressed wasm bytes (base64-encoded) to
 * keep main.js under Obsidian's 5 MB sync limit:
 *   - EMBEDDED_WASM_GZIP: Record<string, string> — grammar filename → base64
 *   - getEmbeddedWasmGzip(filename: string): Uint8Array | null — decodes the
 *     base64 into raw gzip bytes + caches. Inflate with DecompressionStream
 *     before use (see gunzipEmbedded() in src/indexer/tree-sitter.ts).
 */

export declare const EMBEDDED_WASM_GZIP: Record<string, string>;

export declare function getEmbeddedWasmGzip(
	filename: string,
): Uint8Array | null;
