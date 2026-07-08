/**
 * @file Self-evolving clustering for large code graphs.
 *
 * Clusters derive from the graph itself — folder structure and community
 * detection — NOT from hardcoded rules. Two strategies, both driven by data:
 *
 * 1. **Folder aggregation**: group nodes by their top-level folder path. This
 *    is the Obsidian-native-graph / yFiles approach: compound meta-nodes that
 *    expand on demand. Uses `network.cluster()` with `joinCondition` so
 *    shared neighbors aren't swallowed.
 *
 * 2. **Community clustering**: wire the already-computed label-propagation
 *    communities (from `detectCommunities()`) to `network.cluster()`. Each
 *    community becomes a cluster.
 *
 * Both use `openCluster` for expand-on-demand (already wired in the
 * doubleClick handler).
 */

import type { Network } from 'vis-network/standalone';
import type { GraphModel, GraphNode } from '../types';

/** Determine the folder key for a node — the top-level folder under root. */
export function folderKey(node: GraphNode): string {
	const segments = node.path.split('/').filter((s) => s.length > 0);
	// Files at root level → "root" pseudo-folder
	if (segments.length <= 1) return 'root';
	// Group by the first path segment (top-level folder)
	return segments[0] ?? 'root';
}

/**
 * Apply folder-based aggregation clustering. Groups nodes by their top-level
 * folder into cluster meta-nodes. Uses `joinCondition` on a `folder` property
 * stamped onto each vis node so only same-folder nodes cluster together
 * (shared neighbors in other folders stay visible).
 *
 * Only activates above a node-count threshold — small graphs don't need it.
 */
export function applyFolderClustering(
	network: Network,
	model: GraphModel,
	visibleNodeIds: Set<string>,
	minNodes: number,
): number {
	if (visibleNodeIds.size < minNodes) return 0;

	// Stamp a `folder` property on each visible node so joinCondition can read it.
	// vis-network cluster() reads from node OPTIONS (the properties on the vis
	// node object), not from the graph model. We need to add a custom property.
	const body = (
		network as unknown as {
			body: { nodes: Record<string, { options: Record<string, unknown> }> };
		}
	).body;

	// Group node IDs by folder
	const folderGroups = new Map<string, string[]>();
	for (const id of visibleNodeIds) {
		const node = model.nodes[id];
		if (!node) continue;
		const folder = folderKey(node);
		let group = folderGroups.get(folder);
		if (!group) {
			group = [];
			folderGroups.set(folder, group);
		}
		group.push(id);
	}

	let clusterCount = 0;
	for (const [folder, ids] of folderGroups) {
		// Only cluster folders with enough nodes to be worth it
		if (ids.length < 5) continue;

		// Stamp folder property on the vis nodes so joinCondition can read it
		for (const id of ids) {
			const visNode = body.nodes[id];
			if (visNode) {
				visNode.options.folder = folder;
			}
		}

		try {
			network.cluster({
				joinCondition: (nodeOptions: Record<string, unknown>) => {
					return nodeOptions.folder === folder;
				},
				processProperties: (
					clusterOptions: { label: string; size: number },
					childNodes: unknown[],
				) => {
					clusterOptions.label = `${folder} (${childNodes.length})`;
					clusterOptions.size = Math.max(
						30,
						Math.min(80, 20 + childNodes.length * 2),
					);
					return clusterOptions;
				},
				clusterNodeProperties: {
					shape: 'dot',
					color: {
						background: 'rgba(100, 116, 139, 0.15)',
						border: 'rgba(148, 163, 184, 0.5)',
					},
					borderWidth: 2,
					font: {
						color: '#94a3b8',
						size: 14,
						background: 'rgba(0, 0, 0, 0.4)',
						strokeWidth: 0,
					},
				},
			});
			clusterCount++;
		} catch {
			// node may already be clustered
		}
	}
	return clusterCount;
}

/**
 * Apply community-based clustering using pre-computed label propagation
 * labels. Each community (label) becomes a cluster. This is self-evolving —
 * the communities are detected from edge density, not hardcoded.
 *
 * Uses `joinCondition` on a `community` property stamped onto each vis node.
 */
export function applyCommunityClustering(
	network: Network,
	model: GraphModel,
	visibleNodeIds: Set<string>,
	communityLabels: Map<string, number>,
	minNodes: number,
): number {
	if (visibleNodeIds.size < minNodes) return 0;

	const body = (
		network as unknown as {
			body: { nodes: Record<string, { options: Record<string, unknown> }> };
		}
	).body;

	// Group node IDs by community label
	const communityGroups = new Map<number, string[]>();
	for (const id of visibleNodeIds) {
		const label = communityLabels.get(id);
		if (label === undefined) continue;
		let group = communityGroups.get(label);
		if (!group) {
			group = [];
			communityGroups.set(label, group);
		}
		group.push(id);
	}

	let clusterCount = 0;
	for (const [label, ids] of communityGroups) {
		// Only cluster communities with enough nodes
		if (ids.length < 5) continue;

		// Stamp community property on vis nodes
		for (const id of ids) {
			const visNode = body.nodes[id];
			if (visNode) {
				visNode.options.community = label;
			}
		}

		try {
			network.cluster({
				joinCondition: (nodeOptions: Record<string, unknown>) => {
					return nodeOptions.community === label;
				},
				processProperties: (
					clusterOptions: { label: string; size: number },
					childNodes: unknown[],
				) => {
					clusterOptions.label = `Cluster ${label} (${childNodes.length})`;
					clusterOptions.size = Math.max(
						30,
						Math.min(80, 20 + childNodes.length * 2),
					);
					return clusterOptions;
				},
				clusterNodeProperties: {
					shape: 'dot',
					color: {
						background: 'rgba(139, 92, 246, 0.12)',
						border: 'rgba(139, 92, 246, 0.4)',
					},
					borderWidth: 2,
					font: {
						color: '#a78bfa',
						size: 14,
						background: 'rgba(0, 0, 0, 0.4)',
						strokeWidth: 0,
					},
				},
			});
			clusterCount++;
		} catch {
			// node may already be clustered
		}
	}
	return clusterCount;
}