import {
	type GraphEdge,
	type GraphNode,
	type GraphModel,
	type EdgeType,
	GRAPH_MODEL_VERSION,
	type NodeKind,
	isSymbolKind,
} from '../types';
import type { SymbolKind } from '../indexer/extractor';

/** Accumulate edges, deduping by (src, dst, type) and counting weight. */
export class EdgeAccumulator {
	private map = new Map<string, GraphEdge>();

	private key(src: string, dst: string, type: EdgeType): string {
		return `${src}\u0001${dst}\u0001${type}`;
	}

	add(src: string, dst: string, type: EdgeType): void {
		if (!src || !dst || src === dst) return;
		const k = this.key(src, dst, type);
		const existing = this.map.get(k);
		if (existing) {
			existing.weight += 1;
		} else {
			this.map.set(k, { src, dst, type, weight: 1 });
		}
	}

	addEdge(edge: GraphEdge): void {
		const k = this.key(edge.src, edge.dst, edge.type);
		const existing = this.map.get(k);
		if (existing) {
			existing.weight += edge.weight;
		} else {
			this.map.set(k, { ...edge });
		}
	}

	toArray(): GraphEdge[] {
		return Array.from(this.map.values());
	}
}

export function basenameNoExt(path: string): string {
	const slash = path.lastIndexOf('/');
	const base = slash >= 0 ? path.slice(slash + 1) : path;
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(0, dot) : base;
}

export function makeCodeNode(
	path: string,
	lang: string,
	ext: string,
	lines?: number,
): GraphNode {
	return {
		id: path,
		path,
		name: basenameNoExt(path),
		kind: 'code' satisfies NodeKind,
		lang,
		ext,
		lines,
	};
}

export function makeNoteNode(path: string): GraphNode {
	return {
		id: path,
		path,
		name: basenameNoExt(path),
		kind: 'note' satisfies NodeKind,
	};
}

/**
 * Build a deterministic, unique symbol node ID from its file path and
 * (optionally scoped) name. Format: `{filePath}#{containerName}.{name}` or
 * `{filePath}#{name}` for top-level symbols.
 */
export function symbolNodeId(
	filePath: string,
	name: string,
	containerName?: string,
): string {
	const qualified = containerName ? `${containerName}.${name}` : name;
	return `${filePath}#${qualified}`;
}

/**
 * Create a symbol-level GraphNode. The `parentId` is the containing node's ID
 * (a file path for top-level symbols, or a class symbol ID for methods).
 */
export function makeSymbolNode(
	filePath: string,
	name: string,
	kind: SymbolKind,
	line: number,
	parentId: string,
	containerName?: string,
	endLine?: number,
	lang?: string,
): GraphNode {
	const lines = endLine ? endLine - line + 1 : undefined;
	return {
		id: symbolNodeId(filePath, name, containerName),
		path: filePath,
		name,
		kind,
		line,
		endLine,
		parentId,
		lang,
		lines,
	};
}

/** Assemble a GraphModel from nodes + edges, computing stats. */
export function buildGraphModel(
	nodes: Map<string, GraphNode>,
	edges: GraphEdge[],
): GraphModel {
	let codeFiles = 0;
	let noteFiles = 0;
	let symbolNodes = 0;
	for (const n of nodes.values()) {
		if (isSymbolKind(n.kind)) symbolNodes++;
		else if (n.kind === 'code') codeFiles++;
		else if (n.kind === 'note') noteFiles++;
	}
	return {
		version: GRAPH_MODEL_VERSION,
		nodes: Object.fromEntries(nodes.entries()),
		edges,
		stats: {
			filesIndexed: codeFiles + noteFiles,
			codeFiles,
			noteFiles,
			symbolNodes,
			edgeCount: edges.length,
		},
		builtAt: Date.now(),
	};
}
