/**
 * Post-build step: neutralize the dead `require("fs")` that esbuild leaves in
 * the bundle from web-tree-sitter's emscripten runtime (Node-only branch,
 * guarded by ENVIRONMENT_IS_NODE and never executed in Obsidian — tree-sitter
 * is initialized with explicit wasm bytes and all IO goes through the vault
 * DataAdapter).
 *
 * Why not fix it in esbuild: neither the `external` list nor an onResolve
 * stub plugin catches this particular CJS require — esbuild's rewriter keeps
 * it verbatim. Rewriting the exact minified pattern post-build is
 * deterministic, and the verification below fails the build if any Node fs
 * reference ever reappears (keeping the Obsidian "Direct Filesystem Access"
 * static-analysis warning permanently fixed).
 *
 * Run automatically by `npm run build` after esbuild (production only).
 */
import fs from 'node:fs';

const FILE = 'main.js';
if (!fs.existsSync(FILE)) {
	console.error('[patch-fs] main.js not found — run esbuild first');
	process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');
const before = src;

// var fs=require("fs") → var fs=({})  (plus defensive variants)
src = src.replace(
	/__(?:require|dynamic_import)\("node:fs"\)|__(?:require|dynamic_import)\("fs"\)|\brequire\("node:fs"\)|\brequire\("fs"\)/g,
	'({})',
);

if (src === before) {
	console.log('[patch-fs] no Node fs references found (already clean)');
} else {
	fs.writeFileSync(FILE, src);
	console.log('[patch-fs] neutralized dead Node fs require(s) in main.js');
}

// Hard gate: the bundle must not reference Node fs in any form.
const remaining = src.match(/\brequire\("(node:)?fs(\/.*)?"\)|__require\("(node:)?fs(\/.*)?"\)/);
if (remaining) {
	console.error(
		`[patch-fs] FAIL: Node fs reference still present in main.js: ${remaining[0]}`,
	);
	process.exit(1);
}
console.log('[patch-fs] verified: main.js has no Node fs references');
