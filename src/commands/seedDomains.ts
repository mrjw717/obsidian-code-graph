/**
 * @file Seed domains from codebase — discovers a domain vocabulary from the
 *       indexed graph, confirms via a modal, then stamps @file/@domain/@status
 *       headers into code files and `domain:` frontmatter into notes.
 * @domain commands
 * @status stable
 */

import { Modal, Notice, TFile } from 'obsidian';
import type CodeGraphPlugin from '../main';
import { detectCommunities, type GraphEdge, type GraphNode } from '../types';

type ZoneColor = 'stable' | 'wip' | 'deprecated';

interface FileAssignment {
	domain: string;
	status: ZoneColor;
	fileDesc: string;
	/** Existing @domain in the file (lowercased), if any — used for idempotency. */
	existingDomain?: string;
}

/**
 * Register the "Seed domains from codebase" command. Discovery reads the
 * already-built graph model — no re-parse. Nothing is written until the user
 * confirms in the modal.
 */
export function registerSeedDomainsCommand(plugin: CodeGraphPlugin): void {
	plugin.addCommand({
		id: 'seed-domains',
		name: 'Seed domains from codebase',
		callback: () => void runSeedDomains(plugin),
	});
}

async function runSeedDomains(plugin: CodeGraphPlugin): Promise<void> {
	const model = plugin.graphModel;
	if (!model || Object.keys(model.nodes).length === 0) {
		new Notice(
			'Code graph: nothing indexed yet — open the graph view or reindex first.',
		);
		return;
	}
	const assignments = discover(plugin, model);
	if (assignments.size === 0) {
		new Notice('Code graph: no assignable code files found.');
		return;
	}
	new SeedDomainsModal(plugin, assignments).open();
}
// ── Phase 1: Discovery ──────────────────────────────────────────────────────

/**
 * Folder-segment matcher mirroring CodeIndexer.isExcluded — a folder entry
 * matches at ANY depth by segment. Multi-segment entries must be consecutive.
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

/** Basename-suffix matcher mirroring CodeIndexer.isExcludedType. */
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

/** True if a path segment is a structural/non-domain qualifier. */
function isTrivialSegment(seg: string): boolean {
	return (
		seg === 'src' ||
		seg === 'lib' ||
		seg === 'app' ||
		seg === 'internal' ||
		seg === 'common'
	);
}

/** Extract the first non-trivial path segment as a candidate domain name. */
function folderDomain(path: string): string | null {
	const segments = path.split('/').filter((s) => s.length > 0);
	for (const seg of segments) {
		if (!isTrivialSegment(seg)) return seg.toLowerCase();
	}
	return null;
}

/**
 * Map a node kind to a human noun for fileDesc, e.g. "Calculator component".
 * Falls back to "module" for plain code files.
 */
function kindNoun(node: GraphNode): string {
	switch (node.kind) {
		case 'class':
			return 'class';
		case 'interface':
			return 'interface';
		case 'function':
			return 'function';
		case 'note':
			return 'note';
		default:
			return 'module';
	}
}

/** Build the per-file assignment map from the graph model + community detection. */
function discover(
	plugin: CodeGraphPlugin,
	model: { nodes: Record<string, GraphNode>; edges: GraphEdge[] },
): Map<string, FileAssignment> {
	const s = plugin.settings;
	const excludes = [...s.excludeFolders, plugin.app.vault.configDir];

	// 1. Gather code nodes (skip notes — those get frontmatter, not headers).
	const codeNodes: GraphNode[] = [];
	const codeIds: string[] = [];
	for (const n of Object.values(model.nodes)) {
		if (n.kind !== 'code') continue;
		if (!s.codeExtensions.includes(n.ext ?? '')) continue;
		if (isExcluded(n.path, excludes)) continue;
		if (isExcludedType(n.path, s.excludeFileTypes)) continue;
		codeNodes.push(n);
		codeIds.push(n.id);
	}
	if (codeNodes.length === 0) return new Map();

	// 2. Folder heuristic: weight candidate domains by file count.
	const folderCounts = new Map<string, number>();
	const fileFolder = new Map<string, string | null>();
	for (const n of codeNodes) {
		const dom = folderDomain(n.path);
		fileFolder.set(n.id, dom);
		if (dom) folderCounts.set(dom, (folderCounts.get(dom) ?? 0) + 1);
	}

	// 3. Cross-reference with community detection.
	const communityLabels = detectCommunities(model.edges, codeIds);
	// group folder-domain → set of community labels it spans
	const folderCommunities = new Map<string, Set<number>>();
	for (const n of codeNodes) {
		const dom = fileFolder.get(n.id);
		const label = communityLabels.get(n.id);
		if (dom === undefined || dom === null || label === undefined) continue;
		let set = folderCommunities.get(dom);
		if (!set) {
			set = new Set();
			folderCommunities.set(dom, set);
		}
		set.add(label);
	}

	// 4. Collapse to 3-7 domains:
	//    - reject one-file folder-domains (leave untagged)
	//    - merge clusters with <3 files into nearest larger one (by shared community)
	//    - split folder-domains spanning >=3 communities (keep the folder name as-is
	//      but mark it; for simplicity here we keep the folder name and rely on the
	//      3-7 collapse to merge small ones together)
	const TRIVIAL = new Set<string>();
	const candidateDomains = new Map<string, string[]>();
	for (const [dom, count] of folderCounts) {
		if (count < 3) {
			TRIVIAL.add(dom); // too small — will be merged or left untagged
			continue;
		}
		candidateDomains.set(dom, []);
	}

	// Merge trivial domains into the nearest candidate by shared community overlap.
	for (const n of codeNodes) {
		const dom = fileFolder.get(n.id);
		if (dom === undefined || dom === null) continue;
		if (candidateDomains.has(dom)) {
			candidateDomains.get(dom)!.push(n.id);
			continue;
		}
		if (TRIVIAL.has(dom)) {
			// find nearest candidate by shared community
			const label = communityLabels.get(n.id);
			let best: string | null = null;
			let bestOverlap = 0;
			for (const cand of candidateDomains.keys()) {
				const candComms = folderCommunities.get(cand);
				if (!candComms || label === undefined) continue;
				if (candComms.has(label)) {
					const overlap = countSharedCommunities(cand, label, folderCommunities);
					if (overlap > bestOverlap) {
						bestOverlap = overlap;
						best = cand;
					}
				}
			}
			if (best) candidateDomains.get(best)!.push(n.id);
			// else: leave untagged (no good match)
		}
	}

	// If we have fewer than 3 domains, that's fine — the spec says "3-7" but
	// small codebases may legitimately have fewer. Don't fabricate.
	// If we have more than 7, merge the smallest ones into their nearest neighbor.
	while (candidateDomains.size > 7) {
		// find smallest
		let smallest: string | null = null;
		let smallestSize = Infinity;
		for (const [dom, ids] of candidateDomains) {
			if (ids.length < smallestSize) {
				smallestSize = ids.length;
				smallest = dom;
			}
		}
		if (!smallest) break;
		// find nearest by shared community
		const smallComms = folderCommunities.get(smallest) ?? new Set();
		let nearest: string | null = null;
		let bestOverlap = -1;
		for (const cand of candidateDomains.keys()) {
			if (cand === smallest) continue;
			const candComms = folderCommunities.get(cand) ?? new Set();
			let overlap = 0;
			for (const c of smallComms) if (candComms.has(c)) overlap++;
			if (overlap > bestOverlap) {
				bestOverlap = overlap;
				nearest = cand;
			}
		}
		if (nearest && nearest !== smallest) {
			candidateDomains.get(nearest)!.push(...candidateDomains.get(smallest)!);
			candidateDomains.delete(smallest);
		} else {
			break; // can't merge further
		}
	}

	// 5. Per-file assignment.
	const result = new Map<string, FileAssignment>();
	for (const [dom, ids] of candidateDomains) {
		for (const id of ids) {
			const n = model.nodes[id];
			if (!n) continue;
			const status: ZoneColor =
				(n.todoCount ?? 0) > 0
					? 'wip'
					: n.status === 'deprecated'
						? 'deprecated'
						: 'stable';
			const fileDesc = `${n.name} ${kindNoun(n)}`;
			result.set(n.path, {
				domain: dom,
				status,
				fileDesc,
				existingDomain: n.domain,
			});
		}
	}
	return result;
}

function countSharedCommunities(
	cand: string,
	label: number,
	folderCommunities: Map<string, Set<number>>,
): number {
	const comms = folderCommunities.get(cand);
	return comms && comms.has(label) ? 1 : 0;
}

// ── Phase 2: Confirm Modal ──────────────────────────────────────────────────

class SeedDomainsModal extends Modal {
	private plugin: CodeGraphPlugin;
	private assignments: Map<string, FileAssignment>;
	/** Renames confirmed by the user: oldName → newName. */
	private renames = new Map<string, string>();
	/** Tracks which existing-domain values the user explicitly approved to overwrite. */
	private overwriteApproved = new Set<string>();

	constructor(plugin: CodeGraphPlugin, assignments: Map<string, FileAssignment>) {
		super(plugin.app);
		this.plugin = plugin;
		this.assignments = assignments;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('code-graph-seed-modal');
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Seed domains from codebase' });

		// Section 1: vocabulary summary
		const counts = new Map<string, number>();
		for (const a of this.assignments.values()) {
			const d = this.renames.get(a.domain) ?? a.domain;
			counts.set(d, (counts.get(d) ?? 0) + 1);
		}
		const summary = contentEl.createDiv({ cls: 'code-graph-seed-summary' });
		summary.createEl('p', {
			text: `Proposed vocabulary (${counts.size} domains, ${this.assignments.size} files):`,
		});
		const ul = summary.createEl('ul');
		for (const [dom, count] of counts) {
			ul.createEl('li', { text: `${dom} (${count} files)` });
		}

		// Section 2: per-file table
		const tableWrap = contentEl.createDiv({ cls: 'code-graph-seed-table-wrap' });
		const table = tableWrap.createEl('table');
		table.addClass('code-graph-seed-table');
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: 'Path' });
		headRow.createEl('th', { text: 'Domain' });
		headRow.createEl('th', { text: 'Status' });
		const tbody = table.createEl('tbody');
		for (const [path, a] of this.assignments) {
			const dom = this.renames.get(a.domain) ?? a.domain;
			const tr = tbody.createEl('tr');
			tr.createEl('td', { text: path });
			tr.createEl('td', { text: dom });
			tr.createEl('td', { text: a.status });
			if (a.existingDomain && a.existingDomain !== dom) {
				tr.addClass('code-graph-seed-overwrite');
				tr.createEl('td', { text: `(was: ${a.existingDomain})` });
			}
		}

		// Section 3: Edit domains
		const editWrap = contentEl.createDiv({ cls: 'code-graph-seed-edit' });
		editWrap.createEl('p', {
			text: 'Rename a domain (applies to all its files):',
		});
		const editList = editWrap.createDiv();
		this.renderRenameInputs(editList);

		// Section 4: buttons
		const btnRow = contentEl.createDiv({ cls: 'code-graph-seed-buttons' });
		const applyBtn = btnRow.createEl('button', { text: 'Apply', cls: 'mod-cta' });
		applyBtn.onclick = () => {
			void this.apply();
		};
		const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => this.close();
	}

	private renderRenameInputs(container: HTMLElement): void {
		const domains = new Set<string>();
		for (const a of this.assignments.values()) domains.add(a.domain);
		for (const dom of domains) {
			const row = container.createDiv({ cls: 'code-graph-seed-rename-row' });
			row.createSpan({ text: `${dom} → ` });
			const input = row.createEl('input', { type: 'text' });
			input.placeholder = 'New name (leave blank to keep)';
			input.value = this.renames.get(dom) ?? '';
			input.onchange = () => {
				const v = input.value.trim().toLowerCase();
				if (v && v !== dom) {
					this.renames.set(dom, v);
					this.overwriteApproved.add(dom);
				} else {
					this.renames.delete(dom);
					this.overwriteApproved.delete(dom);
				}
			};
		}
	}

	private async apply(): Promise<void> {
		this.close();
		await runApply(this.plugin, this.assignments, this.renames, this.overwriteApproved);
	}
}

/**
 * Execute the writes. Captured as a free function so the modal stays thin.
 */
async function runApply(
	plugin: CodeGraphPlugin,
	assignments: Map<string, FileAssignment>,
	renames: Map<string, string>,
	overwriteApproved: Set<string>,
): Promise<void> {
	const app = plugin.app;

	let success = 0;
	const failures: string[] = [];
	const touchedDomains = new Set<string>();

	for (const [path, a] of assignments) {
		const finalDomain = renames.get(a.domain) ?? a.domain;
		touchedDomains.add(finalDomain);
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			failures.push(`${path}: not found`);
			continue;
		}
		try {
			// Idempotency: skip if already fully tagged with matching domain.
			if (a.existingDomain === finalDomain && a.status !== 'deprecated') {
				// already correct — no-op
				continue;
			}
			// Overwrite guard: if file has a different existing domain, only
			// overwrite when the user confirmed via the rename/Edit step.
			if (
				a.existingDomain &&
				a.existingDomain !== finalDomain &&
				!overwriteApproved.has(a.domain)
			) {
				// leave it — user did not confirm this overwrite
				continue;
			}

			if (file.extension === 'md') {
				await app.fileManager.processFrontMatter(
					file,
					(fm: Record<string, unknown>) => {
						fm.domain = finalDomain;
					},
				);
				success++;
			} else {
				const content = await app.vault.read(file);
				const newContent = stampCodeHeader(
					content,
					a.fileDesc,
					finalDomain,
					a.status,
				);
				if (newContent !== content) {
					await app.vault.modify(file, newContent);
					success++;
				}
			}
		} catch (err) {
			failures.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	// Reindex so the graph picks up new domains → auras populate immediately.
	await plugin.reindex();

	const failMsg = failures.length > 0 ? ` · ${failures.length} failed` : '';
	new Notice(
		`Seeded ${success} files · ${touchedDomains.size} domains${failMsg}`,
		6000,
	);
	if (failures.length > 0) {
		console.warn('[code-graph] seed domain failures', failures);
	}
}

// ── Phase 3: Header stamping ───────────────────────────────────────────────

/** Tag regexes (case-insensitive, per tagExtractor.ts). Module-level so helpers share them. */
const FILE_RE = /@file\s+(.+)/i;
const DOM_RE = /@domain\s+(\S+)/i;
const STATUS_RE = /@status\s+(\w+)/i;

/**
 * Insert or update a Tier-1 header block in a code file.
 *
 * - If a block comment header exists, rewrite only @file/@domain/@status lines
 *   within it (preserving @see, @tested-by, @adr, @depends-on, [[wikilinks]],
 *   and all other content).
 * - If no header exists, prepend a new block comment at the very top, adapted
 *   to the file's language comment style.
 *
 * Returns the new content (or the original content if no change was needed).
 *
 * Exported for unit testing (idempotency + preservation of non-Tier-1 tags).
 */
export function stampCodeHeader(
	content: string,
	fileDesc: string,
	domain: string,
	status: ZoneColor,
): string {
	const lines = content.split('\n');

	// Detect existing @file/@domain/@status anywhere in the first ~30 lines.
	const existingFile = findTagLine(lines, FILE_RE);
	const existingDom = findTagLine(lines, DOM_RE);
	const existingStatus = findTagLine(lines, STATUS_RE);

	// If all three already match, no-op (idempotent).
	if (
		existingFile &&
		existingDom &&
		existingStatus &&
		existingDom.match === domain &&
		existingStatus.match === status
	) {
		// also verify @file desc matches? — we keep existing @file if present.
		return content;
	}

	// Detect an existing leading block comment (first non-blank line starts a block).
	const firstNonBlank = lines.findIndex((l) => l.trim().length > 0);
	const hasBlockHeader =
		firstNonBlank >= 0 && /^\s*\/\*/.test(lines[firstNonBlank] ?? '');

	if (hasBlockHeader && firstNonBlank >= 0) {
		// Find the end of the block comment.
		let endLine = firstNonBlank;
		for (let i = firstNonBlank; i < lines.length; i++) {
			if (/\*\//.test(lines[i] ?? '')) {
				endLine = i;
				break;
			}
		}
		// Rewrite the three Tier-1 tags within [firstNonBlank, endLine].
		const block = lines.slice(firstNonBlank, endLine + 1);
		const newBlock = rewriteBlockTags(block, fileDesc, domain, status);
		const newLines = [
			...lines.slice(0, firstNonBlank),
			...newBlock,
			...lines.slice(endLine + 1),
		];
		return newLines.join('\n');
	}

	// No block header — prepend a new one. Adapt to language via extension heuristics
	// is hard without the ext here; use a generic /** */ block which the extractor
	// parses language-agnostically (the regexes are style-agnostic — they match
	// @tag anywhere in any comment line).
	const header = [
		'/**',
		` * @file ${fileDesc}`,
		` * @domain ${domain}`,
		` * @status ${status}`,
		' */',
		'',
	];
	return header.join('\n') + content;
}

/** Find the first line matching a tag regex; return { lineIndex, match } or null. */
function findTagLine(
	lines: string[],
	re: RegExp,
	maxScan = 30,
): { lineIndex: number; match: string } | null {
	for (let i = 0; i < Math.min(lines.length, maxScan); i++) {
		const m = (lines[i] ?? '').match(re);
		if (m?.[1]) return { lineIndex: i, match: m[1].trim().toLowerCase() };
	}
	return null;
}

/** Rewrite the three Tier-1 tags in an existing block comment, preserving all else. */
function rewriteBlockTags(
	block: string[],
	fileDesc: string,
	domain: string,
	status: ZoneColor,
): string[] {
	let sawFile = false;
	let sawDomain = false;
	let sawStatus = false;
	const out = block.map((line) => {
		if (FILE_RE.test(line) && !sawFile) {
			sawFile = true;
			return line.replace(FILE_RE, `@file ${fileDesc}`);
		}
		if (DOM_RE.test(line) && !sawDomain) {
			sawDomain = true;
			return line.replace(DOM_RE, `@domain ${domain}`);
		}
		if (STATUS_RE.test(line) && !sawStatus) {
			sawStatus = true;
			return line.replace(STATUS_RE, `@status ${status}`);
		}
		return line;
	});
	// If any tag was missing, insert it before the closing */ line.
	const closeIdx = out.findIndex((l) => /\*\//.test(l));
	const insertAt = closeIdx >= 0 ? closeIdx : out.length;
	if (!sawFile) out.splice(insertAt, 0, ` * @file ${fileDesc}`);
	if (!sawDomain) out.splice(insertAt, 0, ` * @domain ${domain}`);
	if (!sawStatus) out.splice(insertAt, 0, ` * @status ${status}`);
	return out;
}