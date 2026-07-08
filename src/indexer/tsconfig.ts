/**
 * Resolve JS/TS path aliases (`@/...`, `~/...`, etc.) declared in the nearest
 * tsconfig.json / jsconfig.json. Walks up from the importing file to find the
 * config, parses compilerOptions.baseUrl + paths, and maps alias specifiers to
 * vault-absolute file paths.
 */
import { posixDir, posixJoin, normalizePosix } from './resolver';

export interface TsConfigInfo {
	dir: string; // vault-relative dir containing the tsconfig
	baseUrl: string; // compilerOptions.baseUrl (relative to dir)
	paths: Record<string, string[]>;
}

export interface TsConfigDeps {
	fileExists: (path: string) => Promise<boolean>;
	readFile: (path: string) => Promise<string>;
}

const cache = new Map<string, TsConfigInfo | null>();

export function clearTsConfigCache(): void {
	cache.clear();
}

const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];

export async function findTsConfig(
	filePath: string,
	deps: TsConfigDeps,
): Promise<TsConfigInfo | null> {
	let dir = posixDir(filePath);
	const tried: string[] = [];
	while (true) {
		const cached = cache.get(dir);
		if (cached !== undefined) {
			for (const t of tried) cache.set(t, cached);
			return cached;
		}
		tried.push(dir);
		for (const name of CONFIG_NAMES) {
			const candidate = posixJoin(dir, name);
			try {
				if (await deps.fileExists(candidate)) {
					const content = await deps.readFile(candidate);
					const info = parseTsConfig(content, dir);
					for (const t of tried) cache.set(t, info);
					return info;
				}
			} catch {
				// ignore this candidate, keep searching upward
			}
		}
		const parent = posixDir(dir);
		if (parent === dir) break;
		dir = parent;
	}
	for (const t of tried) cache.set(t, null);
	return null;
}

function parseTsConfig(content: string, dir: string): TsConfigInfo {
	const clean = stripJsonComments(content).replace(/,\s*([}\]])/g, '$1');
	let parsed: Record<string, unknown> = {};
	try {
		parsed = JSON.parse(clean) as Record<string, unknown>;
	} catch {
		return { dir, baseUrl: '.', paths: {} };
	}
	const co = (parsed.compilerOptions ?? {}) as Record<string, unknown>;
	const baseUrl = typeof co.baseUrl === 'string' ? co.baseUrl : '.';
	const pathsRaw = co.paths;
	const paths =
		pathsRaw && typeof pathsRaw === 'object'
			? (pathsRaw as Record<string, string[]>)
			: {};
	return { dir, baseUrl, paths };
}

/**
 * Remove line and block comments while respecting string literals, so that
 * path-pattern characters inside strings are not mistaken for comment markers.
 */
function stripJsonComments(s: string): string {
	let out = '';
	let i = 0;
	let inString = false;
	let quote = '';
	while (i < s.length) {
		const c = s[i];
		const next = s[i + 1];
		if (inString) {
			out += c;
			if (c === '\\' && next !== undefined) {
				out += next;
				i += 2;
				continue;
			}
			if (c === quote) inString = false;
			i++;
			continue;
		}
		if (c === '"' || c === "'") {
			inString = true;
			quote = c;
			out += c;
			i++;
			continue;
		}
		if (c === '/' && next === '/') {
			while (i < s.length && s[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && next === '*') {
			i += 2;
			while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
			i += 2;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

function matchAlias(pattern: string, specifier: string): string | null {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const regexStr = '^' + escaped.replace(/\\\*/g, '(.*)') + '$';
	const re = new RegExp(regexStr);
	const m = re.exec(specifier);
	if (!m) return null;
	return m[1] ?? '';
}

export function resolveAliased(
	specifier: string,
	tsconfig: TsConfigInfo | null,
	candidateExts: string[],
	knownPaths: Set<string>,
): string | null {
	if (!tsconfig) return null;
	const baseUrlDir = normalizePosix(posixJoin(tsconfig.dir, tsconfig.baseUrl));
	for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
		const wildcard = matchAlias(pattern, specifier);
		if (wildcard === null) continue;
		for (const target of targets) {
			const sub = target.replace(/\*/g, wildcard).replace(/^\.\//, '');
			const base = normalizePosix(posixJoin(baseUrlDir, sub));
			for (const ext of candidateExts) {
				const c = `${base}.${ext}`;
				if (knownPaths.has(c)) return c;
			}
			for (const ext of candidateExts) {
				const c = `${base}/index.${ext}`;
				if (knownPaths.has(c)) return c;
			}
			if (knownPaths.has(base)) return base;
		}
	}
	return null;
}
