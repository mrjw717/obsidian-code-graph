import { describe, expect, it } from 'vitest';
import { buildNameIndex, findContainingSymbol, resolveLinkTarget } from '../src/indexer/resolver';

describe('resolver regression cases', () => {
	it('resolves ambiguous names consistently regardless of file order', () => {
		const paths = ['z/Foo.md', 'a/Foo.md', 'Foo.ts'];
		const resolve = (items: string[]) => resolveLinkTarget('Foo', buildNameIndex(items), new Set(items));
		expect(resolve(paths)).toBe('a/Foo.md');
		expect(resolve([...paths].reverse())).toBe('a/Foo.md');
	});

	it('does not treat an unknown end line as extending to the end of the file', () => {
		const defs = [{ name: 'f', kind: 'function' as const, line: 1 }];
		expect(findContainingSymbol(defs, 10)).toBeNull();
		expect(findContainingSymbol([{ ...defs[0]!, endLine: 5 }], 5)?.name).toBe('f');
		expect(findContainingSymbol([{ ...defs[0]!, endLine: 5 }], 6)).toBeNull();
	});
});
