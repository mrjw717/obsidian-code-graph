import { describe, expect, it } from 'vitest';
import { collectDeadFileIds, isDeadNode } from '../src/graph/deadCode';
import { makeCodeNode, makeNoteNode, makeSymbolNode } from '../src/graph/model';

const fanIn = (entries: Array<[string, number]>): Map<string, number> => new Map(entries);
const fanOut = (entries: Array<[string, number]>): Map<string, number> => new Map(entries);

describe('isDeadNode (issue #5 dead-code hardening)', () => {
	it('marks a truly orphaned file as dead', () => {
		const file = makeCodeNode('orphan/never_used.py', 'python', 'py');
		expect(isDeadNode(file, fanIn([]), fanOut([]))).toBe(true);
	});

	it('does NOT mark an entry-point file as dead (zero fan-in, has fan-out)', () => {
		const file = makeCodeNode('cli/main.py', 'python', 'py');
		expect(isDeadNode(file, fanIn([]), fanOut([['cli/main.py', 2]]))).toBe(false);
	});

	it('does NOT mark an entry-point file as dead (fan-in only, e.g. pure utility)', () => {
		const file = makeCodeNode('lib/util.py', 'python', 'py');
		expect(isDeadNode(file, fanIn([['lib/util.py', 3]]), fanOut([]))).toBe(false);
	});

	it('keeps a connected file alive', () => {
		const file = makeCodeNode('lib/both.py', 'python', 'py');
		expect(isDeadNode(file, fanIn([['lib/both.py', 1]]), fanOut([['lib/both.py', 1]]))).toBe(false);
	});

	it('marks a symbol dead when its file is orphaned', () => {
		const symbol = makeSymbolNode('orphan/never_used.py', 'helper', 'function', 3, 'orphan/never_used.py');
		expect(isDeadNode(symbol, fanIn([]), fanOut([]))).toBe(true);
	});

	// No FALSE POSITIVES: formerly flagged nodes that are actually reachable.
	it('does NOT flag a symbol inside a file that anything references (entry file)', () => {
		const symbol = makeSymbolNode('cli/main.py', 'main', 'function', 5, 'cli/main.py');
		expect(isDeadNode(symbol, fanIn([]), fanOut([['cli/main.py', 2]]))).toBe(false);
	});

	it('does NOT flag a symbol in a file that is imported (method-call chains)', () => {
		const symbol = makeSymbolNode('web/panel.ts', 'render', 'method', 8, 'web/panel.ts#Panel', 'Panel');
		expect(isDeadNode(symbol, fanIn([]), fanOut([['web/panel.ts', 1]]))).toBe(false);
	});

	it('does NOT flag comment-only or imported notes', () => {
		const note = makeNoteNode('Docs/spec.md');
		expect(isDeadNode(note, fanIn([]), fanOut([]))).toBe(false);
	});

	it('counts any non-contains connectivity as alive even with weight 0-ish entries', () => {
		const file = makeCodeNode('lib/x.py', 'python', 'py');
		expect(isDeadNode(file, fanIn([['lib/x.py', 0]]), fanOut([['lib/x.py', 1]]))).toBe(false);
	});
});

describe('collectDeadFileIds (panel navigator)', () => {
	it('lists only orphaned code files, sorted, ignoring notes and symbols', () => {
		const nodes = {
			'z-orphan/a.py': makeCodeNode('z-orphan/a.py', 'python', 'py'),
			'alive/b.py': makeCodeNode('alive/b.py', 'python', 'py', ),
			'entry/c.ts': makeCodeNode('entry/c.ts', 'typescript', 'ts'),
			'orphan/d.py': makeCodeNode('orphan/d.py', 'python', 'py'),
			notes: makeNoteNode('notes/d.md'),
			sym: makeSymbolNode('orphan/d.py', 'helper', 'function', 1, 'orphan/d.py'),
		};
		const fi = fanIn([['alive/b.py', 1]]);
		const fo = fanOut([['alive/b.py', 1], ['entry/c.ts', 1]]);
		expect(collectDeadFileIds(nodes, fi, fo)).toEqual([
			'orphan/d.py',
			'z-orphan/a.py',
		]);
	});

	it('returns an empty list when everything is connected', () => {
		const nodes = { 'a.py': makeCodeNode('a.py', 'python', 'py') };
		expect(collectDeadFileIds(nodes, fanIn([['a.py', 1]]), fanOut([]))).toEqual([]);
	});
});
