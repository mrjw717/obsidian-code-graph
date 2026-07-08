/**
 * Core data model for the Code Graph plugin.
 *
 * Nodes are vault files. Edges are typed relationships between files.
 * The graph is file-level: a "calls" edge A -> B means "file A calls a symbol
 * that is defined in file B" (symbol-level relationships are aggregated to files).
 */

export type EdgeType =
	| 'imports' // A statically imports / requires / includes from B
	| 'calls' // A references a symbol defined in B
	| 'inherits' // A extends a type from B (class/interface → parent)
	| 'implements' // A implements an interface from B (class → interface)
	| 'contains' // A structurally contains B (file → symbol, class → method)
	| 'uses-type' // A has a type annotation referencing a type defined in B
	| 'tested-by' // A is verified by test file B (@tested-by [[X]])
	| 'adr-link' // A is governed by architecture decision B (@adr [[X]])
	| 'depends-on' // A depends on external service/concept B (@depends-on [[X]])
	| 'documents' // Note A documents code file B (from frontmatter related-code)
	| 'comment-link' // A's comments contain a [[wikilink]] or @see to B
	| 'md-link'; // a markdown note links to B (sourced from metadataCache)

export const ALL_EDGE_TYPES: EdgeType[] = [
	'imports',
	'calls',
	'inherits',
	'implements',
	'contains',
	'uses-type',
	'tested-by',
	'adr-link',
	'depends-on',
	'documents',
	'comment-link',
	'md-link',
];

export type NodeKind =
	// File-level (container) nodes:
	| 'code' // a source file
	| 'note' // a markdown note
	| 'other' // an unrecognized file
	// Symbol-level nodes (parentId points to their containing file / class):
	| 'function'
	| 'class'
	| 'method'
	| 'interface'
	| 'variable'
	| 'type'
	| 'enum'
	| 'constant';

/** All symbol-level node kinds (not file containers). */
export const SYMBOL_KINDS: ReadonlySet<string> = new Set<string>([
	'function',
	'class',
	'method',
	'interface',
	'variable',
	'type',
	'enum',
	'constant',
]);

export function isSymbolKind(kind: string): boolean {
	return SYMBOL_KINDS.has(kind);
}

export interface GraphNode {
	id: string; // vault-absolute path (TFile.path), used as the graph node id
	path: string; // same as id for file nodes; containing-file path for symbol nodes
	name: string; // basename without extension (files) or symbol name (symbols)
	kind: NodeKind;
	lang?: string; // for code nodes: tree-sitter language id (e.g. "typescript")
	ext?: string; // file extension without dot
	// ── Symbol-level metadata (absent for file-level nodes) ──
	line?: number; // definition line (1-based) for symbol nodes
	endLine?: number; // end line (1-based) for span-based containment lookups
	parentId?: string; // containing node id: file path (top-level symbols) or class symbol id (methods)
	// ── Metrics (used for node sizing + badges) ──
	lines?: number; // lines of code (file LOC, or symbol span endLine-line+1)
	// ── Documentation protocol metadata ──
	domain?: string; // @domain tag (e.g., "calculator", "auth", "billing")
	status?: string; // @status tag ("stable" | "wip" | "deprecated")
	author?: string; // @author tag / frontmatter author (shown in hover tooltip)
	tags?: string[]; // note frontmatter tags (enables `tag:` color-group query)
	todoCount?: number; // count of // TODO: comments in this file
	fixmeCount?: number; // count of // FIXME: comments in this file
}

export interface GraphEdge {
	src: string; // source path
	dst: string; // destination path
	type: EdgeType;
	weight: number; // number of underlying relationships aggregated into this edge
}

export interface GraphModel {
	version: number;
	nodes: Record<string, GraphNode>; // keyed by path (files) or path#name (symbols)
	edges: GraphEdge[]; // deduped; same (src, dst, type) collapses with weight
	stats: {
		filesIndexed: number;
		codeFiles: number;
		noteFiles: number;
		symbolNodes: number;
		edgeCount: number;
	};
	builtAt: number;
}

export const GRAPH_MODEL_VERSION = 2;

// NOTE: `EXTENSION_TO_LANG`, `LANG_TO_GRAMMAR`, and `TREE_SITTER_LANGS` used to
// live here as hand-maintained constants. They are now DERIVED from the
// LanguageProfile registry — see `src/indexer/profiles/registry.ts`. Importing
// them from `./indexer/profiles` keeps a single source of truth so the three
// can never drift out of sync.

/**
 * Arrow direction for an edge type — controls which end(s) get an arrowhead in
 * the graph renderer.
 *
 * Convention: edges are stored as `{ src, dst }` where `src` is the active
 * party (the importer / caller / subclass / linker) and `dst` is the passive
 * party (the imported module / definition / parent / target). The arrow encodes
 * that relationship visually:
 *
 *   - `'to'`    → arrowhead at dst. "src depends on / references dst."
 *                 Default for every current type (imports, calls, inherits, …).
 *   - `'from'`  → arrowhead at src. "src is provided to dst" (export-style).
 *                 Use if you ever add an explicit `exports` edge type.
 *   - `'both'`  → arrowheads at both ends. Bidirectional / mutual reference.
 *   - `'none'`  → no arrow. Use for undirected associations.
 *
 * From any single node's perspective, `'to'` already gives you the in/out
 * distinction the UI needs: edges where the node is `src` point OUT (it depends
 * on something), edges where the node is `dst` point IN (something depends on
 * it). So a file that is imported by many others naturally shows many incoming
 * arrows, and a file that imports many others shows many outgoing arrows.
 */
export type EdgeArrow = 'to' | 'from' | 'both' | 'none';

/** Human-readable labels + colors per edge type. Keep in sync with CSS/vis styles. */
export const EDGE_STYLE: Record<
	EdgeType,
	{
		label: string;
		color: string;
		dashes: boolean;
		arrow: EdgeArrow;
		description: string;
		baseWidth: number;
		maxWidth: number;
		roundness: number;
	}
> = {
	imports: {
		label: 'Imports', color: '#7c3aed', dashes: false, arrow: 'to',
		description: 'This file statically imports from another. The foundation of all dependencies — if B breaks, A breaks too.',
		baseWidth: 2, maxWidth: 6, roundness: 0,
	},
	calls: {
		label: 'Calls', color: '#2563eb', dashes: false, arrow: 'to',
		description: 'Code in A references a function/method/class defined in B. Trace runtime flow and impact.',
		baseWidth: 1, maxWidth: 5, roundness: 0.2,
	},
	inherits: {
		label: 'Inherits', color: '#db2777', dashes: true, arrow: 'to',
		description: 'A class/interface extends a type from B. Changes to B propagate to all subclasses.',
		baseWidth: 2.5, maxWidth: 6, roundness: -0.35,
	},
	implements: {
		label: 'Implements', color: '#0d9488', dashes: true, arrow: 'to',
		description: 'A class satisfies an interface contract defined in B. Find all concrete implementations.',
		baseWidth: 2.5, maxWidth: 6, roundness: 0.45,
	},
	contains: {
		label: 'Contains', color: '#94a3b8', dashes: false, arrow: 'none',
		description: 'Structural parent-child: files contain symbols, classes contain methods. Drill into structure.',
		baseWidth: 1, maxWidth: 2, roundness: -0.15,
	},
	'uses-type': {
		label: 'Uses type', color: '#a855f7', dashes: true, arrow: 'to',
		description: 'A symbol references a type annotation from B. Track type dependencies separately.',
		baseWidth: 1, maxWidth: 3, roundness: 0.35,
	},
	'tested-by': {
		label: 'Tested by', color: '#22c55e', dashes: false, arrow: 'to',
		description: 'This code is verified by test file B. Green = tested, no edge = coverage gap.',
		baseWidth: 1.5, maxWidth: 3, roundness: -0.25,
	},
	'adr-link': {
		label: 'ADR link', color: '#eab308', dashes: true, arrow: 'to',
		description: 'This code is governed by architecture decision B. Navigate from code to the "why".',
		baseWidth: 1.5, maxWidth: 3, roundness: 0.1,
	},
	'depends-on': {
		label: 'Depends on', color: '#f97316', dashes: true, arrow: 'to',
		description: 'This code depends on external service or concept B. Track system-level dependencies.',
		baseWidth: 1.5, maxWidth: 4, roundness: -0.45,
	},
	documents: {
		label: 'Documents', color: '#6366f1', dashes: false, arrow: 'to',
		description: 'This note documents code file B (from frontmatter related-code). Bidirectional with @see.',
		baseWidth: 1.5, maxWidth: 3, roundness: 0.3,
	},
	'comment-link': {
		label: 'Comment link', color: '#16a34a', dashes: true, arrow: 'to',
		description: 'A code comment contains a [[wikilink]] or @see pointing to B. Connects code to docs.',
		baseWidth: 1.5, maxWidth: 3, roundness: -0.1,
	},
	'md-link': {
		label: 'Note link', color: '#9ca3af', dashes: true, arrow: 'to',
		description: 'A markdown note links to B via Obsidian link graph. See knowledge-to-code connections.',
		baseWidth: 1.5, maxWidth: 3, roundness: 0.5,
	},
};

/**
 * Community detection via label propagation. Groups nodes that are densely
 * interconnected into "communities" — revealing the natural architecture of
 * the codebase without any configuration. Runs in O(V*E) per iteration.
 *
 * Algorithm:
 * 1. Each node starts in its own community
 * 2. Each iteration, every node adopts the most common label among its neighbors
 * 3. Repeat until stable or max iterations reached
 */
export function detectCommunities(
	edges: GraphEdge[],
	nodeIds: string[],
): Map<string, number> {
	// Build adjacency list (skip 'contains' — structural, not dependency)
	const adj = new Map<string, Set<string>>();
	for (const id of nodeIds) adj.set(id, new Set());
	for (const e of edges) {
		if (e.type === 'contains') continue;
		adj.get(e.src)?.add(e.dst);
		adj.get(e.dst)?.add(e.src);
	}

	// Initialize labels
	const labels = new Map<string, number>();
	for (let i = 0; i < nodeIds.length; i++) {
		labels.set(nodeIds[i]!, i);
	}

	// Iterate label propagation — deterministic order (no random shuffle)
	for (let iter = 0; iter < 15; iter++) {
		let changed = false;
		for (const id of nodeIds) {
			const neighbors = adj.get(id);
			if (!neighbors || neighbors.size === 0) continue;
			const counts = new Map<number, number>();
			for (const n of neighbors) {
				const label = labels.get(n);
				if (label !== undefined) {
					counts.set(label, (counts.get(label) ?? 0) + 1);
				}
			}
			let bestLabel = labels.get(id) ?? 0;
			let bestCount = 0;
			for (const [label, count] of counts) {
				if (count > bestCount || (count === bestCount && label < bestLabel)) {
					bestCount = count;
					bestLabel = label;
				}
			}
			if (bestLabel !== labels.get(id)) {
				labels.set(id, bestLabel);
				changed = true;
			}
		}
		if (!changed) break;
	}

	// Relabel to 0..N-1 for compact color indexing
	const seen = new Map<number, number>();
	let nextId = 0;
	for (const id of nodeIds) {
		const raw = labels.get(id) ?? 0;
		if (!seen.has(raw)) seen.set(raw, nextId++);
		labels.set(id, seen.get(raw)!);
	}

	return labels;
}

/** Deterministic vibrant color for a community index. */
export function communityColor(index: number): string {
	// Golden-angle hue distribution for maximum visual separation
	const hue = (index * 137.508) % 360;
	const sat = 55 + ((index * 37) % 25); // 55-80% saturation
	const light = 48 + ((index * 23) % 14); // 48-62% lightness
	return `hsl(${hue.toFixed(0)}, ${sat}%, ${light}%)`;
}

/** Check if a node matches a color group query string. */
export function matchesColorGroup(
	node: GraphNode,
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return false;
	if (q.startsWith('domain:')) return node.domain === q.slice(7);
	if (q.startsWith('path:')) return node.path.toLowerCase().includes(q.slice(5));
	if (q.startsWith('ext:')) return node.ext === q.slice(4);
	if (q.startsWith('kind:')) return node.kind === q.slice(5);
	if (q.startsWith('status:')) return node.status === q.slice(7);
	if (q.startsWith('tag:')) return node.tags?.includes(q.slice(4)) ?? false;
	// Fallback: substring match on name or path
	return (
		node.name.toLowerCase().includes(q) ||
		node.path.toLowerCase().includes(q)
	);
}

/** Display color per symbol kind — deliberately avoids blue (file nodes are blue). */
export const SYMBOL_COLOR: Record<string, string> = {
	function: '#f59e0b', // amber
	class: '#ef4444', // red
	method: '#10b981', // emerald
	interface: '#a855f7', // purple
	variable: '#84cc16', // lime
	type: '#ec4899', // pink
	enum: '#eab308', // yellow
	constant: '#14b8a6', // teal
};

export const LANG_COLOR: Record<string, string> = {
	typescript: '#3178c6', // TS blue
	tsx: '#0ea5e9', // sky blue — distinct from TS
	javascript: '#f7df1e', // JS yellow
	python: '#3776ab', // Python blue
	css: '#cc6699', // CSS/Sass pink — no longer blue
	c: '#555555',
	cpp: '#00599c',
	go: '#00add8',
	rust: '#dea584',
	java: '#e76f00',
	lua: '#5cc6c1',
	php: '#777bb4',
};
