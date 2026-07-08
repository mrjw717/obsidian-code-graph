import { App, PluginSettingTab, Setting } from 'obsidian';
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
	// ── Physics forces (mirror Obsidian core graph controls) ──
	centerForce: number; // 0-100
	repelForce: number; // 0-100
	linkForce: number; // 0-100
	linkDistance: number; // 10-300
	// ── Zoom-based label visibility ──
	labelFadeZoom: number; // 0.0-2.0 — hide labels below this zoom
	// ── Coloring mode ──
	colorMode: ColorMode;
	// ── Hub clustering ──
	clusterHubs: boolean;
	clusterThreshold: number; // cluster nodes with degree above this
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

export const CURRENT_SETTINGS_VERSION = 8;

export const DEFAULT_SETTINGS: CodeGraphSettings = {
	settingsVersion: CURRENT_SETTINGS_VERSION,
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
	centerForce: 30,
	repelForce: 60,
	linkForce: 50,
	linkDistance: 110,
	labelFadeZoom: 0.3,
	colorMode: 'language',
	clusterHubs: false,
	clusterThreshold: 15,
	colorGroups: [
		{ id: 'g1', name: 'Core engine', query: 'domain:calculator', color: '#3b82f6', enabled: true },
		{ id: 'g2', name: 'UI components', query: 'path:components/', color: '#f59e0b', enabled: true },
		{ id: 'g3', name: 'Hooks', query: 'path:hooks/', color: '#10b981', enabled: true },
		{ id: 'g4', name: 'Ports/Adapters', query: 'path:adapters/', color: '#a855f7', enabled: true },
	],
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
