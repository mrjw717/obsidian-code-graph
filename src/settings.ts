import { App, PluginSettingTab, Setting } from 'obsidian';
import type {
	SettingDefinitionItem,
	SettingGroupItem,
} from 'obsidian';
import type CodeGraphPlugin from './main';
import { ALL_EDGE_TYPES, EDGE_STYLE, type EdgeType } from './types';

export type NodeSizingMode =
	| 'constant'
	| 'lines'
	| 'degree'
	| 'fan-in'
	| 'fan-out';

export type ColorMode = 'language' | 'domain' | 'status' | 'community';

export interface ColorGroup {
	id: string;
	name: string;
	query: string;
	color: string;
	enabled: boolean;
}

export interface CodeGraphSettings {
	/** Bumped when defaults change so persisted settings can be migrated. */
	settingsVersion: number;
	// ── Scaling / performance ──
	/** Max visible nodes before auto-degrade (zones/smoothing/continuous-physics off). 0 = unlimited. */
	maxNodes: number;
	/** Auto-disable edge smoothing above this edge count. 0 = never smooth. */
	edgeSmoothThreshold: number;
	/** File extensions (without dot) to treat as code. */
	codeExtensions: string[];
	/** Which edge types to extract / show. */
	edgeTypesEnabled: Record<EdgeType, boolean>;
	/** Comment patterns that create edges to notes (regex strings). */
	commentLinkPatterns: string[];
	/** Folder names/paths to exclude (matched at any depth by segment). */
	excludeFolders: string[];
	/** File-type suffixes to exclude, e.g. "d.ts", "min.js", "test.ts". */
	excludeFileTypes: string[];
	/** Include edges derived from markdown links (metadataCache.resolvedLinks). */
	includeMdLinks: boolean;
	/** Show note (.md) nodes in the graph. Off = code-only view. */
	showNotes: boolean;
	/** Show symbol-level nodes (functions, classes, methods, …) inside files. */
	showSymbols: boolean;
	/** Show code file nodes (turn off for notes-only or symbols-only views). */
	showCodeFiles: boolean;
	/** Enable vis-network physics simulation. */
	physicsEnabled: boolean;
	/** Only draw edges between nodes that are within N hops of the focused file. */
	neighborhoodHops: number;
	// ── Node sizing ──
	nodeSizingMode: NodeSizingMode;
	nodeSizeMin: number;
	nodeSizeMax: number;
	// ── Display toggles ──
	highlightDeadCode: boolean;
	showBadges: boolean;
	/** Animate edges: dashed lines flow in arrow direction, solid lines get
	 * an electric pulse. Auto-disables above HOVER_DISABLE_THRESHOLD for perf. */
	animateEdges: boolean;
	// ── Physics forces (mirror Obsidian core graph controls) ──
	centerForce: number; // 0-100
	repelForce: number; // 0-100
	linkForce: number; // 0-100
	linkDistance: number; // 10-300
	/** Cross-cluster edge stretch multiplier (1.0 = uniform, 1.618 = φ, 3.0 = very stretchy). */
	stretchiness: number;
	// ── Zoom-based label visibility ──
	labelFadeZoom: number; // 0.0-2.0 — hide labels below this zoom
	// ── Coloring mode ──
	colorMode: ColorMode;
	// ── Hub clustering ──
	clusterHubs: boolean;
	clusterThreshold: number; // cluster nodes with degree above this
	/** Clustering strategy for large graphs: 'none' | 'folder' | 'community'. */
	clusterMode: 'none' | 'folder' | 'community';
	// ── Color groups (user-defined, Obsidian-like) ──
	colorGroups: ColorGroup[];
	// ── Zone rendering ──
	showZones: boolean;
	// ── Hover contextual focus ──
	/** Dim distant nodes/edges on hover to spotlight a node's neighborhood. */
	hoverFocusEnabled: boolean;
	// ── Zone-aura heatmap ──
	/** What drives the zone-aura heatmap (independent of node fill colorMode). */
	zoneColorMode: 'groups' | 'community' | 'domain';
}

export const CURRENT_SETTINGS_VERSION = 9;

export const DEFAULT_SETTINGS: CodeGraphSettings = {
	settingsVersion: CURRENT_SETTINGS_VERSION,
	maxNodes: 800,
	edgeSmoothThreshold: 500,
	codeExtensions: [
		'ts',
		'tsx',
		'js',
		'jsx',
		'py',
		'css',
		'c',
		'h',
		'cpp',
		'cc',
		'go',
		'rs',
		'java',
		'lua',
		'php',
	],
	edgeTypesEnabled: {
		imports: true,
		calls: true,
		inherits: true,
		implements: true,
		contains: true,
		'uses-type': true,
		'tested-by': true,
		'adr-link': true,
		'depends-on': true,
		documents: true,
		'comment-link': true,
		'md-link': true,
	},
	commentLinkPatterns: [
		'\\[\\[([^\\]]+)\\]\\]', // [[wikilink]]
		'@see\\s+\\[\\[([^\\]]+)\\]\\]', // @see [[wikilink]]
		'@link\\s+([^\\s,;]+)', // @link foo
		'(?:ref|see|see\\s+also)[:\\s]+\\[\\[([^\\]]+)\\]\\]', // ref: [[x]]
	],
	// Common dependency / build / cache / IDE folders. Matched at ANY depth.
	excludeFolders: [
		'node_modules', // JS deps
		'.git', // VCS
		'dist', // build output
		'build', // build output
		'out', // build output
		'coverage', // test coverage
		'.cache', // generic cache
		'.turbo', // monorepo cache
		'.next', // Next.js
		'.svelte-kit', // SvelteKit
		'target', // Rust / Maven
		'vendor', // Go / PHP / Ruby deps
		'__pycache__', // Python bytecode
		'.venv', // Python venv
		'.idea', // JetBrains IDE
		'wasm', // this plugin's tree-sitter assets
	],
	// Generated / minified file suffixes (matched against the basename tail).
	excludeFileTypes: [
		'd.ts', // TypeScript declaration files (generated)
		'min.js', // minified JS
		'min.mjs', // minified ESM
		'min.css', // minified CSS
		'bundle.js', // bundled output
	],
	includeMdLinks: true,
	showNotes: true,
	showSymbols: false,
	showCodeFiles: true,
	physicsEnabled: true,
	neighborhoodHops: 0, // 0 = whole graph
	nodeSizingMode: 'constant',
	nodeSizeMin: 8,
	nodeSizeMax: 25,
	highlightDeadCode: true,
	showBadges: false,
	animateEdges: true,
	centerForce: 30,
	repelForce: 60,
	linkForce: 50,
	linkDistance: 110,
	stretchiness: 1.618,
	labelFadeZoom: 0.3,
	colorMode: 'language',
	clusterHubs: false,
	clusterThreshold: 15,
	clusterMode: 'none',
	colorGroups: [],
	showZones: true,
	hoverFocusEnabled: true,
	zoneColorMode: 'groups',
};

export class CodeGraphSettingTab extends PluginSettingTab {
	plugin: CodeGraphPlugin;

	constructor(app: App, plugin: CodeGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Keys whose change requires re-parsing the vault. Everything else only
	 * needs the graph views re-rendered.
	 */
	private static readonly INDEXING_KEYS = new Set([
		'codeExtensions',
		'excludeFolders',
		'excludeFileTypes',
	]);

	/**
	 * Declarative settings (Obsidian 1.13.0+): Obsidian renders, search-indexes,
	 * reads, writes, and persists every control here, and SKIPS display() when
	 * this method exists. Values flow through getControlValue/setControlValue
	 * below, where list-shaped settings are serialized/normalized and change
	 * side effects (reindex vs. re-render) are applied.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const edgeTypeItems: SettingGroupItem[] = ALL_EDGE_TYPES.map(
			(type): SettingGroupItem => ({
				name: EDGE_STYLE[type].label,
				desc: `Extract and display "${type}" edges.`,
				control: {
					type: 'toggle',
					key: `edgeTypesEnabled.${type}`,
				},
			}),
		);

		return [
			{
				type: 'group',
				heading: 'Indexing',
				items: [
					{
						name: 'Code file extensions',
						desc: 'Comma-separated extensions (no dots) treated as code files.',
						control: {
							type: 'text',
							key: 'codeExtensions',
							placeholder: 'ts, js, py, go...',
							validate: (value) =>
								/^[a-zA-Z0-9,.\s]*$/.test(value)
									? undefined
									: 'Use comma-separated extensions (letters and digits only).',
						},
					},
					{
						name: 'Exclude folders',
						desc: 'One folder per line. Matched at any depth by name (like a folder-name .gitignore).',
						control: {
							type: 'textarea',
							key: 'excludeFolders',
							rows: 12,
						},
					},
					{
						name: 'Exclude file types',
						desc: 'One suffix per line. Files whose name ends with these are skipped (e.g. "d.ts", "min.js", "test.ts").',
						control: {
							type: 'textarea',
							key: 'excludeFileTypes',
							rows: 8,
						},
					},
					{
						name: 'Reindex now',
						desc: 'Force a full re-parse of all code files.',
						action: () => {
							void this.plugin.reindex();
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Edge types',
				items: edgeTypeItems,
			},
			{
				type: 'group',
				heading: 'Behavior',
				items: [
					{
						name: 'Physics simulation',
						desc: 'Run the force-directed layout in the graph view.',
						control: { type: 'toggle', key: 'physicsEnabled' },
					},
					{
						name: 'Neighborhood hops',
						desc: 'When focused on a file, only show nodes within this many hops (0 = whole graph).',
						control: {
							type: 'number',
							key: 'neighborhoodHops',
							min: 0,
							step: 1,
							validate: (value) =>
								Number.isInteger(value) && value >= 0
									? undefined
									: 'Enter a whole number of 0 or more.',
						},
					},
					{
						name: 'Zone-aura source',
						desc: 'What drives the heatmap auras behind nodes — independent of the node fill color.',
						control: {
							type: 'dropdown',
							key: 'zoneColorMode',
							options: {
								groups: 'Color groups (manual)',
								community: 'Auto-detected communities',
								domain: '@domain tags',
							},
						},
					},
				],
			},
		];
	}

	/** Resolve a dotted key ("edgeTypesEnabled.imports") against settings. */
	private resolve(key: string): unknown {
		return key
			.split('.')
			.reduce<unknown>(
				(obj, seg) =>
					obj !== null && typeof obj === 'object'
						? (obj as Record<string, unknown>)[seg]
						: undefined,
				this.plugin.settings,
			);
	}

	/**
	 * Read a control value. List-shaped settings are serialized to the text
	 * the user edits; everything else resolves the dotted key directly.
	 */
	getControlValue(key: string): unknown {
		switch (key) {
			case 'codeExtensions':
				return this.plugin.settings.codeExtensions.join(', ');
			case 'excludeFolders':
				return this.plugin.settings.excludeFolders.join('\n');
			case 'excludeFileTypes':
				return this.plugin.settings.excludeFileTypes.join('\n');
			default:
				return this.resolve(key);
		}
	}

	/**
	 * Write a control value: normalize list-shaped settings back into their
	 * stored shape, persist, then apply the change's side effect (full reindex
	 * for indexing settings, re-render for display settings).
	 */
	setControlValue(key: string, value: unknown): void | Promise<void> {
		const settings = this.plugin.settings;
		if (key === 'codeExtensions' && typeof value === 'string') {
			settings.codeExtensions = value
				.split(',')
				.map((e) => e.trim().replace(/^\./, '').toLowerCase())
				.filter((e) => e.length > 0);
		} else if (key === 'excludeFolders' && typeof value === 'string') {
			settings.excludeFolders = value
				.split(/[\n,]/)
				.map((s) =>
					s.trim().replace(/^\.?\//, '').replace(/\/+$/, ''),
				)
				.filter((s) => s.length > 0);
		} else if (key === 'excludeFileTypes' && typeof value === 'string') {
			settings.excludeFileTypes = value
				.split(/[\n,]/)
				.map((s) => s.trim().replace(/^\.+/, '').toLowerCase())
				.filter((s) => s.length > 0);
		} else if (key.includes('.')) {
			const [head, ...rest] = key.split('.');
			if (head !== undefined) {
				const parent = (
					settings as unknown as Record<string, unknown>
				)[head];
				if (parent !== null && typeof parent === 'object') {
					(parent as Record<string, unknown>)[rest.join('.')] =
						value;
				}
			}
		} else {
			(settings as unknown as Record<string, unknown>)[key] = value;
		}
		const result = this.plugin.saveSettings();
		if (CodeGraphSettingTab.INDEXING_KEYS.has(key)) {
			void result.then(() => this.plugin.reindex());
			return;
		}
		this.plugin.refreshViews();
		return result;
	}

	/**
	 * Legacy imperative UI for Obsidian < 1.13.0 (which has no declarative
	 * settings API). On 1.13.0+ Obsidian calls getSettingDefinitions() and
	 * skips this method entirely.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Indexing').setHeading();

		new Setting(containerEl)
			.setName('Code file extensions')
			.setDesc('Comma-separated extensions (no dots) treated as code files.')
			.addText((text) =>
				text
					.setPlaceholder('Ts, js, py, go...')
					.setValue(this.plugin.settings.codeExtensions.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.codeExtensions = value
							.split(',')
							.map((e) => e.trim().replace(/^\./, '').toLowerCase())
							.filter((e) => e.length > 0);
						await this.plugin.saveSettings();
						void this.plugin.reindex();
					}),
			);

		const excludeSetting = new Setting(containerEl)
			.setName('Exclude folders')
			.setDesc(
				'One folder per line. Matched at any depth by name (like a folder-name .gitignore).',
			);
		excludeSetting.addTextArea((ta) => {
			ta.setValue(this.plugin.settings.excludeFolders.join('\n')).onChange(
				async (value) => {
					this.plugin.settings.excludeFolders = value
						.split(/[\n,]/)
						.map((s) =>
							s
								.trim()
								.replace(/^\.?\//, '')
								.replace(/\/+$/, ''),
						)
						.filter((s) => s.length > 0);
					await this.plugin.saveSettings();
					void this.plugin.reindex();
				},
			);
			ta.inputEl.addClass('code-graph-textarea');
			ta.inputEl.rows = 12;
		});
		excludeSetting.settingEl.addClass('code-graph-wide-setting');

		const excludeTypesSetting = new Setting(containerEl)
			.setName('Exclude file types')
			.setDesc(
				'One suffix per line. Files whose name ends with these are skipped (e.g. "d.ts", "min.js", "test.ts").',
			);
		excludeTypesSetting.addTextArea((ta) => {
			ta.setValue(this.plugin.settings.excludeFileTypes.join('\n')).onChange(
				async (value) => {
					this.plugin.settings.excludeFileTypes = value
						.split(/[\n,]/)
						.map((s) => s.trim().replace(/^\.+/, '').toLowerCase())
						.filter((s) => s.length > 0);
					await this.plugin.saveSettings();
					void this.plugin.reindex();
				},
			);
			ta.inputEl.addClass('code-graph-textarea');
			ta.inputEl.rows = 8;
		});
		excludeTypesSetting.settingEl.addClass('code-graph-wide-setting');

		new Setting(containerEl).setName('Edge types').setHeading();
		for (const type of ALL_EDGE_TYPES) {
			const style = EDGE_STYLE[type];
			new Setting(containerEl)
				.setName(style.label)
				.setDesc(`Extract and display "${type}" edges.`)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.edgeTypesEnabled[type])
						.onChange(async (on) => {
							this.plugin.settings.edgeTypesEnabled[type] = on;
							await this.plugin.saveSettings();
							this.plugin.refreshViews();
						}),
				);
		}

		new Setting(containerEl)
			.setName('Physics simulation')
			.setDesc('Run the force-directed layout in the graph view.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.physicsEnabled)
					.onChange(async (on) => {
						this.plugin.settings.physicsEnabled = on;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName('Neighborhood hops')
			.setDesc(
				'When focused on a file, only show nodes within this many hops (0 = whole graph).',
			)
			.addText((text) =>
				text
					.setPlaceholder('0')
					.setValue(String(this.plugin.settings.neighborhoodHops))
					.onChange(async (value) => {
						const n = Math.max(0, Math.floor(Number(value) || 0));
						this.plugin.settings.neighborhoodHops = n;
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName('Zone-aura source')
			.setDesc(
				'What drives the heatmap auras behind nodes — independent of the node fill color.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('groups', 'Color groups (manual)')
					.addOption('community', 'Auto-detected communities')
					.addOption('domain', '@domain tags')
					.setValue(this.plugin.settings.zoneColorMode)
					.onChange(async (value) => {
						this.plugin.settings.zoneColorMode = value as
							| 'groups'
							| 'community'
							| 'domain';
						await this.plugin.saveSettings();
						this.plugin.refreshViews();
					}),
			);

		new Setting(containerEl)
			.setName('Reindex now')
			.setDesc('Force a full re-parse of all code files.')
			.addButton((button) =>
				button.setButtonText('Reindex').onClick(async () => {
					await this.plugin.reindex();
				}),
			);
	}
}
