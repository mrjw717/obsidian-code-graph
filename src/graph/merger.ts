import type { GraphNode, GraphEdge, GraphModel } from '../types';
import { buildGraphModel, EdgeAccumulator } from './model';

/**
 * Combine extracted code edges with markdown link edges (from
 * metadataCache.resolvedLinks) into the final GraphModel.
 *
 * Pruning: every code file is kept (orphans are informative); note/other nodes
 * are only kept if they touch at least one edge, to keep the graph focused.
 */
export function mergeWithMdLinks(
	nodes: Map<string, GraphNode>,
	codeEdges: GraphEdge[],
	resolvedLinks: Record<string, Record<string, number>>,
	includeMdLinks: boolean,
): GraphModel {
	const acc = new EdgeAccumulator();
	for (const e of codeEdges) acc.addEdge(e);

	if (includeMdLinks) {
		for (const src of Object.keys(resolvedLinks)) {
			if (!nodes.has(src)) continue;
			const dests = resolvedLinks[src];
			if (!dests) continue;
			for (const dst of Object.keys(dests)) {
				if (!nodes.has(dst)) continue;
				const count = dests[dst];
				if (count && count > 0) acc.add(src, dst, 'md-link');
			}
		}
	}

	const edges = acc.toArray();

	const connected = new Set<string>();
	for (const e of edges) {
		connected.add(e.src);
		connected.add(e.dst);
	}

	const pruned = new Map<string, GraphNode>();
	for (const [id, node] of nodes) {
		if (node.kind === 'code' || connected.has(id)) {
			pruned.set(id, node);
		}
	}

	return buildGraphModel(pruned, edges);
}
