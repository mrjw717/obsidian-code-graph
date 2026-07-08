import { describe, it, expect } from 'vitest';
import {
	extractFileTags,
	extractNoteTagsFromFrontmatter,
} from '../src/indexer/tagExtractor';

describe('extractFileTags', () => {
	it('extracts @domain, @status, @author from a block comment header', () => {
		const content = `/**
 * @file Calculator engine — math expression evaluation
 * @domain calculator
 * @status stable
 * @author Josh
 */

export function tokenize(input: string): Token[] { }
`;
		const tags = extractFileTags(content);
		expect(tags.domain).toBe('calculator');
		expect(tags.status).toBe('stable');
		expect(tags.author).toBe('Josh');
		expect(tags.todoCount).toBe(0);
		expect(tags.fixmeCount).toBe(0);
	});

	it('extracts @domain from line comments (# style, Python)', () => {
		const content = `# @file Calculator engine
# @domain calculator
# @status wip
# @author Jane Doe

def tokenize(input):
    pass
`;
		const tags = extractFileTags(content);
		expect(tags.domain).toBe('calculator');
		expect(tags.status).toBe('wip');
		expect(tags.author).toBe('Jane Doe');
	});

	it('extracts @domain from // style comments (Go)', () => {
		const content = `// @file Calculator engine
// @domain calculator
// @status deprecated
// @author Bob

package main
`;
		const tags = extractFileTags(content);
		expect(tags.domain).toBe('calculator');
		expect(tags.status).toBe('deprecated');
		expect(tags.author).toBe('Bob');
	});

	it('counts TODO and FIXME comments', () => {
		const content = `// @domain test
// TODO: fix this
// FIXME: urgent fix
// TODO: another todo
// some regular comment
/* TODO: block comment todo */
`;
		const tags = extractFileTags(content);
		expect(tags.todoCount).toBe(3);
		expect(tags.fixmeCount).toBe(1);
	});

	it('does not count TODO/FIXME in non-comment lines', () => {
		const content = `// @domain test
const TODO = 'todo';
const FIXME = 'fixme';
console.log('TODO FIXME');
`;
		const tags = extractFileTags(content);
		expect(tags.todoCount).toBe(0);
		expect(tags.fixmeCount).toBe(0);
	});

	it('extracts @tested-by, @adr, @depends-on tagged links', () => {
		const content = `/**
 * @domain calculator
 * @tested-by [[engine.test.ts]]
 * @adr [[ADR-001-Architecture]]
 * @depends-on [[DatabaseSchema]]
 */
`;
		const tags = extractFileTags(content);
		expect(tags.taggedLinks).toHaveLength(3);
		expect(tags.taggedLinks[0]).toEqual({
			target: 'engine.test.ts',
			line: 3,
			edgeType: 'tested-by',
		});
		expect(tags.taggedLinks[1]).toEqual({
			target: 'ADR-001-Architecture',
			line: 4,
			edgeType: 'adr-link',
		});
		expect(tags.taggedLinks[2]).toEqual({
			target: 'DatabaseSchema',
			line: 5,
			edgeType: 'depends-on',
		});
	});

	it('extracts multiple tagged links of the same type', () => {
		const content = `/**
 * @see [[Note1]]
 * @see [[Note2]]
 * @tested-by [[test1.ts]]
 * @tested-by [[test2.ts]]
 */
`;
		const tags = extractFileTags(content);
		// @see is not a tagged link (it's a comment-link, handled elsewhere)
		// but @tested-by should produce 2 tagged links
		const testedBy = tags.taggedLinks.filter(
			(t) => t.edgeType === 'tested-by',
		);
		expect(testedBy).toHaveLength(2);
		expect(testedBy[0]!.target).toBe('test1.ts');
		expect(testedBy[1]!.target).toBe('test2.ts');
	});

	it('returns empty tags for empty content', () => {
		const tags = extractFileTags('');
		expect(tags.domain).toBeUndefined();
		expect(tags.status).toBeUndefined();
		expect(tags.author).toBeUndefined();
		expect(tags.todoCount).toBe(0);
		expect(tags.fixmeCount).toBe(0);
		expect(tags.taggedLinks).toHaveLength(0);
	});

	it('lowercases domain and status', () => {
		const content = `// @domain Calculator
// @status STABLE
`;
		const tags = extractFileTags(content);
		expect(tags.domain).toBe('calculator');
		expect(tags.status).toBe('stable');
	});

	it('preserves author case (free-text)', () => {
		const content = `// @author Joshua Williams`;
		const tags = extractFileTags(content);
		expect(tags.author).toBe('Joshua Williams');
	});

	it('does not extract @module or @param (not supported tags)', () => {
		const content = `/**
 * @module organisms
 * @param input - the expression
 * @returns Token[]
 */
`;
		const tags = extractFileTags(content);
		expect(tags.domain).toBeUndefined();
		expect(tags.status).toBeUndefined();
		expect(tags.author).toBeUndefined();
		expect(tags.taggedLinks).toHaveLength(0);
	});
});

describe('extractNoteTagsFromFrontmatter', () => {
	it('extracts domain, status, type, author, tags from frontmatter', () => {
		const fm = {
			domain: 'Calculator',
			status: 'Accepted',
			type: 'ADR',
			author: 'Josh',
			tags: ['calculator', 'architecture', 'core'],
		};
		const tags = extractNoteTagsFromFrontmatter(fm);
		expect(tags?.domain).toBe('calculator');
		expect(tags?.status).toBe('accepted');
		expect(tags?.type).toBe('adr');
		expect(tags?.author).toBe('Josh');
		expect(tags?.tags).toEqual(['calculator', 'architecture', 'core']);
	});

	it('handles tags as a space-separated string', () => {
		const fm = { tags: 'calculator architecture core' };
		const tags = extractNoteTagsFromFrontmatter(fm);
		expect(tags?.tags).toEqual(['calculator', 'architecture', 'core']);
	});

	it('handles tags as a comma-separated string', () => {
		const fm = { tags: 'calculator, architecture, core' };
		const tags = extractNoteTagsFromFrontmatter(fm);
		expect(tags?.tags).toEqual(['calculator', 'architecture', 'core']);
	});

	it('lowercases tags', () => {
		const fm = { tags: ['Calculator', 'ARCHITECTURE'] };
		const tags = extractNoteTagsFromFrontmatter(fm);
		expect(tags?.tags).toEqual(['calculator', 'architecture']);
	});

	it('filters out empty tags', () => {
		const fm = { tags: ['calculator', '', '  ', 'architecture'] };
		const tags = extractNoteTagsFromFrontmatter(fm);
		expect(tags?.tags).toEqual(['calculator', 'architecture']);
	});

	it('returns undefined for empty frontmatter', () => {
		expect(extractNoteTagsFromFrontmatter(undefined)).toBeUndefined();
		expect(extractNoteTagsFromFrontmatter({})).toBeUndefined();
	});

	it('returns undefined when no relevant fields present', () => {
		expect(
			extractNoteTagsFromFrontmatter({ title: 'Some note', position: 1 }),
		).toBeUndefined();
	});

	it('extracts partial frontmatter (only domain)', () => {
		const fm = { domain: 'auth' };
		const tags = extractNoteTagsFromFrontmatter(fm);
		expect(tags?.domain).toBe('auth');
		expect(tags?.status).toBeUndefined();
		expect(tags?.tags).toBeUndefined();
	});

	it('ignores non-string values', () => {
		const fm = {
			domain: 123,
			status: true,
			tags: 'not-an-array',
		};
		// tags as a string should still work
		const tags = extractNoteTagsFromFrontmatter(fm);
		expect(tags?.domain).toBeUndefined();
		expect(tags?.status).toBeUndefined();
		expect(tags?.tags).toEqual(['not-an-array']);
	});
});