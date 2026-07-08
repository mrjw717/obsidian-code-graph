import {
	Plugin,
	TFile,
	TAbstractFile,
	WorkspaceLeaf,
	Notice,
} from 'obsidian';
import {
	CodeGraphSettingTab,
	CURRENT_SETTINGS_VERSION,
	DEFAULT_SETTINGS,
	type CodeGraphSettings,
} from './settings';
import { CodeIndexer, type ExtractResult } from './indexer/CodeIndexer';
import { setAdapterAccess } from './indexer/tree-sitter';
import { CodeGraphView } from './ui/GraphView';
import { mergeWithMdLinks } from './graph/merger';
import { registerSeedDomainsCommand } from './commands/seedDomains';
import type { GraphModel } from './types';

export const VIEW_TYPE_CODE_GRAPH = 'code-graph-view';

export default class CodeGraphPlugin extends Plugin {
	settings!: CodeGraphSettings;
	graphModel: GraphModel | null = null;

	private indexer!: CodeIndexer;
	private extract: ExtractResult | null = null;
	private reindexTimer: number | null = null;

	async onload() {
		await this.loadSettings();

		this.indexer = new CodeIndexer({
			app: this.app,
			getSettings: () => this.settings,
		});
		// Wire tree-sitter's wasm loader at the Obsidian vault adapter. Reading
		// grammars via DataAdapter (instead of Node fs) keeps the plugin inside
		// the sanctioned vault API and keeps every value strongly typed.
		const pluginDirRel = this.manifest.dir;
		if (pluginDirRel) {
			setAdapterAccess({
				adapter: this.app.vault.adapter,
				pluginDirRel,
			});
		}

		this.registerView(
			VIEW_TYPE_CODE_GRAPH,
			(leaf) => new CodeGraphView(leaf, this),
		);
		// Route code extensions vscode-editor doesn't cover by default (tsx, jsx,
		// h, cc, ...) to its Monaco view. Two benefits: Obsidian starts tracking
		// them (so they appear in the graph) AND they open with full syntax
		// highlighting. Requires vscode-editor to be enabled.
		this.registerCodeEditorExtensions();

		this.addSettingTab(new CodeGraphSettingTab(this.app, this));

		this.addRibbonIcon('git-graph', 'Open code graph', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open',
			name: 'Open graph view',
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: 'reindex',
			name: 'Reindex files',
			callback: () => void this.reindex(),
		});

		registerSeedDomainsCommand(this);

		// Code/note file changes -> debounced full re-parse.
		this.registerEvent(this.app.vault.on('modify', (f) => this.onFileChange(f)));
		this.registerEvent(this.app.vault.on('create', (f) => this.onFileChange(f)));
		this.registerEvent(this.app.vault.on('delete', (f) => this.onFileChange(f)));
		this.registerEvent(this.app.vault.on('rename', (f) => this.onFileChange(f)));

		// Markdown link changes -> cheap re-merge (no re-parse).
		this.registerEvent(
			this.app.metadataCache.on('changed', () => this.scheduleRemerge()),
		);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | undefined =
			workspace.getLeavesOfType(VIEW_TYPE_CODE_GRAPH)[0];
		if (!leaf) {
			// Open as a full tab in the main area so it's clearly distinct from
			// Obsidian's native graph view (which lives in its own tab too).
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({
				type: VIEW_TYPE_CODE_GRAPH,
				active: true,
			});
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	/**
	 * Register code extensions that vscode-editor doesn't cover by default so
	 * they point at vscode-editor's Monaco view. Effect: (1) Obsidian tracks
	 * those files so the indexer sees them, and (2) clicking opens them with
	 * syntax highlighting. Skips vscode-editor's own defaults to avoid clashes
	 * and no-ops if vscode-editor isn't enabled.
	 */
	private registerCodeEditorExtensions(): void {
		const plugins = (
			this.app as unknown as {
				plugins?: {
					enabledPlugins?: { has: (id: string) => boolean };
				};
			}
		).plugins;
		const enabled = plugins?.enabledPlugins?.has('vscode-editor') ?? false;
		if (!enabled) return;
		const vscodeDefaults = new Set([
			'ts',
			'js',
			'py',
			'css',
			'c',
			'cpp',
			'go',
			'rs',
			'java',
			'lua',
			'php',
		]);
		const gaps = this.settings.codeExtensions.filter(
			(ext) => !vscodeDefaults.has(ext),
		);
		if (gaps.length === 0) return;
		try {
			this.registerExtensions(gaps, 'vscode-editor');
		} catch {
			// view type not registered yet; ignore
		}
	}

	private isCodeOrNote(file: TFile): boolean {
		const ext = (file.extension ?? '').toLowerCase();
		return ext === 'md' || this.settings.codeExtensions.includes(ext);
	}

	private onFileChange(file: TAbstractFile): void {
		if (file instanceof TFile && this.isCodeOrNote(file)) {
			this.scheduleReindex();
		}
	}

	private scheduleReindex(): void {
		if (this.reindexTimer !== null) window.clearTimeout(this.reindexTimer);
		this.reindexTimer = window.setTimeout(() => {
			void this.reindex();
		}, 700);
	}

	private scheduleRemerge(): void {
		if (this.reindexTimer !== null) window.clearTimeout(this.reindexTimer);
		this.reindexTimer = window.setTimeout(() => {
			this.rebuildModel();
		}, 300);
	}

	/** Full re-parse of all code files + re-merge of markdown links. */
	async reindex(): Promise<void> {
		try {
			this.extract = await this.indexer.extract();
			this.rebuildModel();
			const model = this.graphModel;
			const s = model?.stats;
			const scan = this.extract.scan;

			// Per-type counts (the existing summary).
			const byType: Record<string, number> = {};
			// Per-language-per-type counts — surfaces "is language X producing
			// calls/inherits, or only imports?" at a glance, so the user can
			// self-diagnose "why am I only seeing one edge color".
			const byLang = new Map<string, Record<string, number>>();
			for (const e of model?.edges ?? []) {
				byType[e.type] = (byType[e.type] ?? 0) + 1;
				const lang = model?.nodes[e.src]?.lang ?? 'note';
				let bucket = byLang.get(lang);
				if (!bucket) {
					bucket = {};
					byLang.set(lang, bucket);
				}
				bucket[e.type] = (bucket[e.type] ?? 0) + 1;
			}

			// Compact per-language line: "TS: 12 imp · 3 call | JS: 4 imp | ..."
			// Only languages with at least one edge are shown.
			const TYPE_ABBR: Record<string, string> = {
				imports: 'imp',
				calls: 'call',
				inherits: 'inh',
				implements: 'impl',
				contains: 'cont',
				'uses-type': 'type',
				'comment-link': 'cmt',
				'md-link': 'md',
			};
			const langLine = Array.from(byLang.entries())
				// Most-active languages first for skimmability.
				.sort(([, a], [, b]) => {
					const sa = Object.values(a).reduce((x, y) => x + y, 0);
					const sb = Object.values(b).reduce((x, y) => x + y, 0);
					return sa < sb ? 1 : -1;
				})
				.map(([lang, counts]) => {
					const parts = Object.entries(counts)
						.map(([t, n]) => `${n} ${TYPE_ABBR[t] ?? t}`)
						.join(' · ');
					return `${lang}: ${parts}`;
				})
				.join(' | ');

			const parseInfo =
				scan.parsed < scan.codeFiles
					? `\n⚠ tree-sitter: ${scan.parsed}/${scan.codeFiles} parsed${
							scan.parseFailures.length > 0
								? ` (${scan.parseFailures.length} failures — see console)`
								: ''
						}`
					: '';

			new Notice(
				`Code graph: ${s?.codeFiles ?? 0} files, ${s?.symbolNodes ?? 0} symbols, ${s?.edgeCount ?? 0} edges (${scan.excluded}/${scan.total} excluded)\n` +
					`imp ${byType.imports ?? 0} · call ${byType.calls ?? 0} · inh ${byType.inherits ?? 0} · impl ${byType.implements ?? 0} · cont ${byType.contains ?? 0} · cmt ${byType['comment-link'] ?? 0} · md ${byType['md-link'] ?? 0}` +
					parseInfo +
					(langLine ? `\n${langLine}` : ''),
				8000,
			);
		} catch (err) {
			console.error('[code-graph] reindex failed', err);
			new Notice('Code graph: reindex failed (see console)');
		}
	}

	/** Recompute the final model from cached code data + live markdown links. */
	rebuildModel(): void {
		if (!this.extract) return;
		this.graphModel = mergeWithMdLinks(
			this.extract.nodes,
			this.extract.codeEdges,
			this.app.metadataCache.resolvedLinks,
			this.settings.includeMdLinks,
		);
		this.refreshViews();
	}

	/** Re-render any open graph views. */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_CODE_GRAPH,
		)) {
			const view = leaf.view;
			if (view instanceof CodeGraphView) view.renderGraph();
		}
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<CodeGraphSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// Deep-merge edgeTypesEnabled: Object.assign is shallow, so a persisted
		// edgeTypesEnabled with any keys missing (or set false by a dev toggle)
		// would clobber the entire default object. Without this, "additional
		// edges are not working" is caused by a stale { calls: false, ... }
		// surviving the shallow merge and silently filtering every non-import
		// edge out of the graph view. Merge key-by-key so every edge type
		// always has a defined boolean, defaulting to true for any type absent
		// from saved settings.
		this.settings.edgeTypesEnabled = {
			...DEFAULT_SETTINGS.edgeTypesEnabled,
			...(saved?.edgeTypesEnabled ?? {}),
		};
		// When defaults change (version bump), re-seed list-shaped settings so
		// existing users pick up new entries instead of keeping stale short lists.
		// edgeTypesEnabled is also reset because earlier dev builds persisted
		// { calls: false, inherits: false, ... } which silently hid every
		// non-import edge. The deep-merge above preserves user choices — but
		// these were never user choices, they were stale dev defaults.
		if (!saved || saved.settingsVersion !== CURRENT_SETTINGS_VERSION) {
			this.settings.settingsVersion = CURRENT_SETTINGS_VERSION;
			this.settings.excludeFolders = DEFAULT_SETTINGS.excludeFolders;
			this.settings.codeExtensions = DEFAULT_SETTINGS.codeExtensions;
			this.settings.edgeTypesEnabled = { ...DEFAULT_SETTINGS.edgeTypesEnabled };
			await this.saveSettings();
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
