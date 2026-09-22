/**
 * @file Hover-focus size updates — the pure core of GraphView's hover "pop".
 *
 * When a node is hovered (or focus-locked via right-click "Find callers /
 * callees"), the focused node pops to 1.3× its base size while every other
 * node returns to its base size. The base sizes live in GraphView's
 * `nodeBaseSize` map, which `buildData()` rebuilds from scratch on every
 * render so that it always mirrors exactly the nodes currently present in
 * the vis-network DataSet.
 *
 * **Why this module exists (issue #1 regression guard):** `nodeBaseSize`
 * used to be populated without ever being pruned, and the hover pass fed
 * every map entry into `DataSet.update()` — an upsert in vis-data. After a
 * filter toggle (e.g. hiding "Notes" in the legend), ids left over from the
 * previous render were re-inserted as brand-new bare `{ id, size }` nodes:
 * no label, no tooltip, no edges — unlabeled "phantom" dots that ignored
 * "hide isolated" because they bypassed the filtering stage entirely.
 *
 * This helper is the single choke point for the size pass. It intersects
 * the size map against the *live* DataSet ids before producing updates, so
 * it is structurally incapable of resurrecting a filtered-out node, even if
 * a caller forgets to prune the map. Keep it pure (no obsidian / vis-network
 * / DOM imports) so the invariant stays unit-testable.
 */

import type { Node as VisNode } from 'vis-network/standalone';

/**
 * Ratio applied to the focused node's base size during hover focus.
 * Must stay in sync with GraphView's halo rendering (inner glow radius).
 */
export const HOVER_SIZE_FACTOR = 1.3;

/**
 * Compute the vis-network node updates that realize the hover-size pop.
 *
 * Only ids present in `liveIds` (the ids currently held by the vis DataSet)
 * produce an update. Entries in `nodeBaseSize` that are not live — stale
 * ids from a previous filter state — are skipped instead of being upserted.
 *
 * @param nodeBaseSize Base (un-focused) size per node id, as rebuilt by
 *   `buildData()`. Read-only: never mutated here.
 * @param liveIds Ids of the nodes currently in the vis DataSet
 *   (`nodeDS.getIds()`). Anything not in this set must not be touched.
 * @param focusedId The hovered / focus-locked node, or null/undefined when
 *   no node is focused (the "restore all sizes" pass).
 * @returns Minimal list of `{ id, size }` updates. Empty when there is
 *   nothing to do — callers should skip the `DataSet.update()` call in that
 *   case, since even an empty-op update triggers vis-network's diff.
 */
export function computeHoverSizeUpdates(
	nodeBaseSize: ReadonlyMap<string, number>,
	liveIds: Iterable<string>,
	focusedId: string | null | undefined,
): VisNode[] {
	const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
	const updates: VisNode[] = [];
	for (const [id, base] of nodeBaseSize) {
		if (!live.has(id)) continue;
		const size = id === focusedId ? base * HOVER_SIZE_FACTOR : base;
		updates.push({ id, size });
	}
	return updates;
}

/**
 * Resolve the base size of the focused node for halo drawing.
 *
 * Mirrors GraphView's halo loop: a focused node is always live (you can
 * only hover a rendered node), but the map lookup still needs a fallback
 * for the frame where focus lands before `buildData()` has run. Returns
 * `fallback` for ids that are not in the map.
 */
export function focusedBaseSize(
	nodeBaseSize: ReadonlyMap<string, number>,
	focusedId: string | null | undefined,
	fallback = 15,
): number {
	if (!focusedId) return fallback;
	return nodeBaseSize.get(focusedId) ?? fallback;
}
