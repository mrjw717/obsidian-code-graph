/**
 * Build-time script: copies the tree-sitter core runtime + the 4 used grammar
 * wasm files from node_modules into ./wasm next to main.js.
 *
 * This runs BEFORE embed-wasm.mjs so the wasm files are on disk for embedding.
 * Also runs as part of esbuild.config.mjs for dev mode.
 *
 * Only copies the 4 grammars actually used at runtime (hasSymbolExtraction: true
 * languages: TS, TSX, JS, Python). The other 13 grammars in the package are
 * never loaded.
 */
import fs from 'node:fs';
import path from 'node:path';

const NEEDED_GRAMMARS = new Set([
	'tree-sitter-typescript.wasm',
	'tree-sitter-tsx.wasm',
	'tree-sitter-javascript.wasm',
	'tree-sitter-python.wasm',
]);

const destRoot = path.join(process.cwd(), 'wasm');
const grammarDest = path.join(destRoot, 'grammars');

// Wipe stale grammars first so a provider switch doesn't leave dead files.
fs.rmSync(grammarDest, { recursive: true, force: true });
fs.mkdirSync(grammarDest, { recursive: true });

const coreSrc = path.join('node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm');
if (fs.existsSync(coreSrc)) {
	fs.copyFileSync(coreSrc, path.join(destRoot, 'web-tree-sitter.wasm'));
} else {
	console.warn('[wasm] core web-tree-sitter.wasm not found at', coreSrc);
}

const grammarDir = path.join('node_modules', '@repomix', 'tree-sitter-wasms', 'out');
let count = 0;
if (fs.existsSync(grammarDir)) {
	for (const file of fs.readdirSync(grammarDir)) {
		if (file.endsWith('.wasm') && NEEDED_GRAMMARS.has(file)) {
			fs.copyFileSync(path.join(grammarDir, file), path.join(grammarDest, file));
			count++;
		}
	}
} else {
	console.warn('[wasm] grammar dir not found at', grammarDir);
}
console.log(`[wasm] copied core + ${count} grammars to ${destRoot}`);