import { describe, it, expect } from 'vitest';
import { stampCodeHeader } from '../src/commands/seedDomains';

describe('stampCodeHeader — idempotency', () => {
	it('is idempotent: stamping twice produces identical output', () => {
		const original = `import { foo } from './foo';

export function bar() { return foo(); }
`;
		const stamped1 = stampCodeHeader(original, 'Bar module', 'utils', 'stable');
		const stamped2 = stampCodeHeader(stamped1, 'Bar module', 'utils', 'stable');
		expect(stamped2).toBe(stamped1);
	});

	it('is idempotent when a header already exists with matching tags', () => {
		const original = `/**
 * @file Bar module
 * @domain utils
 * @status stable
 */

export function bar() {}
`;
		const result = stampCodeHeader(original, 'Bar module', 'utils', 'stable');
		expect(result).toBe(original);
	});

	it('is idempotent after updating tags to new values', () => {
		const original = `/**
 * @file Old desc
 * @domain old-domain
 * @status wip
 */

export function bar() {}
`;
		const stamped1 = stampCodeHeader(original, 'New desc', 'new-domain', 'stable');
		const stamped2 = stampCodeHeader(stamped1, 'New desc', 'new-domain', 'stable');
		expect(stamped2).toBe(stamped1);
		// Verify the tags were actually updated
		expect(stamped1).toContain('@domain new-domain');
		expect(stamped1).toContain('@status stable');
	});
});

describe('stampCodeHeader — preserves non-Tier-1 tags', () => {
	it('preserves @see, @tested-by, @adr, @depends-on, [[wikilinks]]', () => {
		const original = `/**
 * @file Old desc
 * @domain old-domain
 * @status wip
 * @see [[Architecture]]
 * @tested-by [[bar.test.ts]]
 * @adr [[ADR-001]]
 * @depends-on [[Database]]
 * @author Josh
 */

export function bar() {}
`;
		const stamped = stampCodeHeader(original, 'New desc', 'new-domain', 'stable');

		// Tier-1 tags updated
		expect(stamped).toContain('@file New desc');
		expect(stamped).toContain('@domain new-domain');
		expect(stamped).toContain('@status stable');

		// Non-Tier-1 tags preserved
		expect(stamped).toContain('@see [[Architecture]]');
		expect(stamped).toContain('@tested-by [[bar.test.ts]]');
		expect(stamped).toContain('@adr [[ADR-001]]');
		expect(stamped).toContain('@depends-on [[Database]]');
		expect(stamped).toContain('@author Josh');
	});

	it('preserves code content after the header', () => {
		const original = `/**
 * @domain old
 * @status wip
 */

export function bar() {
	return 42;
}
`;
		const stamped = stampCodeHeader(original, 'Bar', 'new', 'stable');
		expect(stamped).toContain('export function bar() {');
		expect(stamped).toContain('return 42;');
	});
});

describe('stampCodeHeader — header creation', () => {
	it('prepends a block comment header when none exists', () => {
		const original = `export function bar() { return 42; }
`;
		const stamped = stampCodeHeader(original, 'Bar module', 'utils', 'stable');
		expect(stamped.startsWith('/**')).toBe(true);
		expect(stamped).toContain('@file Bar module');
		expect(stamped).toContain('@domain utils');
		expect(stamped).toContain('@status stable');
		// Original content preserved after header
		expect(stamped).toContain('export function bar() { return 42; }');
	});
});

describe('stampCodeHeader — tag insertion in existing block', () => {
	it('inserts missing tags into an existing block comment', () => {
		const original = `/**
 * @file Some file
 * @author Josh
 */

export function foo() {}
`;
		const stamped = stampCodeHeader(original, 'Some file', 'auth', 'stable');
		expect(stamped).toContain('@domain auth');
		expect(stamped).toContain('@status stable');
		// @file and @author preserved
		expect(stamped).toContain('@file Some file');
		expect(stamped).toContain('@author Josh');
	});
});