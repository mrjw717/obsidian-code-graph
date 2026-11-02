/** Language-aware source positions that regex import extractors must ignore. */
export interface SourceSyntax {
	lineComments: readonly string[];
	blockComment?: { open: string; close: string; nested?: boolean };
	strings: readonly string[];
	tripleQuotes?: boolean;
	hashComments?: boolean;
	luaLongBrackets?: boolean;
	rustRawStrings?: boolean;
	cppRawStrings?: boolean;
	goRawStrings?: boolean;
}

export interface ImportSourceMasks {
	comments: Uint8Array;
	strings: Uint8Array;
}

const SLASH_COMMENTS: Pick<SourceSyntax, 'lineComments' | 'blockComment'> = {
	lineComments: ['//'],
	blockComment: { open: '/*', close: '*/' },
};

/**
 * Per-language lexical forms used only to prevent import regexes from matching
 * inside comments or string literals. The original source is still passed to
 * the regexes so quoted module specifiers and line numbers remain unchanged.
 */
export const IMPORT_SOURCE_SYNTAX: Readonly<Record<string, SourceSyntax>> = {
	typescript: { ...SLASH_COMMENTS, strings: ["'", '"', '`'] },
	tsx: { ...SLASH_COMMENTS, strings: ["'", '"', '`'] },
	javascript: { ...SLASH_COMMENTS, strings: ["'", '"', '`'] },
	python: {
		lineComments: ['#'],
		strings: ["'", '"'],
		tripleQuotes: true,
	},
	css: { lineComments: [], blockComment: { open: '/*', close: '*/' }, strings: ["'", '"'] },
	c: { ...SLASH_COMMENTS, strings: ["'", '"'] },
	cpp: { ...SLASH_COMMENTS, strings: ["'", '"'], cppRawStrings: true },
	go: { ...SLASH_COMMENTS, strings: ["'", '"', '`'], goRawStrings: true },
	rust: {
		...SLASH_COMMENTS,
		blockComment: { open: '/*', close: '*/', nested: true },
		strings: ['"'],
		rustRawStrings: true,
	},
	java: { ...SLASH_COMMENTS, strings: ["'", '"'], tripleQuotes: true },
	lua: { lineComments: ['--'], strings: ["'", '"'], luaLongBrackets: true },
	php: { ...SLASH_COMMENTS, lineComments: ['//', '#'], strings: ["'", '"', '`'], hashComments: true },
};

function startsWith(source: string, index: number, token: string): boolean {
	return source.startsWith(token, index);
}

function markRange(mask: Uint8Array, start: number, end: number): void {
	for (let i = start; i < end; i++) mask[i] = 1;
}

function findQuotedStringEnd(
	source: string,
	start: number,
	delimiter: string,
	allowTriple: boolean,
	backslashEscapes: boolean,
): number {
	const quote = allowTriple && (delimiter === "'" || delimiter === '"') &&
		source.startsWith(delimiter.repeat(3), start)
		? delimiter.repeat(3)
		: delimiter;
	let i = start + quote.length;
	while (i < source.length) {
		if (backslashEscapes && source[i] === '\\') {
			i += Math.min(2, source.length - i);
			continue;
		}
		if (source.startsWith(quote, i)) return i + quote.length;
		// A non-triple string cannot continue over a newline in these profiles.
		if (quote.length === 1 && (source[i] === '\n' || source[i] === '\r')) return i;
		i++;
	}
	return source.length;
}

function findLongBracketEnd(source: string, start: number): { openLength: number; end: number } | null {
	const opening = source.slice(start).match(/^\[(=*)\[/);
	if (!opening) return null;
	const equals = opening[1] ?? '';
	const close = `]${equals}]`;
	const closeAt = source.indexOf(close, start + opening[0].length);
	return { openLength: opening[0].length, end: closeAt < 0 ? source.length : closeAt + close.length };
}

function findRustRawStringEnd(source: string, start: number): number | null {
	let rawStart = start;
	if (source[start] === 'b' && source[start + 1] === 'r') rawStart++;
	if (source[rawStart] !== 'r' || (start > 0 && /[\w$]/.test(source[start - 1] ?? '') && rawStart === start)) return null;
	let i = rawStart + 1;
	while (source[i] === '#') i++;
	if (source[i] !== '"') return null;
	const hashes = '#'.repeat(i - rawStart - 1);
	const close = `"${hashes}`;
	const closeAt = source.indexOf(close, i + 1);
	return closeAt < 0 ? source.length : closeAt + close.length;
}

function findCppRawStringEnd(source: string, start: number): number | null {
	if (!source.startsWith('R"', start)) return null;
	const parenAt = source.indexOf('(', start + 2);
	if (parenAt < 0 || parenAt - (start + 2) > 16) return null;
	const delimiter = source.slice(start + 2, parenAt);
	if (/[\s()\\]/.test(delimiter)) return null;
	const close = `)${delimiter}"`;
	const closeAt = source.indexOf(close, parenAt + 1);
	return closeAt < 0 ? source.length : closeAt + close.length;
}

function findLineCommentEnd(source: string, start: number): number {
	const newline = source.indexOf('\n', start);
	return newline < 0 ? source.length : newline;
}

/**
 * Mark comments and string literals while preserving offsets. This small lexer
 * intentionally recognizes only lexical boundaries; it does not parse imports.
 */
export function findImportSourceMasks(source: string, syntax: SourceSyntax): ImportSourceMasks {
	const comments = new Uint8Array(source.length);
	const strings = new Uint8Array(source.length);
	let i = 0;
	while (i < source.length) {
		// Raw-string forms must be recognized before their quote delimiter.
		if (syntax.rustRawStrings) {
			const end = findRustRawStringEnd(source, i);
			if (end !== null) {
				markRange(strings, i, end);
				i = end;
				continue;
			}
		}
		if (syntax.cppRawStrings) {
			const end = findCppRawStringEnd(source, i);
			if (end !== null) {
				markRange(strings, i, end);
				i = end;
				continue;
			}
		}

		// Lua long strings and long comments use matching [=*[ ... ]=*] levels.
		if (syntax.luaLongBrackets && source.startsWith('--', i)) {
			const longComment = findLongBracketEnd(source, i + 2);
			const end = longComment ? longComment.end : findLineCommentEnd(source, i + 2);
			markRange(comments, i, end);
			i = end;
			continue;
		}
		if (syntax.luaLongBrackets && source[i] === '[') {
			const longString = findLongBracketEnd(source, i);
			if (longString) {
				markRange(strings, i, longString.end);
				i = longString.end;
				continue;
			}
		}

		const lineComment = syntax.lineComments.find((token) => startsWith(source, i, token));
		// PHP 8 attributes begin with #[ and are not line comments.
		if (lineComment && !(syntax.hashComments && lineComment === '#' && source[i + 1] === '[')) {
			const end = findLineCommentEnd(source, i + lineComment.length);
			markRange(comments, i, end);
			i = end;
			continue;
		}

		const block = syntax.blockComment;
		if (block && startsWith(source, i, block.open)) {
			let end = i + block.open.length;
			let depth = 1;
			while (end < source.length && depth > 0) {
				if (block.nested && startsWith(source, end, block.open)) {
					depth++;
					end += block.open.length;
				} else if (startsWith(source, end, block.close)) {
					depth--;
					end += block.close.length;
				} else {
					end++;
				}
			}
			markRange(comments, i, end);
			i = end;
			continue;
		}

		if (syntax.goRawStrings && source[i] === '`') {
			const closeAt = source.indexOf('`', i + 1);
			const end = closeAt < 0 ? source.length : closeAt + 1;
			markRange(strings, i, end);
			i = end;
			continue;
		}

		const delimiter = syntax.strings.find((token) => startsWith(source, i, token));
		if (delimiter) {
			const end = findQuotedStringEnd(source, i, delimiter, !!syntax.tripleQuotes, true);
			markRange(strings, i, end);
			i = end;
			continue;
		}
		i++;
	}
	return { comments, strings };
}

/** Replace comments with same-length spaces, preserving newlines and offsets. */
export function maskComments(source: string, comments: Uint8Array): string {
	const parts: string[] = [];
	let segmentStart = 0;
	let i = 0;
	while (i < comments.length) {
		if (!comments[i]) {
			i++;
			continue;
		}
		const commentStart = i;
		while (i < comments.length && comments[i]) i++;
		parts.push(source.slice(segmentStart, commentStart));
		parts.push(source.slice(commentStart, i).replace(/[^\r\n]/g, ' '));
		segmentStart = i;
	}
	parts.push(source.slice(segmentStart));
	return parts.join('');
}
