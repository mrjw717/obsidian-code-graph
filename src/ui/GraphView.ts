import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon, Menu } from 'obsidian';
import { DataSet, Network } from 'vis-network/standalone';
import type {
	Options,
	Node as VisNode,
	Edge as VisEdge,
} from 'vis-network/standalone';
import type CodeGraphPlugin from '../main';
import { VIEW_TYPE_CODE_GRAPH } from '../main';
import type { NodeSizingMode, ColorMode } from '../settings';
import {
	ALL_EDGE_TYPES,
	EDGE_STYLE,
	type EdgeArrow,
	type EdgeType,
	type GraphModel,
	type GraphNode,
	isSymbolKind,
	LANG_COLOR,
	SYMBOL_COLOR,
	detectCommunities,
	communityColor,
	matchesColorGroup,
} from '../types';

/** Convert any color string (hex or hsl) to rgba with given alpha. */
function colorToRgba(color: string, alpha: number): string {
	if (color.startsWith('hsl(')) {
		return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
	}
	if (color.startsWith('hsla(')) {
		return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
	}
	if (color.startsWith('#') && color.length >= 7) {
		const r = parseInt(color.slice(1, 3), 16);
		const g = parseInt(color.slice(3, 5), 16);
		const b = parseInt(color.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}
	return color;
}

function nodeStyle(
	n: GraphNode,
	size: number,
	isDead: boolean,
	colorMode: ColorMode,
	communityLabels: Map<string, number> | null,
	groupColors: { color: string }[] | null,
): Partial<VisNode> {
	// ── Check user-defined color groups first (highest priority) ──
	// Group overrides are applied via _overrideColor in buildData

	// ── Determine background color ──
	let color: string;
	if (isSymbolKind(n.kind)) {
		// Symbol nodes: use symbol colors UNLESS a group or community override exists
		const override = (n as unknown as { _overrideColor?: string })._overrideColor;
		color = override ?? SYMBOL_COLOR[n.kind] ?? '#64748b';
	} else if ((n as unknown as { _overrideColor?: string })._overrideColor) {
		// User-defined group match takes priority
		color = (n as unknown as { _overrideColor: string })._overrideColor;
	} else if (n.kind === 'note') {
		color = '#94a3b8';
	} else if (colorMode === 'community' && communityLabels) {
		const label = communityLabels.get(n.id) ?? 0;
		color = communityColor(label);
	} else if (colorMode === 'domain' && n.domain) {
		color = domainColor(n.domain);
	} else if (colorMode === 'status') {
		color = n.status ? (STATUS_COLOR[n.status] ?? '#64748b') : '#475569';
	} else {
		color = (n.lang ? LANG_COLOR[n.lang] : undefined) ?? '#64748b';
	}

	// ── Border (dead code or status override) ──
	let borderColor = isDead ? '#ef4444' : color;
	let borderWidth = isDead ? 2.5 : 1;
	if (colorMode === 'status' && n.status) {
		borderColor = STATUS_BORDER[n.status] ?? borderColor;
		borderWidth = STATUS_WIDTH[n.status] ?? borderWidth;
	}

	// ── Shadow glow for TODO / FIXME ──
	type Shadow = {
		enabled: boolean;
		color: string;
		size: number;
		x: number;
		y: number;
	};
	let shadow: Shadow | undefined;
	if (n.fixmeCount && n.fixmeCount > 0) {
		shadow = { enabled: true, color: 'rgba(239,68,68,0.5)', size: 18, x: 0, y: 0 };
	} else if (n.todoCount && n.todoCount > 0) {
		shadow = { enabled: true, color: 'rgba(249,115,22,0.4)', size: 15, x: 0, y: 0 };
	}

	// ── Label font: dark background + white text ──
	const fontSize = Math.max(12, Math.round(size));
	const isSym = isSymbolKind(n.kind);

	return {
		shape: 'dot',
		size,
		color: { background: color, border: borderColor },
		borderWidth,
		shadow,
		font: {
			color: '#ffffff',
			size: fontSize,
			background: isSym ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.75)',
			strokeWidth: 0,
			face: 'system-ui, -apple-system, sans-serif',
			align: 'center',
		},
	};
}

/** Deterministic color from a free-text domain string. */
function domainColor(domain: string): string {
	let hash = 0;
	for (let i = 0; i < domain.length; i++) {
		hash = domain.charCodeAt(i) + ((hash << 5) - hash);
	}
	const hue = Math.abs(hash) % 360;
	return `hsl(${hue}, 65%, 55%)`;
}

const STATUS_COLOR: Record<string, string> = {
	stable: '#22c55e',
	wip: '#f59e0b',
	deprecated: '#ef4444',
};

const STATUS_BORDER: Record<string, string> = {
	stable: '#16a34a',
	wip: '#d97706',
	deprecated: '#dc2626',
};

const STATUS_WIDTH: Record<string, number> = {
	stable: 1,
	wip: 2,
	deprecated: 2.5,
};

/**
 * Translate an EdgeArrow declaration into vis-network's `arrows` option.
 * Each declared direction gets a small arrowhead; undeclared directions are
 * explicitly disabled so per-edge settings override the global default.
 */
function arrowsFor(arrow: EdgeArrow): VisEdge['arrows'] {
	const head = { enabled: true, scaleFactor: 0.6 };
	switch (arrow) {
		case 'to':
			return { to: head };
		case 'from':
			return { from: head };
		case 'both':
			return { to: head, from: head };
		case 'none':
			return { to: { enabled: false }, from: { enabled: false } };
	}
}

function edgeStyle(type: EdgeType, weight: number): Partial<VisEdge> {
	const s = EDGE_STYLE[type];
	// Scale within per-type [baseWidth, maxWidth]: weight 1 = base, weight 10+ = max
	const t = Math.min(Math.max((weight - 1) / 9, 0), 1);
	const width = s.baseWidth + t * (s.maxWidth - s.baseWidth);
	return {
		color: { color: s.color, opacity: 0.85 },
		dashes: s.dashes,
		width,
		arrows: arrowsFor(s.arrow),
		// Per-type curvature so parallel edges between the same pair fan
		// out instead of overlapping. imports=0 (straight), calls=0.2,
		// uses-type=0.35, etc. — each type curves to a different lane.
		smooth: { enabled: true, type: 'continuous', roundness: s.roundness },
	};
}

/** Default edge opacity used by edgeStyle() — the "neutral" rest state. */
const DEFAULT_EDGE_OPACITY = 0.85;
/** Cap on direct neighbours considered for a single hover, for readability. */
const HOVER_NEIGHBOR_CAP = 50;
/** Max BFS hops for the hover attention gradient. */
const HOVER_MAX_HOPS = 3;

export class CodeGraphView extends ItemView {
	plugin: CodeGraphPlugin;
	network: Network | null = null;
	focusedId: string | null = null;

	private canvasEl: HTMLElement | null = null;
	private panelEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private nodeDS: DataSet<VisNode, 'id'> | null = null;
	private edgeDS: DataSet<VisEdge, 'id'> | null = null;
	private renderTimer: number | null = null;
	private panelCollapsed = false;
	private edgeSectionCollapsed = false;
	private nodeSectionCollapsed = false;
	private sizingSectionCollapsed = true;
	private displaySectionCollapsed = true;
	private forcesSectionCollapsed = true;
	private fileTypeSectionCollapsed = true;
	private hiddenExtensions = new Set<string>();
	private hiddenLabels = new Map<string, string>();
	private cachedCommunityLabels: Map<string, number> | null = null;
	private searchQuery = '';
	private hideIsolated = false;
	private expandedNodes = new Set<string>();
	/**
	 * Unified contextual-focus state. Shared by hover (dir === null) and the
	 * right-click "Find callers/callees" feature (dir === 'in' | 'out').
	 * `distances` maps visible node id → hop distance from `nodeId` (0 = the
	 * focused node itself). All opacity dimming flows through `applyHoverOpacity`.
	 */
	private hoverFocus: {
		nodeId: string;
		distances: Map<string, number>;
		dir: 'in' | 'out' | null;
	} | null = null;
	/** Transient edge-hover focus: highlights both endpoints, dims the rest. */
	private hoverEdgeId: string | null = null;
	/** Last fan-in / fan-out computed by buildData (for tooltips + sizing). */
	private cachedFanIn = new Map<string, number>();
	private cachedFanOut = new Map<string, number>();
	/** Base (un-focused) node size per id, for the hover 1.3x pop. */
	private nodeBaseSize = new Map<string, number>();
	/** Per-node displayed opacity (drives the smooth rAF transition). */
	private currentNodeOpacity = new Map<string, number>();
	/** Per-edge displayed opacity (drives the smooth rAF transition). */
	private currentEdgeOpacity = new Map<string, number>();
	private opacityRAF: number | null = null;
	private haloRAF: number | null = null;
	private hoverDebounceTimer: number | null = null;
	private contextMenuEl: HTMLElement | null = null;
	private lastModelHash = '';
	private animTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: CodeGraphPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_CODE_GRAPH;
	}

	getDisplayText(): string {
		return 'Code graph';
	}

	getIcon(): string {
		return 'git-graph';
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('code-graph-view');

		this.canvasEl = contentEl.createDiv({ cls: 'code-graph-canvas' });
		this.panelEl = contentEl.createDiv({ cls: 'code-graph-panel' });
		this.statusEl = contentEl.createDiv({ cls: 'code-graph-status' });

		// Right-click context menu on graph nodes
		this.registerDomEvent(this.canvasEl, 'contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (!this.network) return;
			const rect = this.canvasEl!.getBoundingClientRect();
			const nodeId = this.network.getNodeAt({
				x: e.clientX - rect.left,
				y: e.clientY - rect.top,
			});
			if (nodeId && typeof nodeId === 'string') {
				this.showContextMenu(e.clientX, e.clientY, nodeId);
			}
		});

		this.renderPanel();

		if (!this.plugin.graphModel) {
			this.setStatus('Building graph…');
			await this.plugin.reindex();
		}
		this.render();
	}

	async onClose(): Promise<void> {
		this.destroyNetwork();
	}

	private destroyNetwork(): void {
		if (this.opacityRAF !== null) {
			window.cancelAnimationFrame(this.opacityRAF);
			this.opacityRAF = null;
		}
		this.stopHaloLoop();
		if (this.hoverDebounceTimer !== null) {
			window.clearTimeout(this.hoverDebounceTimer);
			this.hoverDebounceTimer = null;
		}
		this.hoverFocus = null;
		this.hoverEdgeId = null;
		if (this.network) {
			this.network.destroy();
			this.network = null;
		}
		this.nodeDS = null;
		this.edgeDS = null;
	}

	private setStatus(text: string): void {
		if (this.statusEl) this.statusEl.setText(text);
	}

	/**
	 * Called by refreshViews() after reindex/remerge. Detects whether the
	 * model actually changed; if so, does a smooth diff update (preserving
	 * positions) with entrance animation for new nodes. If nothing changed,
	 * skips entirely — no jarring refresh.
	 */
	renderGraph(): void {
		const model = this.plugin.graphModel;
		if (!model) return;

		const hash = this.computeModelHash(model);
		if (hash === this.lastModelHash) return; // no structural change
		this.lastModelHash = hash;

		if (this.network && this.nodeDS && this.edgeDS) {
			// Network exists — smooth diff + entrance animation
			const newIds = this.updateVisible();
			this.animateEntrance(newIds);
		} else {
			// First render — full rebuild
			this.render();
		}
	}

	/** Fast structural hash: captures node/edge counts + metadata sums. */
	private computeModelHash(model: GraphModel): string {
		let nodeMeta = 0;
		let edgeMeta = 0;
		for (const n of Object.values(model.nodes)) {
			nodeMeta +=
				(n.lines ?? 0) +
				(n.todoCount ?? 0) * 100 +
				(n.fixmeCount ?? 0) * 10000;
		}
		for (const e of model.edges) edgeMeta += e.weight;
		return `${Object.keys(model.nodes).length}:${model.edges.length}:${nodeMeta}:${edgeMeta}`;
	}

	/**
	 * Apply hub clustering: collapse densely-connected nodes into translucent
	 * cluster "ghosts" so they don't obscure nodes behind them. Each hub gets
	 * its own cluster showing a count label. Double-click a cluster to expand.
	 */
	private applyClustering(): void {
		if (!this.network) return;
		const s = this.plugin.settings;
		if (!s.clusterHubs) return;

		// Collect hub node IDs FIRST (before clustering changes degrees)
		const body = (
			this.network as unknown as {
				body: {
					nodeIndices: string[];
					nodes: Record<string, unknown>;
				};
			}
		).body;
		const hubIds: string[] = [];
		for (const id of [...body.nodeIndices]) {
			if (!body.nodes[id]) continue;
			try {
				if (this.network.isCluster(id)) continue;
			} catch {
				continue;
			}
			const degree = this.network.getConnectedNodes(id).length;
			if (degree >= s.clusterThreshold) hubIds.push(id);
		}

		// Cluster each hub with its connections using translucent styling
		for (const id of hubIds) {
			try {
				this.network.clusterByConnection(id, {
					clusterNodeProperties: {
						shape: 'dot',
						color: {
							background: 'rgba(100, 116, 139, 0.12)',
							border: 'rgba(148, 163, 184, 0.4)',
						},
						borderWidth: 2,
						font: {
							color: '#94a3b8',
							size: 12,
							background: 'rgba(0, 0, 0, 0.4)',
							strokeWidth: 0,
						},
					},
					processProperties: function (
						opts: { label: string; size: number },
						children: unknown[],
					) {
						opts.label = `[${children.length}]`;
						opts.size = Math.max(
							28,
							Math.min(70, 18 + children.length * 3),
						);
						return opts;
					},
				});
			} catch {
				// node may have been clustered by a previous iteration
			}
		}
	}

	/**
	 * Smooth entrance animation for newly added nodes. Fades them in from
	 * opacity 0 over ~250ms with a slight size "pop" effect.
	 */
	private animateEntrance(newIds: string[]): void {
		if (newIds.length === 0 || newIds.length > 30) return; // skip for large batches
		if (!this.nodeDS) return;

		// Start invisible
		const startUpdates = newIds.map((id) => ({
			id,
			opacity: 0.01,
		}));
		this.nodeDS.update(startUpdates);

		// Animate over ~250ms (8 frames at ~30fps)
		let frame = 0;
		const totalFrames = 8;
		const animate = () => {
			frame++;
			const t = frame / totalFrames;
			const opacity = Math.min(t * t, 1); // ease-out quad
			const updates = newIds.map((id) => ({
				id,
				opacity,
			}));
			this.nodeDS?.update(updates);
			if (frame < totalFrames) {
				this.animTimer = window.requestAnimationFrame(animate);
			}
		};
		this.animTimer = window.requestAnimationFrame(animate);
	}

	// --- Floating, collapsible filter panel (native-graph style) ---

	private renderPanel(): void {
		if (!this.panelEl) return;
		this.panelEl.empty();
		this.panelEl.toggleClass('is-collapsed', this.panelCollapsed);

		if (this.panelCollapsed) {
			const btn = this.panelEl.createEl('button', {
				cls: 'code-graph-panel-expand',
				attr: { 'aria-label': 'Show filters' },
			});
			setIcon(btn, 'sliders-horizontal');
			btn.onclick = () => {
				this.panelCollapsed = false;
				this.renderPanel();
			};
			return;
		}

		const header = this.panelEl.createDiv({ cls: 'code-graph-panel-header' });
		header.createSpan({
			cls: 'code-graph-panel-title',
			text: 'Code graph',
		});
		const collapseBtn = header.createEl('button', {
			cls: 'code-graph-icon-btn',
			attr: { 'aria-label': 'Hide filters' },
		});
		setIcon(collapseBtn, 'x');
		collapseBtn.onclick = () => {
			this.panelCollapsed = true;
			this.renderPanel();
		};

		const body = this.panelEl.createDiv({ cls: 'code-graph-panel-body' });

		// Search / filter by name
		const searchWrap = body.createDiv({ cls: 'code-graph-search' });
		const search = searchWrap.createEl('input', {
			type: 'search',
			attr: { placeholder: 'Filter by name…' },
		});
		search.value = this.searchQuery;
		search.addEventListener('input', () => {
			this.searchQuery = search.value;
			this.scheduleUpdate();
		});

		// ── Collapsible: Edge types ──
		this.renderSection(body, 'Edge types', this.edgeSectionCollapsed, () => {
			this.edgeSectionCollapsed = !this.edgeSectionCollapsed;
			this.renderPanel();
		}, (container) => {
			for (const type of ALL_EDGE_TYPES) {
				this.renderEdgeLegendRow(container, type);
			}
		});

		// ── Collapsible: Nodes ──
		this.renderSection(body, 'Nodes', this.nodeSectionCollapsed, () => {
			this.nodeSectionCollapsed = !this.nodeSectionCollapsed;
			this.renderPanel();
		}, (container) => {
			this.renderNodeLegendRow(container, {
				label: 'Code files',
				color: '#3178c6',
				shape: 'dot',
				size: 13,
				isOn: this.plugin.settings.showCodeFiles,
				title: 'Source code files. Turn off for a notes-only or symbols-only view.',
				onToggle: () => {
					this.plugin.settings.showCodeFiles =
						!this.plugin.settings.showCodeFiles;
					void this.plugin.saveSettings();
					this.scheduleUpdate();
				},
			});
			this.renderNodeLegendRow(container, {
				label: 'Notes',
				color: '#94a3b8',
				shape: 'dot',
				size: 9,
				isOn: this.plugin.settings.showNotes,
				title: 'Markdown files in the vault. Shown only if they connect to code or other notes.',
				onToggle: () => void this.toggleNotes(),
			});
			this.renderNodeLegendRow(container, {
				label: 'Symbols',
				color: '#f59e0b',
				shape: 'dot',
				size: 7,
				isOn: this.plugin.settings.showSymbols,
				title: 'Functions, classes, methods — the actual building blocks. Or double-click a file node to expand its symbols.',
				onToggle: () => void this.toggleSymbols(),
			});
			this.renderNodeLegendRow(container, {
				label: 'Isolated',
				color: '#64748b',
				shape: 'dot',
				size: 11,
				isOn: !this.hideIsolated,
				title: 'Files with no visible edges — usually entry points, configs, or unused code.',
				onToggle: () => {
					this.hideIsolated = !this.hideIsolated;
					this.scheduleUpdate();
				},
			});
		});

		// ── Collapsible: File types (auto-detected from indexed files) ──
		this.renderSection(
			body,
			'File types',
			this.fileTypeSectionCollapsed,
			() => {
				this.fileTypeSectionCollapsed =
					!this.fileTypeSectionCollapsed;
				this.renderPanel();
			},
			(container) => {
				this.renderFileTypeSection(container);
			},
		);

		// ── Collapsible: Groups (user-defined color groups) ──
		this.renderSection(
			body,
			'Groups',
			this.nodeSectionCollapsed,
			() => {
				this.nodeSectionCollapsed = !this.nodeSectionCollapsed;
				this.renderPanel();
			},
			(container) => {
				this.renderGroupsSection(container);
			},
		);

		// ── Collapsible: Sizing ──
		this.renderSection(
			body,
			'Sizing',
			this.sizingSectionCollapsed,
			() => {
				this.sizingSectionCollapsed = !this.sizingSectionCollapsed;
				this.renderPanel();
			},
			(container) => {
				this.renderSizingSection(container);
			},
		);

		// ── Collapsible: Display ──
		this.renderSection(
			body,
			'Display',
			this.displaySectionCollapsed,
			() => {
				this.displaySectionCollapsed = !this.displaySectionCollapsed;
				this.renderPanel();
			},
			(container) => {
				this.renderDisplaySection(container);
			},
		);

		// ── Collapsible: Forces ──
		this.renderSection(
			body,
			'Forces',
			this.forcesSectionCollapsed,
			() => {
				this.forcesSectionCollapsed = !this.forcesSectionCollapsed;
				this.renderPanel();
			},
			(container) => {
				this.renderForcesSection(container);
			},
		);

		// Actions
		const actions = body.createDiv({ cls: 'code-graph-actions' });
		const focusLabel =
			this.plugin.settings.neighborhoodHops > 0 ? 'Neighbors' : 'All';
		this.actionButton(actions, focusLabel, 'focus', () =>
			void this.toggleFocus(),
		);
		this.actionButton(actions, 'Fit', 'maximize', () => {
			this.network?.fit({ animation: true });
		});
		const physLabel = this.plugin.settings.physicsEnabled ? 'Freeze' : 'Unfreeze';
		this.actionButton(actions, physLabel, 'snowflake', () =>
			void this.togglePhysics(),
		);
		this.actionButton(actions, 'Reindex', 'refresh-cw', () =>
			void this.plugin.reindex(),
		);
		this.actionButton(actions, 'Reset', 'rotate-ccw', () =>
			void this.resetFilters(),
		);
	}

	/** Reset ALL filters + view state + sizing to clean defaults. */
	private async resetFilters(): Promise<void> {
		const s = this.plugin.settings;
		// Edge types: all on
		for (const key of Object.keys(s.edgeTypesEnabled)) {
			s.edgeTypesEnabled[key as EdgeType] = true;
		}
		// Node visibility
		s.showCodeFiles = true;
		s.showNotes = true;
		s.showSymbols = false;
		s.showBadges = false;
		s.highlightDeadCode = true;
		// Sizing
		s.nodeSizingMode = 'constant';
		s.nodeSizeMin = 8;
		s.nodeSizeMax = 25;
		s.centerForce = 30;
		s.repelForce = 60;
		s.linkForce = 50;
		s.linkDistance = 110;
		s.labelFadeZoom = 0.3;
		s.colorMode = 'language';
		s.zoneColorMode = 'groups';
		s.clusterHubs = false;
		s.clusterThreshold = 15;
		s.showZones = true;
		// Focus / neighborhood
		s.neighborhoodHops = 0;
		s.physicsEnabled = true;
		// View-level state
		this.hideIsolated = false;
		this.searchQuery = '';
		this.focusedId = null;
		this.expandedNodes.clear();
		this.hiddenExtensions.clear();
		this.hoverFocus = null;
		this.hoverEdgeId = null;
		this.stopHaloLoop();
		this.edgeSectionCollapsed = false;
		this.nodeSectionCollapsed = false;
		this.fileTypeSectionCollapsed = true;
		this.sizingSectionCollapsed = true;
		this.displaySectionCollapsed = true;
		// Persist + rebuild
		await this.plugin.saveSettings();
		this.renderPanel();
		this.render();
		new Notice('Filters reset to defaults');
	}

	private toggleEdgeType(type: EdgeType): void {
		const newEnabled = !this.plugin.settings.edgeTypesEnabled[type];
		this.plugin.settings.edgeTypesEnabled[type] = newEnabled;
		void this.plugin.saveSettings();
		this.scheduleUpdate();
	}

	private toggleNotes(): void {
		this.plugin.settings.showNotes = !this.plugin.settings.showNotes;
		void this.plugin.saveSettings();
		this.scheduleUpdate();
	}

	private toggleSymbols(): void {
		this.plugin.settings.showSymbols = !this.plugin.settings.showSymbols;
		void this.plugin.saveSettings();
		this.scheduleUpdate();
	}

	private toggleFocus(): void {
		this.plugin.settings.neighborhoodHops =
			this.plugin.settings.neighborhoodHops > 0 ? 0 : 2;
		void this.plugin.saveSettings();
		this.renderPanel();
		this.scheduleUpdate();
	}

	private togglePhysics(): void {
		this.plugin.settings.physicsEnabled =
			!this.plugin.settings.physicsEnabled;
		void this.plugin.saveSettings();
		// Physics can be toggled in-place via setOptions — no full rebuild.
		if (this.network) {
			this.network.setOptions({
				physics: { enabled: this.plugin.settings.physicsEnabled },
			});
		}
	}

	// --- Collapsible section + legend row helpers ---

	private renderSection(
		parent: HTMLElement,
		title: string,
		collapsed: boolean,
		onToggleHeader: () => void,
		renderBody: (container: HTMLElement) => void,
	): void {
		const section = parent.createDiv({ cls: 'code-graph-section' });
		section.toggleClass('is-collapsed', collapsed);
		const header = section.createDiv({ cls: 'code-graph-section-header' });
		setIcon(
			header.createSpan({ cls: 'code-graph-chevron' }),
			collapsed ? 'chevron-right' : 'chevron-down',
		);
		header.createSpan({ cls: 'code-graph-section-title', text: title });
		header.onclick = () => onToggleHeader();
		if (!collapsed) {
			renderBody(section.createDiv({ cls: 'code-graph-section-body' }));
		}
	}

	private renderEdgeLegendRow(
		parent: HTMLElement,
		type: EdgeType,
	): void {
		const style = EDGE_STYLE[type];
		const enabled = this.plugin.settings.edgeTypesEnabled[type];
		const row = parent.createDiv({
			cls: `code-graph-legend-row${enabled ? ' is-on' : ''}`,
		});
		row.title = `${style.label} — ${style.description}`;
		const preview = row.createDiv({ cls: 'code-graph-edge-preview' });
		preview.toggleClass('is-dashed', style.dashes);
		preview.style.setProperty('--cg-color', style.color);
		row.createSpan({ cls: 'code-graph-legend-label', text: style.label });
		const dot = row.createSpan({ cls: 'code-graph-toggle-dot' });
		dot.style.setProperty('--cg-color', style.color);
		row.onclick = () => {
			row.toggleClass('is-on', !row.hasClass('is-on'));
			this.toggleEdgeType(type);
		};
	}

	private renderNodeLegendRow(
		parent: HTMLElement,
		opts: {
			label: string;
			color: string;
			shape: 'dot';
			size: number;
			isOn: boolean;
			title: string;
			onToggle: () => void;
			disabled?: boolean;
		},
	): void {
		const row = parent.createDiv({
			cls: `code-graph-legend-row${opts.isOn ? ' is-on' : ''}${opts.disabled ? ' is-disabled' : ''}`,
		});
		row.title = opts.title;
		// Dot preview
		const preview = row.createDiv({ cls: 'code-graph-node-preview' });
		preview.style.setProperty('--cg-color', opts.color);
		preview.style.setProperty('--cg-size', `${opts.size}px`);
		// Label
		row.createSpan({ cls: 'code-graph-legend-label', text: opts.label });
		// Toggle dot
		const dot = row.createSpan({ cls: 'code-graph-toggle-dot' });
		dot.style.setProperty('--cg-color', opts.color);
		if (!opts.disabled) {
			// Instant CSS toggle + debounced graph update
			row.onclick = () => {
				row.toggleClass('is-on', !row.hasClass('is-on'));
				opts.onToggle();
			};
		}
	}

	private renderForcesSection(parent: HTMLElement): void {
		const s = this.plugin.settings;
		const sliders: {
			key: 'centerForce' | 'repelForce' | 'linkForce' | 'linkDistance';
			label: string;
			min: string;
			max: string;
			title: string;
		}[] = [
			{ key: 'centerForce', label: 'Center', min: '0', max: '100', title: 'Gravity pulling nodes toward the center' },
			{ key: 'repelForce', label: 'Repel', min: '0', max: '100', title: 'Repulsion between nodes — higher = more spread out' },
			{ key: 'linkForce', label: 'Link', min: '0', max: '100', title: 'Spring stiffness between connected nodes' },
			{ key: 'linkDistance', label: 'Distance', min: '20', max: '300', title: 'Rest length of edges — higher = more spread out' },
		];
		for (const { key, label, min, max, title: tip } of sliders) {
			const row = parent.createDiv({ cls: 'code-graph-slider-row' });
			row.createSpan({ cls: 'code-graph-slider-label', text: label });
			const slider = row.createEl('input', {
				type: 'range',
				cls: 'code-graph-slider',
				attr: { min, max, value: String(s[key]), step: '1' },
			});
			slider.title = tip;
			const val = row.createSpan({
				cls: 'code-graph-slider-val',
				text: String(s[key]),
			});
			slider.oninput = () => {
				s[key] = Number(slider.value);
				val.setText(slider.value);
				// Apply physics in real-time without full rebuild
				if (this.network) {
					this.network.setOptions({
						physics: {
							barnesHut: {
								gravitationalConstant: -(s.repelForce / 100) * 12000,
								centralGravity: s.centerForce / 100,
								springConstant: (s.linkForce / 100) * 0.08,
								springLength: s.linkDistance,
							},
						},
					});
				}
			};
			slider.onchange = () => void this.plugin.saveSettings();
		}
		// Label fade threshold
		const fadeRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		fadeRow.createSpan({ cls: 'code-graph-slider-label', text: 'Labels' });
		const fadeSlider = fadeRow.createEl('input', {
			type: 'range',
			cls: 'code-graph-slider',
			attr: { min: '0', max: '100', value: String(Math.round(s.labelFadeZoom * 100)), step: '5' },
		});
		fadeSlider.title = 'Zoom level below which node labels are hidden for clarity';
		const fadeVal = fadeRow.createSpan({
			cls: 'code-graph-slider-val',
			text: `${Math.round(s.labelFadeZoom * 100)}%`,
		});
		fadeSlider.oninput = () => {
			s.labelFadeZoom = Number(fadeSlider.value) / 100;
			fadeVal.setText(`${fadeSlider.value}%`);
		};
		fadeSlider.onchange = () => void this.plugin.saveSettings();

		// ── Hub clustering toggle + threshold ──
		const clusterRow = parent.createDiv({
			cls: 'code-graph-slider-row',
		});
		clusterRow.createSpan({
			cls: 'code-graph-slider-label',
			text: 'Cluster',
		});
		const clusterToggle = clusterRow.createSpan({
			cls: `code-graph-mode-btn${s.clusterHubs ? ' is-active' : ''}`,
		});
		clusterToggle.setText(s.clusterHubs ? 'ON' : 'OFF');
		clusterToggle.title =
			'Collapse densely-connected nodes into clusters for readability';
		clusterToggle.toggleClass('code-graph-pointer', true);
		clusterToggle.onclick = () => {
			s.clusterHubs = !s.clusterHubs;
			void this.plugin.saveSettings();
			clusterToggle.setText(s.clusterHubs ? 'ON' : 'OFF');
			clusterToggle.toggleClass('is-active', s.clusterHubs);
			this.render();
		};
		const thresholdSlider = clusterRow.createEl('input', {
			type: 'range',
			cls: 'code-graph-slider',
			attr: {
				min: '5',
				max: '50',
				value: String(s.clusterThreshold),
			},
		});
		thresholdSlider.title =
			'Minimum number of connections for a node to be clustered';
		const thresholdVal = clusterRow.createSpan({
			cls: 'code-graph-slider-val',
			text: String(s.clusterThreshold),
		});
		thresholdSlider.oninput = () => {
			s.clusterThreshold = Number(thresholdSlider.value);
			thresholdVal.setText(thresholdSlider.value);
			if (s.clusterHubs) this.render();
		};
		thresholdSlider.onchange = () => void this.plugin.saveSettings();
	}

	// --- File type filter (auto-detected) ---

	private renderFileTypeSection(parent: HTMLElement): void {
		const model = this.plugin.graphModel;
		if (!model) return;
		// Detect extensions + their language from the model's code nodes
		const extInfo = new Map<string, { count: number; lang?: string }>();
		for (const n of Object.values(model.nodes)) {
			if (n.kind === 'code' && n.ext) {
				const existing = extInfo.get(n.ext);
				if (existing) existing.count++;
				else extInfo.set(n.ext, { count: 1, lang: n.lang });
			}
		}
		if (extInfo.size === 0) {
			parent.createSpan({
				cls: 'code-graph-hint',
				text: 'No code files indexed.',
			});
			return;
		}
		const sorted = Array.from(extInfo.entries()).sort(
			([a, ca], [b, cb]) => cb.count - ca.count || a.localeCompare(b),
		);
		for (const [ext, info] of sorted) {
			const color =
				(info.lang && LANG_COLOR[info.lang]) ?? '#64748b';
			const isOn = !this.hiddenExtensions.has(ext);
			const row = parent.createDiv({
				cls: `code-graph-legend-row${isOn ? ' is-on' : ''}`,
			});
			row.title = `Toggle .${ext} files (${info.count} files)`;
			const preview = row.createDiv({
				cls: 'code-graph-node-preview',
			});
			preview.setCssProps({ '--cg-color': color, '--cg-size': '10px' });
			row.createSpan({
				cls: 'code-graph-legend-label',
				text: `.${ext}`,
			});
			row.createSpan({
				cls: 'code-graph-legend-count',
				text: String(info.count),
			});
			const dot = row.createSpan({
				cls: 'code-graph-toggle-dot',
			});
			dot.style.setProperty('--cg-color', color);
			row.onclick = () => {
				row.toggleClass('is-on', !row.hasClass('is-on'));
				if (this.hiddenExtensions.has(ext)) {
					this.hiddenExtensions.delete(ext);
				} else {
					this.hiddenExtensions.add(ext);
				}
				this.scheduleUpdate();
			};
		}
	}

	// --- Sizing + Display panel sections ---

	// --- Color groups (Obsidian-like) ---

	private renderGroupsSection(parent: HTMLElement): void {
		const s = this.plugin.settings;
		for (const group of s.colorGroups) {
			const row = parent.createDiv({
				cls: `code-graph-legend-row${group.enabled ? ' is-on' : ''}`,
			});
			row.title = `Query: ${group.query}`;
			const preview = row.createDiv({ cls: 'code-graph-node-preview' });
			preview.setCssProps({ '--cg-color': group.color, '--cg-size': '10px' });
			row.createSpan({
				cls: 'code-graph-legend-label',
				text: group.name,
			});
			row.createSpan({
				cls: 'code-graph-legend-count',
				text: group.query,
			});
			const dot = row.createSpan({ cls: 'code-graph-toggle-dot' });
			dot.style.setProperty('--cg-color', group.color);
			row.onclick = () => {
				group.enabled = !group.enabled;
				void this.plugin.saveSettings();
				row.toggleClass('is-on', group.enabled);
				this.updateVisible();
			};
		}
	}

	private renderSizingSection(parent: HTMLElement): void {
		const s = this.plugin.settings;
		// ── Color by selector ──
		const colorRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		colorRow.createSpan({
			cls: 'code-graph-slider-label',
			text: 'Color',
		});
		const colorBtns = colorRow.createDiv({ cls: 'code-graph-mode-row code-graph-flex-1' });
		const colorModes: {
			id: ColorMode;
			label: string;
			title: string;
		}[] = [
			{ id: 'language', label: 'Lang', title: 'Color by file language' },
			{ id: 'community', label: 'Auto', title: 'Auto-detect communities from edge density — reveals natural architecture' },
			{ id: 'domain', label: 'Domain', title: 'Color by @domain tag' },
			{ id: 'status', label: 'Status', title: 'Color by @status tag (stable/wip/deprecated)' },
		];
		for (const cm of colorModes) {
			const btn = colorBtns.createSpan({
				cls: `code-graph-mode-btn${s.colorMode === cm.id ? ' is-active' : ''}`,
			});
			btn.setText(cm.label);
			btn.title = cm.title;
			btn.onclick = () => {
				s.colorMode = cm.id;
				void this.plugin.saveSettings();
				colorBtns
					.querySelectorAll('.code-graph-mode-btn')
					.forEach((el) => el.removeClass('is-active'));
				btn.addClass('is-active');
				this.updateVisible();
			};
		}
		// ── Auras selector (zone-aura heatmap source, independent of fill) ──
		const auraRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		auraRow.createSpan({
			cls: 'code-graph-slider-label',
			text: 'Auras',
		});
		const auraBtns = auraRow.createDiv({ cls: 'code-graph-mode-row code-graph-flex-1' });
		const auraModes: {
			id: 'groups' | 'community' | 'domain';
			label: string;
			title: string;
		}[] = [
			{ id: 'groups', label: 'Groups', title: 'Aura color from user-defined color groups' },
			{ id: 'community', label: 'Auto', title: 'Aura color from auto-detected communities' },
			{ id: 'domain', label: 'Domain', title: 'Aura color from @domain tags' },
		];
		for (const am of auraModes) {
			const btn = auraBtns.createSpan({
				cls: `code-graph-mode-btn${s.zoneColorMode === am.id ? ' is-active' : ''}`,
			});
			btn.setText(am.label);
			btn.title = am.title;
			btn.onclick = () => {
				s.zoneColorMode = am.id;
				void this.plugin.saveSettings();
				auraBtns
					.querySelectorAll('.code-graph-mode-btn')
					.forEach((el) => el.removeClass('is-active'));
				btn.addClass('is-active');
				this.updateVisible();
			};
		}
		// ── Size by selector ──
		const modes: {
			id: NodeSizingMode;
			label: string;
			title: string;
		}[] = [
			{
				id: 'constant',
				label: 'Auto',
				title: 'Size by total connections (fan-in + fan-out)',
			},
			{
				id: 'lines',
				label: 'LOC',
				title: 'Size by lines of code — bigger nodes = more code',
			},
			{
				id: 'fan-in',
				label: 'Fan-in',
				title: 'Size by incoming dependencies — how much depends on this (importance)',
			},
			{
				id: 'fan-out',
				label: 'Fan-out',
				title: 'Size by outgoing dependencies — how much this depends on others (coupling)',
			},
		];
		const modeRow = parent.createDiv({ cls: 'code-graph-mode-row' });
		for (const m of modes) {
			const btn = modeRow.createSpan({
				cls: `code-graph-mode-btn${s.nodeSizingMode === m.id ? ' is-active' : ''}`,
			});
			btn.setText(m.label);
			btn.title = m.title;
			btn.onclick = () => {
				s.nodeSizingMode = m.id;
				void this.plugin.saveSettings();
				modeRow
					.querySelectorAll('.code-graph-mode-btn')
					.forEach((el) => el.removeClass('is-active'));
				btn.addClass('is-active');
				this.updateVisible();
			};
		}
		// Min slider
		const minRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		minRow.createSpan({ cls: 'code-graph-slider-label', text: 'Min' });
		const minSlider = minRow.createEl('input', {
			type: 'range',
			cls: 'code-graph-slider',
			attr: {
				min: '3',
				max: '20',
				value: String(s.nodeSizeMin),
			},
		});
		const minVal = minRow.createSpan({
			cls: 'code-graph-slider-val',
			text: String(s.nodeSizeMin),
		});
		minSlider.oninput = () => {
			s.nodeSizeMin = Number(minSlider.value);
			minVal.setText(minSlider.value);
			this.scheduleUpdate();
		};
		// Max slider
		const maxRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		maxRow.createSpan({ cls: 'code-graph-slider-label', text: 'Max' });
		const maxSlider = maxRow.createEl('input', {
			type: 'range',
			cls: 'code-graph-slider',
			attr: {
				min: '15',
				max: '50',
				value: String(s.nodeSizeMax),
			},
		});
		const maxVal = maxRow.createSpan({
			cls: 'code-graph-slider-val',
			text: String(s.nodeSizeMax),
		});
		maxSlider.oninput = () => {
			s.nodeSizeMax = Number(maxSlider.value);
			maxVal.setText(maxSlider.value);
			this.scheduleUpdate();
		};
	}

	private renderDisplaySection(parent: HTMLElement): void {
		const s = this.plugin.settings;
		this.renderNodeLegendRow(parent, {
			label: 'Zone auras',
			color: '#8b5cf6',
			shape: 'dot',
			size: 10,
			isOn: s.showZones,
			title:
				'Draw translucent background zones behind community/color groups. Shows natural architecture clusters.',
			onToggle: () => {
				s.showZones = !s.showZones;
				void this.plugin.saveSettings();
				this.updateVisible();
			},
		});
		this.renderNodeLegendRow(parent, {
			label: 'Highlight dead code',
			color: '#ef4444',
			shape: 'dot',
			size: 10,
			isOn: s.highlightDeadCode,
			title:
				'Files with zero incoming edges get a red ring — likely entry points or dead code.',
			onToggle: () => {
				s.highlightDeadCode = !s.highlightDeadCode;
				void this.plugin.saveSettings();
				this.updateVisible();
			},
		});
		this.renderNodeLegendRow(parent, {
			label: 'Edge count badges',
			color: '#6366f1',
			shape: 'dot',
			size: 10,
			isOn: s.showBadges,
			title:
				'Show ↓incoming ↑outgoing edge counts next to each node name.',
			onToggle: () => {
				s.showBadges = !s.showBadges;
				void this.plugin.saveSettings();
				this.updateVisible();
			},
		});
		this.renderNodeLegendRow(parent, {
			label: 'Hover focus',
			color: '#06b6d4',
			shape: 'dot',
			size: 10,
			isOn: s.hoverFocusEnabled,
			title:
				'Dim distant nodes on hover to spotlight a node\u2019s neighborhood. Right-click \u2192 Find callers/callees uses the same system.',
			onToggle: () => {
				s.hoverFocusEnabled = !s.hoverFocusEnabled;
				void this.plugin.saveSettings();
				if (!s.hoverFocusEnabled) {
					this.hoverFocus = null;
					this.hoverEdgeId = null;
					this.stopHaloLoop();
					this.applyHoverOpacity(true);
					this.applyHoverSize();
				}
			},
		});
	}

	// --- Context menu + highlight ---

	private showContextMenu(x: number, y: number, nodeId: string): void {
		const model = this.plugin.graphModel;
		const node = model?.nodes[nodeId];
		if (!node) return;
		const isFile = node.kind === 'code';
		const isExpanded = this.expandedNodes.has(nodeId);
		const filePath = nodeId.includes('#')
			? (nodeId.split('#')[0] ?? nodeId)
			: nodeId;

		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle('Open file');
			item.setIcon('file-text');
			item.onClick(() => void this.openFile(nodeId));
		});
		if (isFile && !this.plugin.settings.showSymbols) {
			menu.addItem((item) => {
				item.setTitle(
					isExpanded ? 'Collapse symbols' : 'Expand symbols',
				);
				item.setIcon(
					isExpanded ? 'chevrons-down-up' : 'chevrons-up-down',
				);
				item.onClick(() => {
					if (isExpanded) this.expandedNodes.delete(nodeId);
					else this.expandedNodes.add(nodeId);
					this.updateVisible();
				});
			});
		}
		menu.addItem((item) => {
			item.setTitle('Find callers');
			item.setIcon('arrow-left');
			item.onClick(() => this.setHighlight(nodeId, 'in'));
		});
		menu.addItem((item) => {
			item.setTitle('Find callees');
			item.setIcon('arrow-right');
			item.onClick(() => this.setHighlight(nodeId, 'out'));
		});
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle('Focus neighborhood');
			item.setIcon('focus');
			item.onClick(() => {
				this.focusedId = nodeId;
				this.plugin.settings.neighborhoodHops = 2;
				void this.plugin.saveSettings();
				this.renderPanel();
				this.updateVisible();
			});
		});
		menu.addItem((item) => {
			item.setTitle('Copy path');
			item.setIcon('clipboard-copy');
			item.onClick(() => {
				void navigator.clipboard.writeText(filePath);
				new Notice(`Copied: ${filePath}`);
			});
		});
		menu.showAtPosition({ x, y });
	}

	/**
	 * Right-click "Find callers/callees" — sets a STICKY hoverFocus (dir set).
	 * Computes a directional 1-hop distance map and routes through the same
	 * animated opacity layer as hover. Toggling the same dir clears it.
	 */
	private setHighlight(nodeId: string, dir: 'in' | 'out'): void {
		if (this.hoverFocus?.nodeId === nodeId && this.hoverFocus.dir === dir) {
			this.hoverFocus = null;
		} else {
			const model = this.plugin.graphModel;
			const enabled = this.plugin.settings.edgeTypesEnabled;
			const distances = new Map<string, number>([[nodeId, 0]]);
			if (model) {
				for (const e of model.edges) {
					if (!enabled[e.type]) continue;
					if (e.type === 'contains') continue;
					if (dir === 'in' && e.dst === nodeId)
						distances.set(e.src, 1);
					if (dir === 'out' && e.src === nodeId)
						distances.set(e.dst, 1);
				}
			}
			this.hoverFocus = { nodeId, distances, dir };
		}
		this.hoverEdgeId = null;
		this.applyHoverOpacity(true);
		this.applyHoverSize();
		if (this.hoverFocus) this.startHaloLoop();
		else this.stopHaloLoop();
	}

	// ── Hover contextual focus ──

	/** Begin a transient (dir === null) hover focus on `nodeId`. */
	private setHoverFocus(nodeId: string): void {
		if (!this.plugin.settings.hoverFocusEnabled) return;
		const model = this.plugin.graphModel;
		if (!model) return;
		if (this.hoverFocus?.nodeId === nodeId && this.hoverFocus.dir === null)
			return;
		const enabled = this.plugin.settings.edgeTypesEnabled;
		const distances = this.computeHopDistances(
			model,
			nodeId,
			HOVER_MAX_HOPS,
			enabled,
		);
		this.hoverFocus = { nodeId, distances, dir: null };
		this.hoverEdgeId = null;
		this.enhanceTooltip(nodeId);
		this.applyHoverOpacity(true);
		this.applyHoverSize();
		this.startHaloLoop();
	}

	/** End a transient hover. Sticky (dir set) focuses are left intact. */
	private clearHoverFocus(): void {
		if (!this.hoverFocus || this.hoverFocus.dir !== null) return;
		this.hoverFocus = null;
		this.stopHaloLoop();
		this.applyHoverOpacity(true);
		this.applyHoverSize();
	}

	/** Hover an edge: spotlight both endpoints, dim the rest to 0.3. */
	private setHoverEdge(edgeId: string): void {
		if (!this.plugin.settings.hoverFocusEnabled) return;
		if (this.hoverEdgeId === edgeId) return;
		this.hoverEdgeId = edgeId;
		this.applyHoverOpacity(true);
	}

	private clearHoverEdge(): void {
		if (this.hoverEdgeId === null) return;
		this.hoverEdgeId = null;
		this.applyHoverOpacity(true);
	}

	/** Opacity for a node at a given hop distance (undefined = unconnected). */
	private opacityForDistance(d: number | undefined): number {
		if (d === undefined) return 0.05;
		if (d <= 0) return 1.0;
		if (d === 1) return 1.0;
		if (d === 2) return 0.5;
		return 0.1; // 3+
	}

	/** Parse an edge id (`src\u0001dst\u0001type`) back into its base color. */
	private edgeColorFromId(edgeId: string): string {
		const parts = edgeId.split('\u0001');
		const type = parts[2] as EdgeType;
		return EDGE_STYLE[type]?.color ?? '#94a3b8';
	}

	/**
	 * Compute target node + edge opacities from the current focus state.
	 * Returns fresh maps covering every currently-visible id.
	 */
	private computeHoverTargets(): {
		nodes: Map<string, number>;
		edges: Map<string, number>;
	} {
		const nodeTargets = new Map<string, number>();
		const edgeTargets = new Map<string, number>();
		if (!this.nodeDS || !this.edgeDS) return { nodes: nodeTargets, edges: edgeTargets };

		const nodeIds = this.nodeDS.getIds() as string[];
		const edgeIds = this.edgeDS.getIds() as string[];

		// Edge hover takes precedence over node hover.
		if (this.hoverEdgeId && this.edgeDS.get(this.hoverEdgeId)) {
			const edge = this.edgeDS.get(this.hoverEdgeId) as
				| { from?: string; to?: string }
				| undefined;
			const from = edge?.from;
			const to = edge?.to;
			for (const id of nodeIds) {
				nodeTargets.set(id, id === from || id === to ? 1.0 : 0.3);
			}
			for (const id of edgeIds) {
				edgeTargets.set(
					id,
					id === this.hoverEdgeId ? 1.0 : 0.08,
				);
			}
			return { nodes: nodeTargets, edges: edgeTargets };
		}

		if (!this.hoverFocus) {
			for (const id of nodeIds) nodeTargets.set(id, 1.0);
			for (const id of edgeIds)
				edgeTargets.set(id, DEFAULT_EDGE_OPACITY);
			return { nodes: nodeTargets, edges: edgeTargets };
		}

		const { distances, dir, nodeId } = this.hoverFocus;
		for (const id of nodeIds) {
			nodeTargets.set(id, this.opacityForDistance(distances.get(id)));
		}
		for (const id of edgeIds) {
			const edge = this.edgeDS.get(id) as
				| { from?: string; to?: string }
				| undefined;
			const f = edge?.from;
			const t = edge?.to;
			if (!f || !t) {
				edgeTargets.set(id, 0.05);
				continue;
			}
			if (dir) {
				// Directional (callers/callees): only the matched edges stay lit.
				const connected =
					(dir === 'in' && t === nodeId) ||
					(dir === 'out' && f === nodeId);
				edgeTargets.set(id, connected ? DEFAULT_EDGE_OPACITY : 0.05);
				continue;
			}
			// Undirected hover: both endpoints ≤1 → full; max is 2 → 40%; else 5%.
			const df = distances.get(f);
			const dt = distances.get(t);
			const maxD = Math.max(df ?? 99, dt ?? 99);
			if (df === undefined && dt === undefined) {
				edgeTargets.set(id, 0.05);
			} else if (maxD <= 1) {
				edgeTargets.set(id, DEFAULT_EDGE_OPACITY);
			} else if (maxD === 2) {
				edgeTargets.set(id, 0.4);
			} else {
				edgeTargets.set(id, 0.05);
			}
		}
		return { nodes: nodeTargets, edges: edgeTargets };
	}

	/**
	 * Apply the current focus opacity, optionally animating the transition
	 * (~200ms in, ~300ms out) via requestAnimationFrame. Updates only the
	 * nodes/edges whose opacity actually changes — preserves positions and
	 * never rebuilds the Network.
	 */
	private applyHoverOpacity(animate: boolean): void {
		if (!this.nodeDS || !this.edgeDS) return;
		if (this.opacityRAF !== null) {
			window.cancelAnimationFrame(this.opacityRAF);
			this.opacityRAF = null;
		}
		const { nodes: nodeTargets, edges: edgeTargets } =
			this.computeHoverTargets();

		const fromNode = new Map<string, number>();
		const fromEdge = new Map<string, number>();
		for (const id of nodeTargets.keys()) {
			fromNode.set(id, this.currentNodeOpacity.get(id) ?? 1.0);
		}
		for (const id of edgeTargets.keys()) {
			fromEdge.set(
				id,
				this.currentEdgeOpacity.get(id) ?? DEFAULT_EDGE_OPACITY,
			);
		}

		const commit = (t: number): void => {
			const nodeUpdates: VisNode[] = [];
			for (const [id, target] of nodeTargets) {
				const from = fromNode.get(id) ?? 1.0;
				const val = from + (target - from) * t;
				const prev = this.currentNodeOpacity.get(id);
				this.currentNodeOpacity.set(id, val);
				if (prev === undefined || Math.abs(val - prev) > 0.004) {
					nodeUpdates.push({ id, opacity: val });
				}
			}
			if (nodeUpdates.length > 0) this.nodeDS?.update(nodeUpdates);

			const edgeUpdates: VisEdge[] = [];
			for (const [id, target] of edgeTargets) {
				const from = fromEdge.get(id) ?? DEFAULT_EDGE_OPACITY;
				const val = from + (target - from) * t;
				const prev = this.currentEdgeOpacity.get(id);
				this.currentEdgeOpacity.set(id, val);
				if (prev === undefined || Math.abs(val - prev) > 0.004) {
					const color = this.edgeColorFromId(id);
					edgeUpdates.push({
						id,
						color: { color, opacity: val },
					});
				}
			}
			if (edgeUpdates.length > 0) this.edgeDS?.update(edgeUpdates);
		};

		if (!animate) {
			commit(1);
			return;
		}

		const duration = this.hoverFocus || this.hoverEdgeId ? 200 : 300;
		const start = performance.now();
		const step = (now: number): void => {
			const raw = Math.min((now - start) / duration, 1);
			const t = raw * (2 - raw); // ease-out quad
			commit(t);
			if (raw < 1) {
				this.opacityRAF = window.requestAnimationFrame(step);
			} else {
				this.opacityRAF = null;
			}
		};
		this.opacityRAF = window.requestAnimationFrame(step);
	}

	/**
	 * Pop the focused node to 1.3x its base size; restore everything else.
	 * Only touches the hovered node + the previously-hovered one.
	 */
	private applyHoverSize(): void {
		if (!this.nodeDS) return;
		const updates: VisNode[] = [];
		const focusedId = this.hoverFocus?.nodeId;
		for (const [id, base] of this.nodeBaseSize) {
			const want = id === focusedId ? base * 1.3 : base;
			updates.push({ id, size: want });
		}
		if (updates.length > 0) this.nodeDS.update(updates);
	}

	/** Enrich the hovered node's tooltip with fan-in/fan-out + community. */
	private enhanceTooltip(nodeId: string): void {
		if (!this.nodeDS) return;
		const model = this.plugin.graphModel;
		const n = model?.nodes[nodeId];
		if (!n) return;
		const fi = this.cachedFanIn.get(nodeId) ?? 0;
		const fo = this.cachedFanOut.get(nodeId) ?? 0;
		const comm = this.cachedCommunityLabels?.get(nodeId);
		const commStr =
			comm !== undefined ? ` · community #${comm}` : '';
		const isSym = isSymbolKind(n.kind);
		const base = isSym
			? `${n.path}:${n.line ?? '?'} — ${n.name} (${n.kind})`
			: n.path;
		// Documentation-protocol metadata lines (domain / status / author).
		// Shown only when present so trivial files keep a compact tooltip.
		const metaParts: string[] = [];
		if (n.domain) metaParts.push(`domain: ${n.domain}`);
		if (n.status) metaParts.push(`status: ${n.status}`);
		if (n.author) metaParts.push(`author: ${n.author}`);
		const metaStr = metaParts.length > 0 ? `\n${metaParts.join(' · ')}` : '';
		const title = `${base}${metaStr}\n↓${fi} incoming · ↑${fo} outgoing${commStr}`;
		this.nodeDS.update([{ id: nodeId, title }]);
	}

	/** Continuous redraw loop so the halo can pulse while hovering. */
	private startHaloLoop(): void {
		if (this.haloRAF !== null) return;
		const tick = (): void => {
			if (!this.hoverFocus || !this.network) {
				this.haloRAF = null;
				return;
			}
			this.network.redraw();
			this.haloRAF = window.requestAnimationFrame(tick);
		};
		this.haloRAF = window.requestAnimationFrame(tick);
	}

	private stopHaloLoop(): void {
		if (this.haloRAF !== null) {
			window.cancelAnimationFrame(this.haloRAF);
			this.haloRAF = null;
		}
	}

	private actionButton(
		parent: HTMLElement,
		label: string,
		icon: string,
		onClick: () => void,
	): void {
		const btn = parent.createEl('button', { cls: 'code-graph-action-btn' });
		setIcon(btn.createSpan({ cls: 'code-graph-action-icon' }), icon);
		btn.createSpan({ text: label });
		btn.onclick = onClick;
	}

	private render(): void {
		if (!this.canvasEl) return;
		this.destroyNetwork();
		this.canvasEl.empty();

		const model = this.plugin.graphModel;
		if (!model) {
			this.setStatus('Building graph…');
			return;
		}

		const { nodes, edges } = this.buildData(model);
		if (nodes.length === 0) {
			this.canvasEl.createDiv({ cls: 'code-graph-empty', text: '' });
			this.setStatus('');
			return;
		}

		const nodeDS = new DataSet<VisNode, 'id'>(nodes);
		const edgeDS = new DataSet<VisEdge, 'id'>(edges);
		this.nodeDS = nodeDS;
		this.edgeDS = edgeDS;
		this.network = new Network(
			this.canvasEl,
			{ nodes: nodeDS, edges: edgeDS },
			this.buildOptions(),
		);
			this.network.on('click', (params) => {
			const typed = params as { nodes?: string[] } | undefined;
			const id = typed?.nodes?.[0];
			if (id) {
				// Don't try to open files for cluster nodes
				try {
					if (this.network?.isCluster(id)) {
						this.focusedId = id;
						return;
					}
				} catch {
					// ignore
				}
				this.focusedId = id;
				if (this.plugin.settings.neighborhoodHops > 0) this.updateVisible();
				void this.openFile(id);
			} else {
				// Click empty canvas — clear contextual focus
				if (this.hoverFocus) {
					this.hoverFocus = null;
					this.stopHaloLoop();
					this.applyHoverOpacity(true);
					this.applyHoverSize();
				}
			}
		});
		this.network.on('doubleClick', (params) => {
			const typed = params as { nodes?: string[] } | undefined;
			const id = typed?.nodes?.[0];
			if (!id) return;

			// Cluster expansion takes priority
			try {
				if (this.network?.isCluster(id)) {
					this.network.openCluster(id);
					return;
				}
			} catch {
				// not a cluster, continue
			}

			if (id.includes('#')) return; // only file nodes for expand/collapse
			if (this.expandedNodes.has(id)) {
				this.expandedNodes.delete(id);
			} else {
				this.expandedNodes.add(id);
			}
			this.updateVisible();
		});
		// Zone heatmap: each node emits a soft colored glow. Overlapping glows
		// accumulate (additive blending) to create a refined heatmap where dense
		// code clusters glow brighter. Smoothed via position interpolation.
		const heatPosCache = new Map<string, { x: number; y: number }>();

		this.network.on('beforeDrawing', (rawCtx: unknown) => {
			const ctx = rawCtx as CanvasRenderingContext2D;
			if (!ctx) return;

			const s = this.plugin.settings;
			if (!s.showZones) return;

			const drawCommunities =
				this.cachedCommunityLabels &&
				this.cachedCommunityLabels.size > 0;
			const activeGroups = s.colorGroups.filter((g) => g.enabled);
			const model = this.plugin.graphModel;
			// Short-circuit only when the ACTIVE zoneColorMode has nothing to
			// draw — a domain/groups/community mode with no data should not
			// pay the per-node loop cost.
			const domainHasAny =
				s.zoneColorMode === 'domain' &&
				!!model &&
				Object.values(model.nodes).some((n) => n.domain);
			const groupsActive = s.zoneColorMode === 'groups' && activeGroups.length > 0;
			const commActive = s.zoneColorMode === 'community' && drawCommunities;
			if (!domainHasAny && !groupsActive && !commActive) return;

			const scale = this.network?.getScale() ?? 1;
			// Blob radius inversely scales with zoom — bigger blobs when zoomed out
			const blobRadius = Math.max(40, 90 / scale);

			const positions = this.network?.getPositions();
			if (!positions) return;

			// Additive blending for heatmap accumulation
			ctx.save();
			ctx.globalCompositeOperation = 'lighter';

			for (const id of Object.keys(positions)) {
				const pos = positions[id];
				if (!pos) continue;

				// When a contextual focus is active, fade zone auras for nodes
				// that are ghosted (3+ hops or unconnected) so the spotlight
				// naturally tightens.
				if (this.hoverFocus) {
					const d = this.hoverFocus.distances.get(id);
					if (d === undefined || d >= 3) continue;
				}

			// Determine zone color for this node, keyed on zoneColorMode
			// (independent of node-fill colorMode).
			let color: string | null = null;
			if (s.zoneColorMode === 'domain' && model) {
				const node = model.nodes[id];
				if (node?.domain) color = domainColor(node.domain);
			} else if (s.zoneColorMode === 'groups' && activeGroups.length > 0 && model) {
				const node = model.nodes[id];
				if (node) {
					for (const g of activeGroups) {
						if (matchesColorGroup(node, g.query)) {
							color = g.color;
							break;
						}
					}
				}
			} else if (s.zoneColorMode === 'community' && drawCommunities && this.cachedCommunityLabels) {
				const label = this.cachedCommunityLabels.get(id);
				if (label !== undefined) color = communityColor(label);
			}
			if (!color) continue;

				// Smooth position (lerp cached toward actual — prevents jitter)
				const cached = heatPosCache.get(id);
				const drawX = cached ? cached.x + (pos.x - cached.x) * 0.15 : pos.x;
				const drawY = cached ? cached.y + (pos.y - cached.y) * 0.15 : pos.y;
				heatPosCache.set(id, { x: drawX, y: drawY });

				// Draw soft Gaussian-like glow
				const grad = ctx.createRadialGradient(
					drawX, drawY, 0,
					drawX, drawY, blobRadius,
				);
				grad.addColorStop(0, colorToRgba(color, 0.07));
				grad.addColorStop(0.4, colorToRgba(color, 0.03));
				grad.addColorStop(1, colorToRgba(color, 0));
				ctx.fillStyle = grad;
				ctx.beginPath();
				ctx.arc(drawX, drawY, blobRadius, 0, Math.PI * 2);
				ctx.fill();
			}

			ctx.restore();
		});

		this.network.once('stabilizationIterationsDone', () => {
			this.network?.fit({ animation: true });
			this.applyClustering();
		});
		// Zoom-based label fade: hide labels when zoomed out for readability
		let labelsHidden = false;
		this.network.on('zoom', (params: { scale: number }) => {
			const threshold = this.plugin.settings.labelFadeZoom;
			const shouldHide = params.scale < threshold;
			if (shouldHide !== labelsHidden) {
				labelsHidden = shouldHide;
				if (!this.nodeDS) return;
				if (shouldHide) {
					const updates: VisNode[] = [];
					for (const n of this.nodeDS.get()) {
						if (n.label && n.label.trim()) {
							this.hiddenLabels.set(
								n.id as string,
								n.label,
							);
							updates.push({ id: n.id, label: '' });
						}
					}
					if (updates.length > 0) this.nodeDS.update(updates);
				} else {
					const updates: VisNode[] = [];
					for (const n of this.nodeDS.get()) {
						const saved = this.hiddenLabels.get(
							n.id as string,
						);
						if (saved !== undefined) {
							updates.push({ id: n.id, label: saved });
						}
					}
					if (updates.length > 0) this.nodeDS.update(updates);
					this.hiddenLabels.clear();
				}
			}
		});

		// ── Hover contextual focus (debounced 80ms) ──
		this.network.on('hoverNode', (params) => {
			const id = (params as { node?: string }).node;
			if (!id || !this.plugin.settings.hoverFocusEnabled) return;
			try {
				if (this.network?.isCluster(id)) return;
			} catch {
				// ignore
			}
			if (this.hoverDebounceTimer !== null)
				window.clearTimeout(this.hoverDebounceTimer);
			this.hoverDebounceTimer = window.setTimeout(() => {
				this.hoverDebounceTimer = null;
				this.setHoverFocus(id);
			}, 80);
		});
		this.network.on('blurNode', () => {
			if (this.hoverDebounceTimer !== null) {
				window.clearTimeout(this.hoverDebounceTimer);
				this.hoverDebounceTimer = null;
			}
			this.clearHoverFocus();
		});
		this.network.on('hoverEdge', (params) => {
			const id = (params as { edge?: string }).edge;
			if (id) this.setHoverEdge(id);
		});
		this.network.on('blurEdge', () => {
			this.clearHoverEdge();
		});

		// ── Pulsing halo around the focused node (drawn behind the node) ──
		this.network.on('beforeDrawing', (rawCtx: unknown) => {
			const ctx = rawCtx as CanvasRenderingContext2D;
			if (!ctx || !this.hoverFocus || !this.network) return;
			const positions = this.network.getPositions();
			const pos = positions
				? (positions as Record<string, { x: number; y: number }>)[
						this.hoverFocus.nodeId
					]
				: undefined;
			if (!pos) return;
			const scale = this.network.getScale() || 1;
			const baseSize =
				this.nodeBaseSize.get(this.hoverFocus.nodeId) ?? 15;
			const pulse = 0.5 + Math.sin(Date.now() / 500) * 0.2;
			const inner = baseSize * 1.3;
			const outer = inner + 30 / scale;
			ctx.save();
			const grad = ctx.createRadialGradient(
				pos.x,
				pos.y,
				inner,
				pos.x,
				pos.y,
				outer,
			);
			grad.addColorStop(0, colorToRgba('#ffffff', 0.3 * pulse));
			grad.addColorStop(1, colorToRgba('#ffffff', 0));
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, outer, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		});

		this.setStatus(
			`${nodes.length} nodes · ${edges.length} edges`,
		);
	}

	/**
	 * Fast in-place update: repopulates the DataSets WITHOUT destroying the
	 * Network or restarting physics. Used by toggle handlers so the graph
	 * updates instantly instead of freezing for 500ms+ on every click.
	 */
	/**
	 * Smooth in-place update: diffs the new visible set against the current
	 * DataSets, only adding/removing changed items. Physics is frozen during
	 * the diff so existing nodes don't jump. New nodes are placed near their
	 * parent (for symbols) before physics resumes — minimizing layout churn.
	 * Returns IDs of newly added nodes (for entrance animation).
	 */
	private updateVisible(): string[] {
		if (!this.network || !this.nodeDS || !this.edgeDS) {
			this.render();
			return [];
		}
		const model = this.plugin.graphModel;
		if (!model) return [];
		const { nodes, edges } = this.buildData(model);

		// ── Freeze physics so existing nodes don't jump ──
		const physicsOn = this.plugin.settings.physicsEnabled;
		if (physicsOn) {
			this.network.setOptions({ physics: { enabled: false } });
			this.network.stopSimulation();
		}

		// ── Node diff: remove gone, update rest (preserves x/y) ──
		const newNodeIds = new Set(nodes.map((n) => n.id));
		const oldNodeIds = this.nodeDS.getIds() as string[];
		const oldSet = new Set(oldNodeIds);
		const nodesToRemove = oldNodeIds.filter(
			(id) => !newNodeIds.has(id),
		);
		if (nodesToRemove.length > 0) this.nodeDS.remove(nodesToRemove);
		this.nodeDS.update(nodes);

		// ── Place NEW nodes near their parent + collect for animation ──
		const addedIds: string[] = [];
		const netBody = (
			this.network as unknown as {
				body: { nodes: Record<string, unknown> };
			}
		).body;
		for (const vn of nodes) {
			const nid = vn.id as string;
			if (oldSet.has(nid)) continue;
			addedIds.push(nid);
			const mn = model.nodes[nid];
			const parentId = mn?.parentId;
			if (parentId && netBody.nodes[parentId]) {
				const pp = this.network.getPositions([parentId])[parentId];
				if (pp) {
					this.network.moveNode(
						nid,
						pp.x + (Math.random() - 0.5) * 60,
						pp.y + (Math.random() - 0.5) * 60,
					);
				}
			}
		}

		// ── Edge diff ──
		const newEdgeIds = new Set(edges.map((e) => e.id));
		const oldEdgeIds = this.edgeDS.getIds() as string[];
		const edgesToRemove = oldEdgeIds.filter(
			(id) => !newEdgeIds.has(id),
		);
		if (edgesToRemove.length > 0) this.edgeDS.remove(edgesToRemove);
		this.edgeDS.update(edges);

		// ── Re-enable physics on next frame so diff completes first ──
		if (physicsOn) {
			window.requestAnimationFrame(() => {
				if (this.network) {
					this.network.setOptions({
						physics: { enabled: true },
					});
				}
			});
		}

		// ── Re-apply hover/caller focus dimming instantly (no animation) so
		//    structural changes don't drop the active spotlight. ──
		this.applyHoverOpacity(false);

		this.setStatus(`${nodes.length} nodes · ${edges.length} edges`);
		return addedIds;
	}

	/** Debounced updateVisible — batches rapid toggle clicks into one update. */
	private scheduleUpdate(): void {
		if (this.renderTimer !== null)
			window.clearTimeout(this.renderTimer);
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.updateVisible();
		}, 60);
	}

	private buildData(model: GraphModel): {
		nodes: VisNode[];
		edges: VisEdge[];
	} {
		const s = this.plugin.settings;
		const enabled = s.edgeTypesEnabled;
		const showSymbols = s.showSymbols;
		const hops = s.neighborhoodHops;
		const query = this.searchQuery.trim().toLowerCase();

		// ── Pre-compute fan-in / fan-out across ALL enabled edges ──
		// Excludes 'contains' (structural, not a dependency) so sizing
		// reflects real coupling, not just "has many symbols."
		const fanIn = new Map<string, number>();
		const fanOut = new Map<string, number>();
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			if (e.type === 'contains') continue;
			fanIn.set(e.dst, (fanIn.get(e.dst) ?? 0) + 1);
			fanOut.set(e.src, (fanOut.get(e.src) ?? 0) + 1);
		}
		this.cachedFanIn = fanIn;
		this.cachedFanOut = fanOut;
		const nodeDegree = (id: string): number =>
			(fanIn.get(id) ?? 0) + (fanOut.get(id) ?? 0);

		// ── Max values for proportional sizing ──
		let maxLOC = 1,
			maxDeg = 1,
			maxFi = 1,
			maxFo = 1;
		for (const n of Object.values(model.nodes)) {
			maxLOC = Math.max(maxLOC, n.lines ?? 0);
			maxDeg = Math.max(maxDeg, nodeDegree(n.id));
			maxFi = Math.max(maxFi, fanIn.get(n.id) ?? 0);
			maxFo = Math.max(maxFo, fanOut.get(n.id) ?? 0);
		}

		const sizeFor = (n: GraphNode): number => {
			const min = s.nodeSizeMin;
			const max = s.nodeSizeMax;
			const span = max - min;
			switch (s.nodeSizingMode) {
				case 'constant':
					return min + (nodeDegree(n.id) / maxDeg) * span;
				case 'lines':
					return min + ((n.lines ?? 0) / maxLOC) * span;
				case 'degree':
					return min + (nodeDegree(n.id) / maxDeg) * span;
				case 'fan-in':
					return min + ((fanIn.get(n.id) ?? 0) / maxFi) * span;
				case 'fan-out':
					return min + ((fanOut.get(n.id) ?? 0) / maxFo) * span;
			}
			return min;
		};

		// ── Neighborhood filter ──
		let visible: Set<string> | null = null;
		if (hops > 0 && this.focusedId && model.nodes[this.focusedId]) {
			visible = this.neighborhood(model, this.focusedId, hops, enabled);
		}

		// ── Phase 1: visible file / note nodes ──
		const nodeIds = new Set<string>();
		for (const id of Object.keys(model.nodes)) {
			if (visible && !visible.has(id)) continue;
			const n = model.nodes[id];
			if (!n) continue;
			if (n.kind === 'note' && !s.showNotes) continue;
			if (n.kind === 'code' && !s.showCodeFiles) continue;
			if (
				n.kind === 'code' &&
				n.ext &&
				this.hiddenExtensions.has(n.ext)
			)
				continue;
			if (isSymbolKind(n.kind)) continue;
			if (
				query &&
				!n.name.toLowerCase().includes(query) &&
				!n.path.toLowerCase().includes(query)
			)
				continue;
			nodeIds.add(id);
		}

		// ── Phase 2: visible symbol nodes ──
		for (const id of Object.keys(model.nodes)) {
			if (visible && !visible.has(id)) continue;
			const n = model.nodes[id];
			if (!n || !isSymbolKind(n.kind)) continue;
			const parent = n.parentId ?? '';
			if (!showSymbols && !this.expandedNodes.has(parent)) continue;
			if (
				query &&
				!n.name.toLowerCase().includes(query) &&
				!n.path.toLowerCase().includes(query)
			)
				continue;
			nodeIds.add(id);
		}

		// ── Incident set (for hideIsolated) ──
		const incident = new Set<string>();
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			if (nodeIds.has(e.src) && nodeIds.has(e.dst)) {
				incident.add(e.src);
				incident.add(e.dst);
			}
		}

		// ── Highlight set is now driven by `hoverFocus`; opacity dimming is
		//    applied post-render by applyHoverOpacity() so it can animate. ──

		// ── Community detection — run when EITHER the node fill OR the zone
		//    aura is community-driven, so auras work even with language fill. ──
		let communityLabels: Map<string, number> | null = null;
		if (s.colorMode === 'community' || s.zoneColorMode === 'community') {
			communityLabels = detectCommunities(
				model.edges,
				[...nodeIds],
			);
		}
		this.cachedCommunityLabels = communityLabels;

		// ── Color group matching (user-defined groups override defaults) ──
		const activeGroups = s.colorGroups.filter((g) => g.enabled);
		const groupColorFor = (node: GraphNode): string | null => {
			for (const g of activeGroups) {
				if (matchesColorGroup(node, g.query)) return g.color;
			}
			return null;
		};

		// ── Build vis nodes ──
		const nodes: VisNode[] = [];
		for (const id of nodeIds) {
			if (this.hideIsolated && !incident.has(id)) continue;
			const n = model.nodes[id];
			if (!n) continue;
			const isDead =
				s.highlightDeadCode &&
				(fanIn.get(id) ?? 0) === 0 &&
				n.kind !== 'note';
			const isSym = isSymbolKind(n.kind);
			const sz = isSym
				? Math.max(5, sizeFor(n) * 0.6)
				: sizeFor(n);
			this.nodeBaseSize.set(id, sz);

			let label = n.name;
			if (s.showBadges) {
				label = `${n.name}  ↓${fanIn.get(id) ?? 0} ↑${fanOut.get(id) ?? 0}`;
			}

			const title = isSym
				? `${n.path}:${n.line ?? '?'} — ${n.name} (${n.kind})`
				: n.path;

			// Check for color group override
			const groupColor = groupColorFor(n);
			const styledNode = { ...n };
			if (groupColor) (styledNode as unknown as { _overrideColor?: string })._overrideColor = groupColor;

			const visNode: VisNode = {
				id,
				label,
				title,
				...nodeStyle(styledNode, sz, isDead, s.colorMode, communityLabels, activeGroups.length > 0 ? activeGroups : null),
			};
			nodes.push(visNode);
		}

		// ── Build vis edges ──
		const edges: VisEdge[] = [];
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			if (visible && (!visible.has(e.src) || !visible.has(e.dst)))
				continue;
			if (!nodeIds.has(e.src) || !nodeIds.has(e.dst)) continue;
			const visEdge: VisEdge = {
				id: `${e.src}\u0001${e.dst}\u0001${e.type}`,
				from: e.src,
				to: e.dst,
				...edgeStyle(e.type, e.weight),
			};
			edges.push(visEdge);
		}

		return { nodes, edges };
	}

	/**
	 * BFS that returns a hop-distance map instead of a flat set. This is the
	 * hover-focus counterpart to `neighborhood()`: it powers the multi-hop
	 * attention gradient. Skips `contains` (structural, not a dependency) and
	 * caps the number of direct neighbours at HOVER_NEIGHBOR_CAP (top by edge
	 * weight) so extremely hubs stay readable.
	 */
	private computeHopDistances(
		model: GraphModel,
		start: string,
		maxHops: number,
		enabled: Record<EdgeType, boolean>,
	): Map<string, number> {
		// Build a weighted undirected adjacency (weight = max over edge types).
		const neighbors = new Map<string, Map<string, number>>();
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			if (e.type === 'contains') continue;
			let bucket = neighbors.get(e.src);
			if (!bucket) {
				bucket = new Map();
				neighbors.set(e.src, bucket);
			}
			bucket.set(e.dst, Math.max(bucket.get(e.dst) ?? 0, e.weight));
			let bucket2 = neighbors.get(e.dst);
			if (!bucket2) {
				bucket2 = new Map();
				neighbors.set(e.dst, bucket2);
			}
			bucket2.set(e.src, Math.max(bucket2.get(e.src) ?? 0, e.weight));
		}

		const distances = new Map<string, number>([[start, 0]]);
		let frontier = [start];
		for (let hop = 1; hop <= maxHops; hop++) {
			const next: string[] = [];
			// At the first hop, cap direct neighbours by weight for hubs.
			if (hop === 1) {
				const direct = neighbors.get(start);
				if (direct && direct.size > HOVER_NEIGHBOR_CAP) {
					const ranked = [...direct.entries()]
						.sort((a, b) => b[1] - a[1])
						.slice(0, HOVER_NEIGHBOR_CAP)
						.map(([id]) => id);
					for (const id of ranked) {
						distances.set(id, 1);
						next.push(id);
					}
					// Continue BFS from the capped set only.
					frontier = next;
					continue;
				}
			}
			for (const node of frontier) {
				const adj = neighbors.get(node);
				if (!adj) continue;
				for (const nb of adj.keys()) {
					if (!distances.has(nb)) {
						distances.set(nb, hop);
						next.push(nb);
					}
				}
			}
			if (next.length === 0) break;
			frontier = next;
		}
		return distances;
	}

	private neighborhood(
		model: GraphModel,
		start: string,
		hops: number,
		enabled: Record<EdgeType, boolean>,
	): Set<string> {
		const adj = new Map<string, string[]>();
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			const a = adj.get(e.src);
			if (a) a.push(e.dst);
			else adj.set(e.src, [e.dst]);
			const b = adj.get(e.dst);
			if (b) b.push(e.src);
			else adj.set(e.dst, [e.src]);
		}
		const seen = new Set<string>([start]);
		let frontier = [start];
		for (let i = 0; i < hops; i++) {
			const next: string[] = [];
			for (const node of frontier) {
				for (const neighbor of adj.get(node) ?? []) {
					if (!seen.has(neighbor)) {
						seen.add(neighbor);
						next.push(neighbor);
					}
				}
			}
			if (next.length === 0) break;
			frontier = next;
		}
		return seen;
	}

	private buildOptions(): Options {
		const s = this.plugin.settings;
		return {
			nodes: { shape: 'dot', font: { size: 13 } },
		edges: {
			// Per-edge smooth is set in edgeStyle(); global default is neutral
			smooth: { enabled: false },
			color: { inherit: false },
		},
			physics: {
				enabled: s.physicsEnabled,
				stabilization: { iterations: 200 },
				barnesHut: {
					gravitationalConstant: -(s.repelForce / 100) * 12000,
					centralGravity: s.centerForce / 100,
					springConstant: (s.linkForce / 100) * 0.08,
					springLength: s.linkDistance,
					damping: 0.4,
				},
			},
			interaction: {
				hover: true,
				tooltipDelay: 120,
				navigationButtons: false,
				keyboard: false,
			},
		} as Options;
	}

	private async openFile(id: string): Promise<void> {
		// Symbol node IDs are "path#SymbolName" — strip the suffix to get the
		// actual file path. The line number is stored on the node for future
		// cursor navigation.
		const filePath = id.includes('#') ? id.split('#')[0] ?? id : id;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await this.app.workspace.getLeaf('tab').openFile(file);
		} else {
			new Notice(`Could not find: ${filePath}`);
		}
	}
}
