/**
 * Dead-code highlight semantics, extracted from the view so it can be unit
 * tested. "Dead" is intentionally conservative — false positives erased all
 * trust in the red ring (see issue #5):
 *
 * - `note` nodes are never dead.
 * - A FILE is dead only when it has zero incoming AND zero outgoing edges.
 *   Zero fan-in alone marked every entry point (scripts, CLI roots, top-level
 *   stylesheets) as dead even though they reach out and run constantly.
 * - A SYMBOL inherits its file's state. Symbol-level call resolution can miss
 *   or misattribute method-call chains (`new Popup().render()`), so an
 *   isolated symbol inside a file that something references is treated as
 *   reachable until evidence says otherwise.
 *
 * `contains` edges are intentionally excluded upstream from fanIn/fanOut
 * (structural file→symbol wiring, not reachability).
 */
import type { GraphNode } from '../types';

export type FanMap = ReadonlyMap<string, number>;

export function isDeadNode(node: GraphNode, fanIn: FanMap, fanOut: FanMap): boolean {
	if (node.kind === 'note') return false;
	const filePath = node.path ?? node.id;
	const hasIncoming = (fanIn.get(filePath) ?? 0) > 0;
	const hasOutgoing = (fanOut.get(filePath) ?? 0) > 0;
	return !hasIncoming && !hasOutgoing;
}
