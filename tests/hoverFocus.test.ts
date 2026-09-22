/**
 * @file Regression tests for GitHub issue #1 —
 * "Hovering re-inserts filtered-out nodes as unlabeled phantom nodes
 * (stale nodeBaseSize map)".
 *
 * Reported against Code Graph 1.0.6 (mrjw717/obsidian-code-graph#1):
 * toggling a legend filter (Notes / Code files) correctly removes those
 * nodes from the vis DataSet, but the next hover re-inserted them as bare
 * `{ id, size }` nodes — no label, no tooltip, no edges — because
 * `applyHoverSize()` iterated the never-pruned `nodeBaseSize` map and fed
 * every entry into `DataSet.update()`, which vis-data treats as an UPSERT.
 *
 * The fix has two halves, both locked in here:
 *
 * 1. `buildData()` clears `nodeBaseSize` before repopulating it, so the map
 *    always mirrors exactly the currently-rendered ids.
 * 2. `computeHoverSizeUpdates()` (src/ui/hoverFocus.ts) intersects the map
 *    against the LIVE DataSet ids before emitting updates, so even a stale
 *    map entry can never be upserted back into the graph.
 *
 * Because GraphView itself needs the Electron runtime (vis-network canvas,
 * Obsidian ItemView), these tests exercise the extracted pure core plus a
 * faithful mock of vis-data's upsert semantics. The mirrors of the
 * production wiring are 1:1 with the GraphView call sites and are marked
 * `MIRROR:` so drift is easy to audit.
 */

import { describe, it, expect } from 'vitest';
import {
	computeHoverSizeUpdates,
	focusedBaseSize,
	HOVER_SIZE_FACTOR,
} from '../src/ui/hoverFocus';


// ─────────────────────────────────────────────────────────────────────────
// vis-data stand-in: a DataSet whose update() has the same upsert
// semantics that turned stale ids into phantom nodes.
// ─────────────────────────────────────────────────────────────────────────

/** Minimal node record shape — the fields this bug concerns itself with. */
interface MockNode {
	id: string;
	size?: number;
	label?: string;
	title?: string;
	[x: string]: unknown;
}

/**
 * MIRROR: vis-data DataSet (subset used by GraphView).
 *
 * `update(items)` merges each item into the existing record when the id is
 * present, and INSERTS a brand-new record when it is not — the upsert that
 * resurrects filtered-out ids as bare nodes. That asymmetry is exactly the
 * mechanism from issue #1, so it is reproduced faithfully here.
 */
class MockUpsertDataSet {
	private items = new Map<string, MockNode>();

	constructor(initial: MockNode[] = []) {
		for (const item of initial) {
			this.items.set(item.id, { ...item });
		}
	}

	/** vis-data upsert: patch existing ids, insert unknown ones. */
	update(updates: MockNode[]): void {
		for (const u of updates) {
			const existing = this.items.get(u.id);
			if (existing) {
				Object.assign(existing, u);
			} else {
				this.items.set(u.id, { ...u });
			}
		}
	}

	/** vis-data remove: drop ids that exist, ignore the rest. */
	remove(ids: string[]): void {
		for (const id of ids) this.items.delete(id);
	}

	getIds(): string[] {
		return [...this.items.keys()];
	}

	get(): MockNode[] {
		return [...this.items.values()].map((v) => ({ ...v }));
	}

	getItem(id: string): MockNode | undefined {
		const item = this.items.get(id);
		return item ? { ...item } : undefined;
	}

	get size(): number {
		return this.items.size;
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Mirrors of the production wiring in GraphView. Each is 1:1 with the
// corresponding private method — if GraphView changes, update here too.
// ─────────────────────────────────────────────────────────────────────────

/**
 * MIRROR: buildData()'s node loop + updateVisible()'s dataset diff.
 * Simulates one render pass with `visibleIds` as the filter output:
 * 1. nodeBaseSize.clear()            → the ROOT FIX (buildData, pre-loop)
 * 2. nodeBaseSize.set(id, sz)        → per rendered node
 * 3. nodeDS.remove(gone)             → updateVisible diff
 * 4. nodeDS.update(current nodes)    → updateVisible diff
 */
function renderPass(
	ds: MockUpsertDataSet,
	nodeBaseSize: Map<string, number>,
	visibleIds: readonly string[],
): void {
	// ROOT FIX (issue #1): map must mirror exactly this render's ids.
	nodeBaseSize.clear();
	const nodes: MockNode[] = [];
	for (const id of visibleIds) {
		const sz = 10 + id.length; // stand-in for sizeFor(n)
		nodeBaseSize.set(id, sz);
		nodes.push({ id, size: sz, label: `label:${id}`, title: `title:${id}` });
	}
	const newIds = new Set(visibleIds);
	ds.remove(ds.getIds().filter((id) => !newIds.has(id)));
	ds.update(nodes);
}

/**
 * MIRROR: applyHoverSize() — the fixed version.
 * Delegates to computeHoverSizeUpdates with the LIVE dataset ids.
 */
function hoverPass(
	ds: MockUpsertDataSet,
	nodeBaseSize: ReadonlyMap<string, number>,
	focusedId: string | null | undefined,
): void {
	const updates = computeHoverSizeUpdates(
		nodeBaseSize,
		ds.getIds(),
		focusedId,
	);
	if (updates.length > 0) ds.update(updates as MockNode[]);
}

/**
 * The pre-fix (1.0.6) applyHoverSize body, verbatim in spirit: iterate the
 * whole map, no liveness check. Used ONLY to prove the harness detects the
 * bug — if this stops producing phantoms, the reproduction tests are broken.
 */
function legacyUnguardedHoverPass(
	ds: MockUpsertDataSet,
	nodeBaseSize: ReadonlyMap<string, number>,
	focusedId: string | null | undefined,
): void {
	const updates: MockNode[] = [];
	for (const [id, base] of nodeBaseSize) {
		const want = id === focusedId ? base * 1.3 : base;
		updates.push({ id, size: want });
	}
	if (updates.length > 0) ds.update(updates);
}

/** Stand-in for the filter stage: which ids survive the legend toggles. */
function applyFilters(
	allIds: readonly string[],
	opts: { showNotes: boolean; showCode: boolean },
): string[] {
	return allIds.filter((id) =>
		id.startsWith('note:') ? opts.showNotes : opts.showCode,
	);
}

/** Deterministic mini-vault mirroring the reporter's mixed repo. */
function makeVault(): { codeIds: string[]; noteIds: string[]; allIds: string[] } {
	const codeIds = ['code:alpha.py', 'code:beta.py', 'code:gamma.py'];
	const noteIds = ['note:ADR-001.md', 'note:README.md'];
	return { codeIds, noteIds, allIds: [...codeIds, ...noteIds] };
}

/** A node is a "phantom" iff it lost its label/title — the reported symptom. */
function phantomIds(ds: MockUpsertDataSet): string[] {
	return ds
		.get()
		.filter((n) => n.label === undefined || n.title === undefined)
		.map((n) => n.id);
}

// ─────────────────────────────────────────────────────────────────────────
// Issue #1 reproduction — end-to-end scenario at the extracted seam.
// ─────────────────────────────────────────────────────────────────────────

describe('issue #1 reproduction: hover must not resurrect filtered-out nodes', () => {
	it('toggling Notes off then hovering does not re-insert note nodes (the exact reported scenario)', () => {
		const { allIds, codeIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();

		// Render 1: defaults — Notes + Code files both on (all nodes visible).
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));
		expect(ds.getIds().sort()).toEqual([...allIds].sort());
		expect(ds.size).toBe(allIds.length);

		// Render 2: user toggles "Notes" off in the legend → notes removed.
		const visible = applyFilters(allIds, { showNotes: false, showCode: true });
		renderPass(ds, nodeBaseSize, visible);
		expect(ds.getIds().sort()).toEqual([...codeIds].sort());

		// Hover any remaining node — the reported trigger.
		hoverPass(ds, nodeBaseSize, 'code:alpha.py');

		// The heart of the issue: no note id may reappear, and every node
		// must still carry label + title (a bare {id,size} node = phantom).
		expect(ds.getIds().sort()).toEqual([...codeIds].sort());
		expect(phantomIds(ds)).toEqual([]);
	});

	it('toggling Code files off then hovering does not re-insert code nodes', () => {
		const { allIds, noteIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();

		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));
		const visible = applyFilters(allIds, { showNotes: true, showCode: false });
		renderPass(ds, nodeBaseSize, visible);

		hoverPass(ds, nodeBaseSize, 'note:README.md');

		expect(ds.getIds().sort()).toEqual([...noteIds].sort());
		expect(phantomIds(ds)).toEqual([]);
	});

	it('hovering with NO focused node (restore pass) leaves the visible set untouched', () => {
		const { allIds, codeIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: false, showCode: true }));

		const before = ds.get();
		hoverPass(ds, nodeBaseSize, null);
		hoverPass(ds, nodeBaseSize, undefined);

		expect(ds.getIds().sort()).toEqual([...codeIds].sort());
		expect(ds.get()).toEqual(before);
	});

	it('the hovered node pops to exactly 1.3x its base size; peers keep base size', () => {
		const { allIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));

		hoverPass(ds, nodeBaseSize, 'code:alpha.py');

		const alphaBase = nodeBaseSize.get('code:alpha.py')!;
		expect(ds.getItem('code:alpha.py')!.size).toBeCloseTo(alphaBase * 1.3, 10);
		expect(ds.getItem('code:beta.py')!.size).toBe(nodeBaseSize.get('code:beta.py')!);
		expect(ds.getItem('note:ADR-001.md')!.size).toBe(nodeBaseSize.get('note:ADR-001.md')!);
	});

	it('re-enabling the filter restores the nodes with full data (no stale-map residue)', () => {
		const { allIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();

		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: false, showCode: true }));
		hoverPass(ds, nodeBaseSize, 'code:alpha.py');

		// Toggle Notes back on and hover again.
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));
		hoverPass(ds, nodeBaseSize, 'note:README.md');

		expect(ds.getIds().sort()).toEqual([...allIds].sort());
		expect(phantomIds(ds)).toEqual([]);
		// Sizes must track the CURRENT render, not leftovers. The focused
		// node legitimately keeps its 1.3x hover pop.
		for (const id of allIds) {
			const expectedBase = nodeBaseSize.get(id)!;
			const expected =
				id === 'note:README.md'
					? expectedBase * HOVER_SIZE_FACTOR
					: expectedBase;
			expect(ds.getItem(id)!.size).toBeCloseTo(expected, 10);
		}
	});

	it('repeated hovers over many nodes never mutate the visible id set', () => {
		const { allIds, codeIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: false, showCode: true }));

		for (const id of allIds) {
			hoverPass(ds, nodeBaseSize, id);
			expect(ds.getIds().sort()).toEqual([...codeIds].sort());
			expect(phantomIds(ds)).toEqual([]);
		}
	});

	it('mirrors the reporter vault scale (84 code files + 51 notes) deterministically', () => {
		const codeIds = Array.from({ length: 84 }, (_, i) => `code:mod_${i}.py`);
		const noteIds = Array.from({ length: 51 }, (_, i) => `note:Note_${i}.md`);
		const allIds = [...codeIds, ...noteIds];
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();

		// Reporter's settings: showCodeFiles false → only notes visible.
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: false }));
		expect(ds.size).toBe(51);

		hoverPass(ds, nodeBaseSize, 'note:Note_0.md');

		expect(ds.size).toBe(51);
		expect(ds.getIds().every((id) => id.startsWith('note:'))).toBe(true);
		expect(phantomIds(ds)).toEqual([]);
	});

	it('filtered-out nodes stay excluded regardless of "hide isolated" (phantoms bypassed it pre-fix)', () => {
		// Pre-fix, phantoms were inserted AFTER the filtering stage, so the
		// "hide isolated" option never applied to them. Post-fix they are
		// never inserted at all, so the invariant is trivially preserved:
		// the post-hover dataset equals the post-filter dataset.
		const { allIds, codeIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();
		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));
		const postFilterIds = applyFilters(allIds, { showNotes: false, showCode: true });
		renderPass(ds, nodeBaseSize, postFilterIds);

		hoverPass(ds, nodeBaseSize, 'code:beta.py');

		expect([...ds.getIds()].sort()).toEqual([...postFilterIds].sort());
		expect([...ds.getIds()].sort()).toEqual([...codeIds].sort());
	});
});

// ─────────────────────────────────────────────────────────────────────────
// Harness sensitivity: the pre-fix logic MUST produce the bug here.
// If these ever fail, the reproduction tests above prove nothing.
// ─────────────────────────────────────────────────────────────────────────

describe('harness sensitivity: legacy unguarded hover pass reproduces the phantom mechanism', () => {
	it('the 1.0.6 code path DOES re-insert filtered-out notes as bare unlabeled nodes', () => {
		const { allIds, codeIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();

		// Simulate 1.0.6's buildData: populate WITHOUT clearing (the stale
		// map that caused the bug), then diff the dataset (which was correct
		// pre-fix — only the size pass reintroduced the ids).
		for (const id of allIds) nodeBaseSize.set(id, 10 + id.length);
		const visible = applyFilters(allIds, { showNotes: false, showCode: true });
		const newIds = new Set(visible);
		ds.remove(ds.getIds().filter((id) => !newIds.has(id)));
		ds.update(visible.map((id) => ({ id, size: nodeBaseSize.get(id)!, label: `label:${id}`, title: `title:${id}` })));
		expect(ds.getIds().sort()).toEqual([...codeIds].sort());

		// Hover through the OLD unguarded pass.
		legacyUnguardedHoverPass(ds, nodeBaseSize, 'code:alpha.py');

		// …and the reported symptoms manifest: notes are back, bare.
		const phantoms = phantomIds(ds);
		expect(phantoms.sort()).toEqual(['note:ADR-001.md', 'note:README.md']);
		expect(ds.getIds().sort()).toEqual([...allIds].sort());
		// The resurrected note is bare: id + size only — no label, no title.
		const phantom = ds.getItem('note:README.md');
		expect(phantom).toBeDefined();
		expect(phantom!.label).toBeUndefined();
		expect(phantom!.title).toBeUndefined();
		expect(typeof phantom!.size).toBe('number');
	});
});

// ─────────────────────────────────────────────────────────────────────────
// Unit tests: computeHoverSizeUpdates (the structural fix).
// ─────────────────────────────────────────────────────────────────────────

describe('computeHoverSizeUpdates', () => {
	const base = new Map<string, number>([
		['a', 10],
		['b', 20],
		['c', 30.5],
	]);
	const live = ['a', 'b', 'c'];

	it('scales ONLY the focused node by exactly 1.3x and leaves peers at base size', () => {
		const updates = computeHoverSizeUpdates(base, live, 'b');
		expect(updates).toEqual([
			{ id: 'a', size: 10 },
			{ id: 'b', size: 20 * 1.3 },
			{ id: 'c', size: 30.5 },
		]);
	});

	it('uses the exported HOVER_SIZE_FACTOR (must stay in sync with the halo)', () => {
		expect(HOVER_SIZE_FACTOR).toBe(1.3);
	});

	it('with no focus, emits plain base sizes for every live id', () => {
		expect(computeHoverSizeUpdates(base, live, null)).toEqual([
			{ id: 'a', size: 10 },
			{ id: 'b', size: 20 },
			{ id: 'c', size: 30.5 },
		]);
		expect(computeHoverSizeUpdates(base, live, undefined)).toEqual(
			computeHoverSizeUpdates(base, live, null),
		);
	});

	it('SKIPS stale ids that are not in the live set — the issue #1 invariant', () => {
		const stale = new Map<string, number>([
			['a', 10],
			['ghost-note', 99],
			['b', 20],
		]);
		const updates = computeHoverSizeUpdates(stale, ['a', 'b'], null);
		expect(updates.map((u) => u.id).sort()).toEqual(['a', 'b']);
		expect(updates.some((u) => u.id === 'ghost-note')).toBe(false);
	});

	it('returns [] for an empty size map (skip-the-update contract)', () => {
		expect(computeHoverSizeUpdates(new Map(), live, 'a')).toEqual([]);
	});

	it('returns [] when the live set is empty (everything filtered out)', () => {
		expect(computeHoverSizeUpdates(base, [], 'a')).toEqual([]);
		expect(computeHoverSizeUpdates(base, new Set<string>(), null)).toEqual([]);
	});

	it('does not emit a special update for a focused id that is not live', () => {
		const updates = computeHoverSizeUpdates(base, ['a', 'b'], 'c');
		expect(updates.map((u) => u.id).sort()).toEqual(['a', 'b']);
		expect(updates.every((u) => u.size !== 30.5 * 1.3)).toBe(true);
	});

	it('preserves exact fractional base sizes without rounding', () => {
		const sizes = new Map<string, number>([['x', 7.777777]]);
		const updates = computeHoverSizeUpdates(sizes, ['x'], 'x');
		expect(updates[0]!.size).toBeCloseTo(7.777777 * 1.3, 12);
	});

	it('emits exactly one update per live map entry — no duplicates', () => {
		const updates = computeHoverSizeUpdates(base, live, 'a');
		const ids = updates.map((u) => u.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.sort()).toEqual(['a', 'b', 'c']);
	});

	it('preserves map iteration order for deterministic update batches', () => {
		const updates = computeHoverSizeUpdates(base, live, null);
		expect(updates.map((u) => u.id)).toEqual(['a', 'b', 'c']);
	});

	it('accepts any iterable of live ids (Set, array, generator)', () => {
		const asSet = computeHoverSizeUpdates(base, new Set(live), null);
		const asArray = computeHoverSizeUpdates(base, live, null);
		const asGen = computeHoverSizeUpdates(
			base,
			(function* () { yield* live; })(),
			null,
		);
		expect(asSet).toEqual(asArray);
		expect(asGen).toEqual(asArray);
	});

	it('is pure: never mutates the size map nor the live set', () => {
		const snapshot = new Map(base);
		const liveSet = new Set(live);
		computeHoverSizeUpdates(base, liveSet, 'a');
		expect(base).toEqual(snapshot);
		expect([...liveSet]).toEqual(live);
	});

	it('scales a large graph without touching filtered-out ids', () => {
		const big = new Map<string, number>();
		for (let i = 0; i < 500; i++) big.set(`n${i}`, i + 1);
		const liveSet = new Set(Array.from({ length: 300 }, (_, i) => `n${i}`));
		const updates = computeHoverSizeUpdates(big, liveSet, 'n42');
		expect(updates).toHaveLength(300);
		expect(updates.every((u) => typeof u.id === 'string' && liveSet.has(u.id))).toBe(true);
		const focused = updates.find((u) => u.id === 'n42')!;
		expect(focused.size).toBeCloseTo(43 * 1.3, 10);
	});
});

// ─────────────────────────────────────────────────────────────────────────
// Unit tests: focusedBaseSize (halo lookup).
// ─────────────────────────────────────────────────────────────────────────

describe('focusedBaseSize', () => {
	const sizes = new Map<string, number>([['a', 12]]);

	it('returns the mapped base size for a known focused id', () => {
		expect(focusedBaseSize(sizes, 'a')).toBe(12);
	});

	it('falls back to 15 for an unknown id (pre-fix halo behavior)', () => {
		expect(focusedBaseSize(sizes, 'ghost')).toBe(15);
	});

	it('honors a custom fallback', () => {
		expect(focusedBaseSize(sizes, 'ghost', 8)).toBe(8);
	});

	it('falls back when there is no focus at all', () => {
		expect(focusedBaseSize(sizes, null)).toBe(15);
		expect(focusedBaseSize(sizes, undefined)).toBe(15);
	});
});

// ─────────────────────────────────────────────────────────────────────────
// Render-pass invariant: nodeBaseSize mirrors the rendered set.
// (The root fix — buildData()'s clear() — expressed at the harness level.)
// ─────────────────────────────────────────────────────────────────────────

describe('renderPass invariant: nodeBaseSize tracks exactly the rendered ids', () => {
	it('drops entries for ids that were filtered out after a render', () => {
		const { allIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();

		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: true, showCode: true }));
		expect([...nodeBaseSize.keys()].sort()).toEqual([...allIds].sort());

		renderPass(ds, nodeBaseSize, applyFilters(allIds, { showNotes: false, showCode: true }));
		expect([...nodeBaseSize.keys()].every((id) => !id.startsWith('note:'))).toBe(true);
		expect(nodeBaseSize.size).toBe(3);
	});

	it('keeps map keys and dataset ids identical after every render+hover cycle', () => {
		const { allIds } = makeVault();
		const ds = new MockUpsertDataSet();
		const nodeBaseSize = new Map<string, number>();

		const filterStates = [
			{ showNotes: true, showCode: true },
			{ showNotes: false, showCode: true },
			{ showNotes: true, showCode: false },
			{ showNotes: true, showCode: true },
		];
		for (const state of filterStates) {
			renderPass(ds, nodeBaseSize, applyFilters(allIds, state));
			hoverPass(ds, nodeBaseSize, ds.getIds()[0] ?? null);
			expect([...nodeBaseSize.keys()].sort()).toEqual([...ds.getIds()].sort());
			expect(phantomIds(ds)).toEqual([]);
		}
	});
});
