/**
 * Comment-link extraction: finds [[wikilinks]] and @see/@link references inside
 * code comments (and, as a fallback, anywhere in the file). Language-agnostic.
 */

/** Extract raw link target strings from file content using configured patterns. */
export function extractCommentLinks(
	content: string,
	patterns: string[],
): { target: string; line: number }[] {
	const results: { target: string; line: number }[] = [];
	const regexes: RegExp[] = [];
	for (const p of patterns) {
		try {
			regexes.push(new RegExp(p, 'g'));
		} catch {
			// ignore malformed user pattern
		}
	}
	if (regexes.length === 0) return results;

	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		for (const regex of regexes) {
			regex.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = regex.exec(line)) !== null) {
				// pick the first defined capture group (the link target)
				const target = match[1] ?? match[0];
				if (target) {
					results.push({ target: target.trim(), line: i + 1 });
				}
				if (match.index === regex.lastIndex) regex.lastIndex++;
			}
		}
	}
	return results;
}
