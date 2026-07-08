/**
 * Documentation Protocol tag extraction.
 *
 * Extracts structured metadata from code comments following the
 * Code Graph Documentation Protocol:
 *
 *   @domain <name>           → semantic domain tag
 *   @status <stable|wip|deprecated>
 *   @author <name>           → author metadata (shown in hover tooltip)
 *   @tested-by [[Target]]    → typed link edge
 *   @adr [[Target]]          → typed link edge
 *   @depends-on [[Target]]   → typed link edge
 *   // TODO: / // FIXME:     → count metadata
 *
 * All patterns are language-agnostic (work in any // or # comment style).
 */

export interface TaggedLink {
	target: string;
	line: number;
	edgeType: 'tested-by' | 'adr-link' | 'depends-on';
}

export interface FileTags {
	domain?: string;
	status?: string;
	author?: string;
	todoCount: number;
	fixmeCount: number;
	taggedLinks: TaggedLink[];
}

/** Regex patterns for typed @-tags that produce specific edge types. */
const TAGGED_PATTERNS: {
	re: RegExp;
	edge: TaggedLink['edgeType'];
}[] = [
	{ re: /@tested-by\s+\[\[([^\]]+)\]\]/gi, edge: 'tested-by' },
	{ re: /@adr\s+\[\[([^\]]+)\]\]/gi, edge: 'adr-link' },
	{ re: /@depends-on\s+\[\[([^\]]+)\]\]/gi, edge: 'depends-on' },
];

/** Extract all documentation-protocol metadata from file content. */
export function extractFileTags(content: string): FileTags {
	const lines = content.split('\n');
	let domain: string | undefined;
	let status: string | undefined;
	let author: string | undefined;
	let todoCount = 0;
	let fixmeCount = 0;
	const taggedLinks: TaggedLink[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;

		// @domain tag
		const domMatch = line.match(/@domain\s+(\S+)/i);
		if (domMatch?.[1]) {
			domain = domMatch[1].toLowerCase();
		}

		// @status tag
		const statMatch = line.match(/@status\s+(\w+)/i);
		if (statMatch?.[1]) {
			status = statMatch[1].toLowerCase();
		}

		// @author tag (free-text, capture rest of line after the tag)
		const authorMatch = line.match(/@author\s+(.+)/i);
		if (authorMatch?.[1]) {
			author = authorMatch[1].trim();
		}

		// TODO count
		if (/\bTODO\b/i.test(line) && /[/#*]/.test(line[0] ?? '')) {
			todoCount++;
		}

		// FIXME count
		if (/\bFIXME\b/i.test(line) && /[/#*]/.test(line[0] ?? '')) {
			fixmeCount++;
		}

		// Tagged links
		for (const { re, edge } of TAGGED_PATTERNS) {
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(line)) !== null) {
				if (m[1]) {
					taggedLinks.push({
						target: m[1].trim(),
						line: i + 1,
						edgeType: edge,
					});
				}
				if (m.index === re.lastIndex) re.lastIndex++;
			}
		}
	}

	return { domain, status, author, todoCount, fixmeCount, taggedLinks };
}

/**
 * Extract Documentation-Protocol metadata from a markdown note's frontmatter.
 * Reads `domain`, `status`, `type`, `tags` (and `author` if present) from the
 * YAML block. Tags are normalized to a lowercase string array. Returns
 * `undefined` when there is no parseable frontmatter.
 *
 * Mirrors the code-side `extractFileTags` so note nodes can participate in
 * Color-by-Domain / Color-by-Status and the `tag:` color-group query — the
 * same protocol the skill documents for notes.
 */
export interface NoteFrontmatterTags {
	domain?: string;
	status?: string;
	type?: string;
	author?: string;
	tags?: string[];
}

export function extractNoteTagsFromFrontmatter(
	fm: Record<string, unknown> | undefined,
): NoteFrontmatterTags | undefined {
	if (!fm) return undefined;
	const out: NoteFrontmatterTags = {};
	let hasAny = false;

	const domain = fm['domain'];
	if (typeof domain === 'string' && domain.trim()) {
		out.domain = domain.trim().toLowerCase();
		hasAny = true;
	}
	const status = fm['status'];
	if (typeof status === 'string' && status.trim()) {
		out.status = status.trim().toLowerCase();
		hasAny = true;
	}
	const type = fm['type'];
	if (typeof type === 'string' && type.trim()) {
		out.type = type.trim().toLowerCase();
		hasAny = true;
	}
	const author = fm['author'];
	if (typeof author === 'string' && author.trim()) {
		out.author = author.trim();
		hasAny = true;
	}
	const tags = fm['tags'];
	if (Array.isArray(tags)) {
		const norm = tags
			.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''))
			.filter((t) => t.length > 0);
		if (norm.length > 0) {
			out.tags = norm;
			hasAny = true;
		}
	} else if (typeof tags === 'string') {
		const norm = tags
			.split(/[\s,]+/)
			.map((t) => t.trim().toLowerCase())
			.filter((t) => t.length > 0);
		if (norm.length > 0) {
			out.tags = norm;
			hasAny = true;
		}
	}

	return hasAny ? out : undefined;
}
