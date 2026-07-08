import { App, TFile } from 'obsidian';
import type { CodeGraphSettings } from '../settings';
import { type GraphNode, type GraphEdge } from '../types';
import {
	EXTENSION_TO_LANG,
	getProfile,
} from './profiles';
import type { ImportSpec, SymbolDef, SymbolExtract } from './extractor';
import { extractCommentLinks } from './commentLinks';
import {
	extractFileTags,
	extractNoteTagsFromFrontmatter,
	type FileTags,
} from './tagExtractor';
import { parseSource, setFsAccess } from './tree-sitter';
import {
	buildNameIndex,
	buildSymbolTable,
	resolveLinkTarget,
	resolveReference,
	buildSymbolIdTable,
	resolveSymbolReference,
	findContainingSymbol,
} from './resolver';
import {
	EdgeAccumulator,
	makeCodeNode,
	makeNoteNode,
	makeSymbolNode,
	symbolNodeId,
} from '../graph/model';
import {
	findTsConfig,
	type TsConfigDeps,
	clearTsConfigCache,
} from './tsconfig';

export interface IndexerDeps {
	app: App;
	getSettings: () => CodeGraphSettings;
	getPluginDir: () => string;
}

/** Pre-merge extraction: code/note nodes + code-derived edges (no md-links yet). */
export interface ExtractResult {
	nodes: Map<string, GraphNode>;
	codeEdges: GraphEdge[];
	scan: { total: number; excluded: number; codeFiles: number; parsed: number; parseFailures: string[] };
}

interface FileExtract {
	lang: string;
	ext: string;
	loc: number;
	imports: ImportSpec[];
	commentLinks: { target: string; line: number }[];
	symbols: SymbolExtract;
	tags: FileTags;
}

/**
 * Exclude matcher: a folder entry matches at ANY depth in the path, by segment.
 * "node_modules" excludes .../node_modules/... anywhere; "src/generated" excludes
 * any path containing that segment sequence. Multi-segment entries must appear
 * consecutively. This behaves like a folder-name .gitignore, not a root prefix.
 */
function isExcluded(path: string, folders: string[]): boolean {
	const segments = path.split('/');
	for (const folder of folders) {
		const fsegs = folder.split('/').filter((s) => s.length > 0);
		if (fsegs.length === 0) continue;
		for (let i = 0; i + fsegs.length <= segments.length; i++) {
			let matched = true;
			for (let j = 0; j < fsegs.length; j++) {
				if (segments[i + j] !== fsegs[j]) {
					matched = false;
					break;
				}
			}
			if (matched) return true;
		}
	}
	return false;
}

/**
 * Exclude a file whose basename ends with one of the given suffixes.
 * "d.ts" matches next-env.d.ts; "min.js" matches jquery.min.js; "test.ts"
 * matches foo.test.ts. Case-insensitive; leading dots stripped.
 */
function isExcludedType(path: string, suffixes: string[]): boolean {
	if (suffixes.length === 0) return false;
	const slash = path.lastIndexOf('/');
	const base = (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
	for (const raw of suffixes) {
		const suffix = raw.trim().toLowerCase().replace(/^\.+/, '');
		if (!suffix) continue;
		if (base.endsWith(`.${suffix}`)) return true;
	}
	return false;
}

/** Walks the vault, parses code, resolves references, and builds the graph data. */
export class CodeIndexer {
	private tsconfigDeps: TsConfigDeps;

	constructor(private deps: IndexerDeps) {
		const adapter = deps.app.vault.adapter;
		this.tsconfigDeps = {
			fileExists: (p) => adapter.exists(p),
			readFile: (p) => adapter.read(p),
		};
	}

	async extract(): Promise<ExtractResult> {
		setFsAccess({ getPluginDir: this.deps.getPluginDir });
		clearTsConfigCache();
		const settings = this.deps.getSettings();
		const files = this.deps.app.vault.getFiles();
		// Always exclude the Obsidian config dir, even if the user renamed it.
		const excludes = [...settings.excludeFolders, this.deps.app.vault.configDir];

		const knownPaths = new Set<string>();
		const codeEntries: { file: TFile; lang: string; ext: string }[] = [];
		const noteFiles: TFile[] = [];
		let excludedCount = 0;

		for (const f of files) {
			if (isExcluded(f.path, excludes)) {
				excludedCount++;
				continue;
			}
			if (isExcludedType(f.path, settings.excludeFileTypes)) {
				excludedCount++;
				continue;
			}
			knownPaths.add(f.path);
			const ext = (f.extension ?? '').toLowerCase();
			if (settings.codeExtensions.includes(ext)) {
				const lang = EXTENSION_TO_LANG[ext] ?? ext;
				codeEntries.push({ file: f, lang, ext });
			} else if (ext === 'md') {
				noteFiles.push(f);
			}
		}

		// Pass 1: parse + extract raw data per code file.
		const perFile = new Map<string, FileExtract>();
		let parsedCount = 0;
		const parseFailures: string[] = [];
		for (const { file, lang, ext } of codeEntries) {
			const content = await this.deps.app.vault.cachedRead(file);
			const profile = getProfile(lang);
			const imports: ImportSpec[] = profile
				? profile.extractImports(content)
				: [];
			const commentLinks = extractCommentLinks(
				content,
				settings.commentLinkPatterns,
			);
			const tags = extractFileTags(content);
			let symbols: SymbolExtract = {
				defines: [],
				references: [],
				inherits: [],
				implements: [],
				typeRefs: [],
			};
			// Only languages with a wired tree-sitter extractor pay the parse cost.
			if (profile?.extractSymbols) {
				try {
					const tree = await parseSource(lang, content);
					if (tree) {
						symbols = profile.extractSymbols(tree);
						tree.delete();
						parsedCount++;
					} else {
						parseFailures.push(
							`${file.path} — parseSource returned null`,
						);
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					parseFailures.push(`${file.path} — ${msg}`);
					console.warn(
						'[code-graph] tree-sitter parse failed for',
						file.path,
						err,
					);
				}
			}
			perFile.set(file.path, {
				lang,
				ext,
				loc: content.split('\n').length,
				imports,
				commentLinks,
				symbols,
				tags,
			});
		}

		// Diagnostic: surface tree-sitter failures so they're not silent.
		if (parseFailures.length > 0) {
			console.warn(
				`[code-graph] tree-sitter: ${parsedCount}/${codeEntries.length} files parsed, ${parseFailures.length} failures:`,
				parseFailures.slice(0, 10),
			);
		}

		// Symbol table (project-wide) for resolving calls / inheritance.
		const definesByFile = new Map<string, SymbolDef[]>();
		for (const [path, fe] of perFile) {
			definesByFile.set(path, fe.symbols.defines);
		}
		const symbolTable = buildSymbolTable(definesByFile);
		const symbolIdTable = buildSymbolIdTable(definesByFile);
		const nameIndex = buildNameIndex(knownPaths);

		// Pass 2: resolve references into file-level edges.
		const acc = new EdgeAccumulator();
		const nodes = new Map<string, GraphNode>();
		const candidateExts = settings.codeExtensions;

		for (const [path, fe] of perFile) {
		const codeNode = makeCodeNode(path, fe.lang, fe.ext, fe.loc);
		codeNode.domain = fe.tags.domain;
		codeNode.status = fe.tags.status;
		codeNode.author = fe.tags.author;
		codeNode.todoCount = fe.tags.todoCount;
		codeNode.fixmeCount = fe.tags.fixmeCount;
		nodes.set(path, codeNode);
			const resolvedImportPaths = new Set<string>();
			const profile = getProfile(fe.lang);
			// Only JS/TS-family profiles consult a tsconfig; skip the disk probe
			// for languages that don't need it (Python, C, Go, ...).
			const tsConfig = profile?.usesTsConfig
				? await findTsConfig(path, this.tsconfigDeps)
				: null;

			for (const imp of fe.imports) {
				const resolved = profile?.resolveImport({
					importerPath: path,
					specifier: imp.specifier,
					candidateExts,
					knownPaths,
					tsConfig,
				}) ?? null;
				if (resolved) {
					resolvedImportPaths.add(resolved);
					acc.add(path, resolved, 'imports');
				}
			}

			for (const link of fe.commentLinks) {
				const resolved = resolveLinkTarget(link.target, nameIndex, knownPaths);
				if (resolved) acc.add(path, resolved, 'comment-link');
			}

			// Tagged links: @tested-by, @adr, @depends-on → typed edges
			for (const tl of fe.tags.taggedLinks) {
				const resolved = resolveLinkTarget(tl.target, nameIndex, knownPaths);
				if (resolved) acc.add(path, resolved, tl.edgeType);
			}

			for (const ref of fe.symbols.references) {
				const resolved = resolveReference(
					ref.name,
					resolvedImportPaths,
					symbolTable,
					path,
				);
				if (resolved) acc.add(path, resolved, 'calls');
			}

			for (const inh of fe.symbols.inherits) {
				const resolved = resolveReference(
					inh.baseName,
					resolvedImportPaths,
					symbolTable,
					path,
				);
				if (resolved) acc.add(path, resolved, 'inherits');
			}

			// File-level uses-type
			for (const tref of fe.symbols.typeRefs) {
				const resolved = resolveReference(
					tref.name,
					resolvedImportPaths,
					symbolTable,
					path,
				);
				if (resolved) acc.add(path, resolved, 'uses-type');
			}

			// ── Symbol-level nodes + edges ────────────────────────────
			// Every definition becomes a first-class graph node. CONTAINS
			// edges connect containers to their symbols (file → symbol,
			// class → method). Symbol-level CALLS / INHERITS / IMPLEMENTS
			// edges connect symbols to symbols, enabling "what calls this
			// function?" navigation — the system-prompt's core objective.
			const fileDefs = fe.symbols.defines;

			for (const def of fileDefs) {
				const parentId = def.containerName
					? symbolNodeId(path, def.containerName)
					: path;
				const symNode = makeSymbolNode(
					path,
					def.name,
					def.kind,
					def.line,
					parentId,
					def.containerName,
					def.endLine,
					fe.lang,
				);
				if (!nodes.has(symNode.id)) nodes.set(symNode.id, symNode);
				acc.add(parentId, symNode.id, 'contains');
			}

			// Symbol-level CALLS: resolve caller via span, callee via local
			// (same-file) then cross-file symbol table.
			for (const ref of fe.symbols.references) {
				const caller = findContainingSymbol(fileDefs, ref.line);
				if (!caller) continue;
				const callerId = symbolNodeId(
					path,
					caller.name,
					caller.containerName,
				);
				let calleeId: string | null = null;
				const localMatches = fileDefs.filter((d) => d.name === ref.name);
				if (localMatches.length === 1) {
					calleeId = symbolNodeId(
						path,
						ref.name,
						localMatches[0]?.containerName,
					);
				} else if (localMatches.length === 0) {
					const callee = resolveSymbolReference(
						ref.name,
						resolvedImportPaths,
						symbolIdTable,
						path,
					);
					calleeId = callee?.symbolId ?? null;
				}
				if (calleeId && calleeId !== callerId) {
					acc.add(callerId, calleeId, 'calls');
				}
			}

			// Symbol-level INHERITS: class/interface → parent type.
			for (const inh of fe.symbols.inherits) {
				const child = findContainingSymbol(fileDefs, inh.line);
				const childId = child
					? symbolNodeId(path, child.name, child.containerName)
					: path;
				const parentEntry = resolveSymbolReference(
					inh.baseName,
					resolvedImportPaths,
					symbolIdTable,
					path,
				);
				if (parentEntry) {
					acc.add(childId, parentEntry.symbolId, 'inherits');
				}
			}

			// Symbol-level IMPLEMENTS: class → interface.
			for (const impl of fe.symbols.implements) {
				const impler = findContainingSymbol(fileDefs, impl.line);
				const implerId = impler
					? symbolNodeId(path, impler.name, impler.containerName)
					: path;
				const ifaceEntry = resolveSymbolReference(
					impl.ifaceName,
					resolvedImportPaths,
					symbolIdTable,
					path,
				);
				if (ifaceEntry) {
					acc.add(implerId, ifaceEntry.symbolId, 'implements');
				}
			}

			// Symbol-level USES-TYPE: symbol → type definition.
			for (const tref of fe.symbols.typeRefs) {
				const user = findContainingSymbol(fileDefs, tref.line);
				const userId = user
					? symbolNodeId(path, user.name, user.containerName)
					: path;
				const typeEntry = resolveSymbolReference(
					tref.name,
					resolvedImportPaths,
					symbolIdTable,
					path,
				);
				if (typeEntry) {
					acc.add(userId, typeEntry.symbolId, 'uses-type');
				}
			}
		}

		for (const f of noteFiles) {
			const noteNode = makeNoteNode(f.path);

			// Extract frontmatter related-code → documents edges
			// Try Obsidian's metadataCache first (reliable), fallback to regex
			const fileCache = this.deps.app.metadataCache.getCache(
				f.path,
			);
			const fm = fileCache?.frontmatter;

			// Apply Documentation-Protocol frontmatter (domain/status/type/tags/
			// author) to the note node so notes participate in Color-by-Domain /
			// Color-by-Status and the `tag:` color-group query — same protocol
			// code files follow via @domain/@status/@author tags.
			const noteTags = extractNoteTagsFromFrontmatter(fm);
			if (noteTags) {
				noteNode.domain = noteTags.domain;
				noteNode.status = noteTags.status;
				noteNode.author = noteTags.author;
				noteNode.tags = noteTags.tags;
			}

			nodes.set(f.path, noteNode);

			if (fm && Array.isArray(fm['related-code'])) {
				for (const item of fm['related-code']) {
					if (typeof item !== 'string') continue;
					const target = item.match(/\[\[([^\]]+)\]\]/)?.[1] ?? item;
					const resolved = resolveLinkTarget(
						target,
						nameIndex,
						knownPaths,
					);
					if (resolved && nodes.has(resolved)) {
						acc.add(f.path, resolved, 'documents');
					}
				}
			} else {
				// Fallback: regex-parse frontmatter from file content
				const content = await this.deps.app.vault.cachedRead(f);
				const fmMatch = content.match(
					/^---\n([\s\S]*?)\n---/,
				);
				if (fmMatch?.[1]) {
					const yaml = fmMatch[1];
					const rcMatch = yaml.match(
						/related-code:\s*\n((?:\s+-\s+.+\n?)+)/,
					);
					if (rcMatch?.[1]) {
						const items = rcMatch[1].matchAll(
							/\[\[([^\]]+)\]\]/g,
						);
						for (const item of items) {
							if (!item[1]) continue;
							const resolved = resolveLinkTarget(
								item[1],
								nameIndex,
								knownPaths,
							);
							if (resolved && nodes.has(resolved)) {
								acc.add(f.path, resolved, 'documents');
							}
						}
					}
				}
			}
		}

		return {
			nodes,
			codeEdges: acc.toArray(),
			scan: {
				total: files.length,
				excluded: excludedCount,
				codeFiles: codeEntries.length,
				parsed: parsedCount,
				parseFailures,
			},
		};
	}
}
