import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon, Menu } from 'obsidian';
import { DataSet, Network } from 'vis-network/standalone';
import type {
	Options,
	Node as VisNode,
	Edge as VisEdge,
} from 'vis-network/standalone';
import type CodeGraphPlugin from '../main';
import { VIEW_TYPE_CODE_GRAPH } from '../main';
import type { NodeSizingMode, ColorMode, ColorGroup } from '../settings';
import { applyFolderClustering, applyCommunityClustering, folderKey } from './clustering';
import { discoverDomains } from '../commands/seedDomains';
import { drawEdgeAnimation, shouldAnimateEdges } from './edgeAnimation';
import type { EdgeAnimInfo } from './edgeAnimation';
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

function edgeStyle(type: EdgeType, weight: number, roundnessOverride?: number, length?: number): Partial<VisEdge> {
	const s = EDGE_STYLE[type];
	// Scale within per-type [baseWidth, maxWidth]: weight 1 = base, weight 10+ = max
	const t = Math.min(Math.max((weight - 1) / 9, 0), 1);
	const width = s.baseWidth + t * (s.maxWidth - s.baseWidth);

	// Determine roundness: use override (for parallel-edge fan-out) or the
	// per-type base. Clamp to a minimum absolute curvature so edges are NEVER
	// straight — the user wants all edges to have visible curvature so they
	// don't overlap by following the exact same path.
	let roundness = roundnessOverride ?? s.roundness;
	const MIN_CURVE = 0.15;
	if (Math.abs(roundness) < MIN_CURVE) {
		roundness = roundness >= 0 ? MIN_CURVE : -MIN_CURVE;
	}
	// Cap at ±0.5 so curves don't loop back on themselves
	roundness = Math.max(-0.5, Math.min(0.5, roundness));

	const result: Partial<VisEdge> = {
		// Set color + highlight + hover all to the same value so vis-network
		// never falls back to its default grey (#848484) on hover/select.
		color: { color: s.color, highlight: s.color, hover: s.color, opacity: 0.85 },
		dashes: s.dashes,
		width,
		arrows: arrowsFor(s.arrow),
		// Always smooth with type 'dynamic': this routes each edge to a
		// different point on the node circle based on the relative angle
		// between source and target. This prevents all edges from connecting
		// at the same spot on the node and naturally distributes connection
		// points around the perimeter. Combined with per-type roundness and
		// parallel-edge fan-out, edges never overlap or follow the same path.
		smooth: { enabled: true, type: 'dynamic', roundness },
	};
	// Per-edge rest length: when set, overrides the global springLength.
	if (length !== undefined) {
		(result as VisEdge & { length?: number }).length = length;
	}
	return result;
}

/** Default edge opacity used by edgeStyle() — the "neutral" rest state. */
const DEFAULT_EDGE_OPACITY = 0.85;
/** Cap on direct neighbours considered for a single hover. High enough
 * that hubs show all their connections, since we already bail entirely
 * above HOVER_DISABLE_THRESHOLD. */
const HOVER_NEIGHBOR_CAP = 500;
/** Max BFS hops for the hover attention gradient. */
const HOVER_MAX_HOPS = 3;
/**
 * Node count above which all interactive "luxury" features auto-disable:
 * hover focus, halo loop, opacity dimming animation. These features work
 * fine on small graphs but at 3000+ nodes each hover event triggers
 * O(N) DataSet updates and a full-canvas redraw loop — the main cause of
 * "glitchy AF" behavior on large codebases.
 */
const HOVER_DISABLE_THRESHOLD = 500;
/**
 * Golden ratio (φ ≈ 1.618). Used for:
 * - Cross-cluster edge rest length = springLength × φ (stretchy, lets you
 *   pull a cluster away from the rest without dragging the whole graph).
 * - Intra-cluster edge rest length = springLength × (1/φ) (tight, so
 *   clusters move as cohesive units).
 * - Mass scaling: mass = max(2, min(degree × φ, 80)) — hubs anchored with
 *   φ-weighted mass, small nodes resist being yanked (floor of 2).
 */
const PHI = 1.61803398875;

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
	/** Separate rAF loop for edge animation (dashes/pulses). Must not be
	 * shared with animTimer (which is used by animateEntrance and gets
	 * clobbered, killing the edge animation loop). */
	private edgeAnimTimer: number | null = null;
	/** Cached derived data keyed off model.builtAt — avoids re-scanning the
	 * full node/edge tables 4-6× per buildData() call and re-running
	 * detectCommunities() on every debounced filter toggle. */
	private derivedCache: {
		builtAt: number;
		fanIn: Map<string, number>;
		fanOut: Map<string, number>;
		maxLOC: number;
		maxDeg: number;
		maxFi: number;
		maxFo: number;
		communityLabels: Map<string, number>;
		/** Undirected adjacency for hover BFS — cached so computeHopDistances
		 * doesn't rebuild the 6000-edge map on every hover event. */
		hoverAdjacency: Map<string, Map<string, number>>;
	} | null = null;
	/** True when the graph exceeded maxNodes and auto-degraded perf features. */
	private degraded = false;
	/** Saved converged layout positions, keyed off model structural hash.
	 * When the model hash matches a previous render, we restore positions
	 * instead of re-running 200 stabilization iterations from scratch. */
	private savedLayouts = new Map<string, Map<string, { x: number; y: number }>>();
	/** Saved camera state (zoom + pan) — restored after render() so the view
	 * doesn't jump when toggling settings or returning to the graph. */
	private savedCamera: { x: number; y: number; scale: number } | null = null;
	/** True after the layout has stabilized — auras only draw when stable
	 * so they don't chase shifting node positions during initial physics. */
	private layoutStable = false;

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
		// Save camera state before destroying so render() can restore it
		if (this.network) {
			try {
				const view = this.network.getViewPosition();
				this.savedCamera = {
					x: view.x,
					y: view.y,
					scale: this.network.getScale(),
				};
			} catch {
				// network may already be partially destroyed
			}
		}
		this.layoutStable = false;
		if (this.opacityRAF !== null) {
			window.cancelAnimationFrame(this.opacityRAF);
			this.opacityRAF = null;
		}
		this.stopHaloLoop();
		if (this.animTimer !== null) {
			window.cancelAnimationFrame(this.animTimer);
			this.animTimer = null;
		}
		if (this.edgeAnimTimer !== null) {
			window.cancelAnimationFrame(this.edgeAnimTimer);
			this.edgeAnimTimer = null;
		}
		if (this.hoverDebounceTimer !== null) {
			window.clearTimeout(this.hoverDebounceTimer);
			this.hoverDebounceTimer = null;
		}
		this.hoverFocus = null;
		
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
	 * Apply clustering based on the configured strategy. Three modes, all
	 * self-evolving from the graph (no hardcoded rules):
	 *
	 * - `clusterHubs` (legacy): fold high-degree hubs + their neighbors.
	 *   Pathological for hubs with degree 200 — kept for backward compat.
	 * - `clusterMode: 'folder'`: aggregate by top-level folder path. The
	 *   Obsidian-native-graph / yFiles approach: compound meta-nodes.
	 * - `clusterMode: 'community'`: aggregate by label-propagation community.
	 *   Communities are already computed from edge density.
	 *
	 * Double-click a cluster to expand (already wired in the doubleClick handler).
	 */
	private applyClustering(): void {
		if (!this.network) return;
		const s = this.plugin.settings;
		const model = this.plugin.graphModel;
		if (!model) return;

		// Legacy hub clustering — kept for backward compat, OFF by default.
		if (s.clusterHubs) {
			this.applyHubClustering();
		}

		// Self-evolving clustering — only above a threshold so small graphs
		// stay full-detail.
		const minNodesForClustering = 300;
		const visibleNodeIds = new Set(
			(this.nodeDS?.getIds() ?? []) as string[],
		);
		if (visibleNodeIds.size < minNodesForClustering) return;

		if (s.clusterMode === 'folder') {
			applyFolderClustering(
				this.network,
				model,
				visibleNodeIds,
				minNodesForClustering,
			);
		} else if (s.clusterMode === 'community') {
			const labels = this.derivedCache?.communityLabels;
			if (labels) {
				applyCommunityClustering(
					this.network,
					model,
					visibleNodeIds,
					labels,
					minNodesForClustering,
				);
			}
		}
	}

	/**
	 * Legacy hub clustering: fold high-degree hubs + ALL their neighbors into
	 * a cluster. Pathological for hubs with degree 200 (swallows 201 nodes).
	 * Kept for backward compat with the `clusterHubs` setting; new users should
	 * use `clusterMode: 'folder'` or `'community'` instead.
	 */
	private applyHubClustering(): void {
		if (!this.network) return;
		const s = this.plugin.settings;
		if (!s.clusterHubs) return;

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
		s.animateEdges = true;
		s.highlightDeadCode = true;
		// Sizing
		s.nodeSizingMode = 'constant';
		s.nodeSizeMin = 8;
		s.nodeSizeMax = 25;
		s.centerForce = 30;
		s.repelForce = 60;
		s.linkForce = 50;
		s.linkDistance = 110;
		s.stretchiness = 1.618;
		s.labelFadeZoom = 0.3;
		s.colorMode = 'language';
		s.zoneColorMode = 'groups';
		s.clusterHubs = false;
		s.clusterThreshold = 15;
		s.clusterMode = 'none';
		s.showZones = true;
		s.maxNodes = 800;
		s.edgeSmoothThreshold = 500;
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
			{ key: 'linkForce', label: 'Link', min: '0', max: '100', title: 'Spring stiffness between connected nodes — higher = nodes pull their neighbors more when dragged' },
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
								springConstant: (s.linkForce / 100) * 0.5,
								springLength: s.linkDistance,
							},
						},
					});
				}
			};
			slider.onchange = () => void this.plugin.saveSettings();
		}
		// Stretchiness slider — controls how much cross-cluster edges stretch
		// vs intra-cluster edges. 1.0 = uniform (all edges same length),
		// 1.618 = golden ratio (default), 3.0 = very stretchy (clusters pull
		// apart easily). This lets you "pull a cluster out" by dragging.
		const stretchRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		stretchRow.createSpan({ cls: 'code-graph-slider-label', text: 'Stretch' });
		const stretchSlider = stretchRow.createEl('input', {
			type: 'range',
			cls: 'code-graph-slider',
			attr: {
				min: '10',
				max: '300',
				value: String(Math.round(s.stretchiness * 100)),
				step: '10',
			},
		});
		stretchSlider.title = 'How stretchy cross-cluster edges are. Lower = rigid (whole graph moves together). Higher = clusters pull apart easily. 162 = golden ratio.';
		const stretchVal = stretchRow.createSpan({
			cls: 'code-graph-slider-val',
			text: `${Math.round(s.stretchiness * 100) / 100}`,
		});
		stretchSlider.oninput = () => {
			s.stretchiness = Number(stretchSlider.value) / 100;
			stretchVal.setText(`${Math.round(s.stretchiness * 100) / 100}`);
		};
		stretchSlider.onchange = () => {
			void this.plugin.saveSettings();
			this.render();
		};
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

		// ── Self-evolving clustering mode (folder / community) ──
		const modeRow = parent.createDiv({ cls: 'code-graph-mode-row' });
		const clusterModes: {
			id: 'none' | 'folder' | 'community';
			label: string;
			title: string;
		}[] = [
			{ id: 'none', label: 'None', title: 'No aggregation — show all nodes individually' },
			{ id: 'folder', label: 'Folder', title: 'Aggregate nodes by top-level folder into meta-nodes. Self-evolving from folder structure.' },
			{ id: 'community', label: 'Auto', title: 'Aggregate by auto-detected communities (label propagation from edge density). Self-evolving.' },
		];
		for (const cm of clusterModes) {
			const btn = modeRow.createSpan({
				cls: `code-graph-mode-btn${s.clusterMode === cm.id ? ' is-active' : ''}`,
			});
			btn.setText(cm.label);
			btn.title = cm.title;
			btn.onclick = () => {
				s.clusterMode = cm.id;
				void this.plugin.saveSettings();
				modeRow
					.querySelectorAll('.code-graph-mode-btn')
					.forEach((el) => el.removeClass('is-active'));
				btn.addClass('is-active');
				this.render();
			};
		}
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

			// ── Edit button: opens inline editor for name/query/color ──
			const editBtn = row.createSpan({ cls: 'code-graph-group-edit-btn' });
			setIcon(editBtn, 'pencil');
			editBtn.title = 'Edit group';
			editBtn.onclick = (e) => {
				e.stopPropagation();
				this.openGroupEditor(parent, group, row);
			};

			// ── Delete button ──
			const delBtn = row.createSpan({ cls: 'code-graph-group-del-btn' });
			setIcon(delBtn, 'trash-2');
			delBtn.title = 'Delete group';
			delBtn.onclick = (e) => {
				e.stopPropagation();
				s.colorGroups = s.colorGroups.filter((g) => g.id !== group.id);
				void this.plugin.saveSettings();
				this.renderPanel();
				this.updateVisible();
			};
		}

		// ── Add group button ──
		const addRow = parent.createDiv({ cls: 'code-graph-group-add-row' });
		const addBtn = addRow.createEl('button', {
			cls: 'code-graph-group-add-btn',
			text: 'Add group',
		});
		addBtn.onclick = () => {
			const newGroup: ColorGroup = {
				id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
				name: 'New group',
				query: 'path:src/',
				color: '#3b82f6',
				enabled: true,
			};
			s.colorGroups.push(newGroup);
			void this.plugin.saveSettings();
			this.renderPanel();
			this.updateVisible();
		};

		// ── Auto-seed groups button ──
		// Discovers domains from the indexed graph via community detection +
		// folder heuristics (same logic as the "Seed domains" command) and
		// creates color groups for each. This is self-evolving — groups derive
		// from the graph structure, not from hardcoded rules.
		const seedRow = parent.createDiv({ cls: 'code-graph-group-add-row' });
		const seedBtn = seedRow.createEl('button', {
			cls: 'code-graph-group-add-btn',
			text: 'Auto-seed groups',
		});
		seedBtn.title = 'Discover domains from the indexed graph and create color groups for each. Self-evolving from code structure.';
		seedBtn.onclick = () => {
			const domainCounts = discoverDomains(this.plugin);
			if (domainCounts.size === 0) {
				new Notice('No domains discovered — index the codebase first.');
				return;
			}
			// Assign each domain a distinct color from a palette
			const palette = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
			let added = 0;
			let idx = 0;
			for (const [domain, count] of domainCounts) {
				const color = palette[idx % palette.length] ?? '#64748b';
				idx++;
				// Skip if a group with this exact query already exists
				const query = `domain:${domain}`;
				const exists = s.colorGroups.some((g) => g.query === query);
				if (exists) continue;
				s.colorGroups.push({
					id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
					name: `${domain} (${count})`,
					query,
					color,
					enabled: true,
				});
				added++;
			}
			if (added > 0) {
				void this.plugin.saveSettings();
				this.renderPanel();
				this.updateVisible();
				new Notice(`Auto-seeded ${added} color group${added > 1 ? 's' : ''} from detected domains.`);
			} else {
				new Notice('All detected domains already have groups.');
			}
		};

		// ── Help text ──
		if (s.colorGroups.length === 0) {
			parent.createDiv({
				cls: 'code-graph-hint',
				text: 'No color groups. Add one to highlight nodes by domain, path, ext, kind, status, or tag.',
			});
		}
	}

	/**
	 * Inline editor for a single color group. Replaces the row with edit
	 * fields (name, query, color picker) and Save/Cancel buttons.
	 */
	private openGroupEditor(
		parent: HTMLElement,
		group: ColorGroup,
		row: HTMLElement,
	): void {
		const editor = parent.createDiv({ cls: 'code-graph-group-editor' });
		row.replaceWith(editor);

		// Name field
		const nameRow = editor.createDiv({ cls: 'code-graph-group-edit-field' });
		nameRow.createSpan({ text: 'Name', cls: 'code-graph-group-edit-label' });
		const nameInput = nameRow.createEl('input', { type: 'text' });
		nameInput.value = group.name;

		// Query field
		const queryRow = editor.createDiv({ cls: 'code-graph-group-edit-field' });
		queryRow.createSpan({ text: 'Query', cls: 'code-graph-group-edit-label' });
		const queryInput = queryRow.createEl('input', { type: 'text' });
		queryInput.value = group.query;
		queryRow.createDiv({
			cls: 'code-graph-hint',
			text: 'Predicates: domain:foo, path:src/, ext:ts, kind:class, status:wip, tag:api, or substring',
		});

		// Color picker
		const colorRow = editor.createDiv({ cls: 'code-graph-group-edit-field' });
		colorRow.createSpan({ text: 'Color', cls: 'code-graph-group-edit-label' });
		const colorInput = colorRow.createEl('input', { type: 'color' });
		colorInput.value = group.color;

		// Save / Cancel
		const btnRow = editor.createDiv({ cls: 'code-graph-group-edit-buttons' });
		const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'mod-cta' });
		saveBtn.onclick = () => {
			group.name = nameInput.value.trim() || 'Untitled';
			group.query = queryInput.value.trim();
			group.color = colorInput.value;
			void this.plugin.saveSettings();
			this.renderPanel();
			this.updateVisible();
		};
		const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => {
			this.renderPanel();
		};
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

					this.stopHaloLoop();
					this.applyHoverOpacity(true);
					this.applyHoverSize();
				}
			},
		});
		this.renderNodeLegendRow(parent, {
			label: 'Animate edges',
			color: '#22c55e',
			shape: 'dot',
			size: 10,
			isOn: s.animateEdges,
			title:
				'Animate dashed edges in the arrow direction and pulse solid edges. Auto-disables above 5000 edges for performance.',
			onToggle: () => {
				s.animateEdges = !s.animateEdges;
				void this.plugin.saveSettings();
				// Don't call render() — just start/stop the animation loop.
				// render() destroys and recreates the entire network, which
				// resets the view. Instead, toggle the edge animation timer.
				if (s.animateEdges) {
					this.startEdgeAnimation();
				} else {
					this.stopEdgeAnimation();
				}
			},
		});

		// ── Performance sliders ──
		const perfRow = parent.createDiv({ cls: 'code-graph-slider-row code-graph-perf-header' });
		perfRow.createSpan({
			cls: 'code-graph-slider-label',
			text: 'Scale',
		});

		// maxNodes cap
		const maxNodesRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		maxNodesRow.createSpan({ cls: 'code-graph-slider-label', text: 'Max nodes' });
		const maxNodesSlider = maxNodesRow.createEl('input', {
			type: 'range',
			cls: 'code-graph-slider',
			attr: {
				min: '0',
				max: '3000',
				value: String(s.maxNodes),
				step: '50',
			},
		});
		maxNodesSlider.title = 'Maximum visible nodes before auto-degrading performance (0 = unlimited). Top-connected nodes are kept.';
		const maxNodesVal = maxNodesRow.createSpan({
			cls: 'code-graph-slider-val',
			text: s.maxNodes === 0 ? 'off' : String(s.maxNodes),
		});
		maxNodesSlider.oninput = () => {
			s.maxNodes = Number(maxNodesSlider.value);
			maxNodesVal.setText(s.maxNodes === 0 ? 'off' : String(s.maxNodes));
		};
		maxNodesSlider.onchange = () => {
			void this.plugin.saveSettings();
			this.render();
		};

		// edge smoothing threshold
		const smoothRow = parent.createDiv({ cls: 'code-graph-slider-row' });
		smoothRow.createSpan({ cls: 'code-graph-slider-label', text: 'Smooth' });
		const smoothSlider = smoothRow.createEl('input', {
			type: 'range',
			cls: 'code-graph-slider',
			attr: {
				min: '0',
				max: '2000',
				value: String(s.edgeSmoothThreshold),
				step: '50',
			},
		});
		smoothSlider.title = 'Disable edge curve smoothing above this edge count (0 = always smooth). Biggest framerate win for large graphs.';
		const smoothVal = smoothRow.createSpan({
			cls: 'code-graph-slider-val',
			text: s.edgeSmoothThreshold === 0 ? 'off' : String(s.edgeSmoothThreshold),
		});
		smoothSlider.oninput = () => {
			s.edgeSmoothThreshold = Number(smoothSlider.value);
			smoothVal.setText(s.edgeSmoothThreshold === 0 ? 'off' : String(s.edgeSmoothThreshold));
		};
		smoothSlider.onchange = () => {
			void this.plugin.saveSettings();
			this.render();
		};
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
			// On large graphs, skip the opacity dimming — only set the focus
			// state so the tooltip/status reflects it. The O(N) DataSet
			// updates in applyHoverOpacity are the bottleneck.
			const visibleNodeCount = this.nodeDS?.length ?? 0;
			const tooLarge = visibleNodeCount > HOVER_DISABLE_THRESHOLD;
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
			// Skip the expensive opacity animation + halo on large graphs.
			if (tooLarge) {
				
				return;
			}
		}
		
		this.applyHoverOpacity(true);
		this.applyHoverSize();
		if (this.hoverFocus) this.startHaloLoop();
		else this.stopHaloLoop();
	}

	// ── Hover contextual focus ──

	/** Begin a transient (dir === null) hover focus on `nodeId`. */
	private setHoverFocus(nodeId: string): void {
		if (!this.plugin.settings.hoverFocusEnabled) return;
		// Bail early when the graph is too large — computeHopDistances builds a
		// full adjacency map from all edges (O(E)) then BFS, and the resulting
		// applyHoverOpacity call updates O(N) DataSet items. At 3000+ nodes
		// this freezes the UI for 100+ms on every hover.
		const visibleNodeCount = this.nodeDS?.length ?? 0;
		if (visibleNodeCount > HOVER_DISABLE_THRESHOLD) return;
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
	/** Opacity for a node at a given hop distance (undefined = unconnected).
	 * Smooth gradient: the focused node is full opacity, then each hop
	 * fades by roughly half using a φ-based decay so the falloff looks
	 * natural rather than stepping abruptly. */
	private opacityForDistance(d: number | undefined): number {
		if (d === undefined) return 0.05;
		if (d <= 0) return 1.0;
		if (d === 1) return 0.85;
		// φ-based decay: hop 2 ≈ 0.45, hop 3 ≈ 0.22, hop 4 ≈ 0.12.
		// Each ring of neighbors is progressively more transparent,
		// making it easy to trace connections by eye.
		const decay = Math.pow(1 / PHI, d) * 0.85 + 0.05;
		return Math.max(decay, 0.05);
	}

	/** Opacity for an EDGE based on the farther endpoint's hop distance.
	 * Direct connections (hop 0-1) are full opacity so the edge color is
	 * vivid and clearly visible. Beyond that, edges fade with the same
	 * φ-decay as nodes. This prevents the "edges look grey" issue where
	 * even direct connections were being drawn at 57% opacity. */
	private edgeOpacityForDistance(d: number | undefined): number {
		if (d === undefined) return 0.05;
		if (d <= 0) return 1.0;
		if (d === 1) return 1.0;
		return this.opacityForDistance(d);
	}

	/** Parse an edge id (`src\u0001dst\u0001type`) back into its base color. */
	private edgeColorFromId(edgeId: string): string {
		const parts = edgeId.split('\u0001');
		const type = parts[2] as EdgeType;
		return EDGE_STYLE[type]?.color ?? '#94a3b8';
	}

	/**
	 * Build a full vis-network edge color object that keeps the edge's
	 * assigned color in ALL states (base, hover, highlight). Without this,
	 * vis-network falls back to its default grey (#848484) for hover/select
	 * states — which is why edges "turn grey" on hover or canvas drag.
	 */
	private edgeColorObj(edgeId: string, opacity: number): {
		color: string; highlight: string; hover: string; opacity: number;
	} {
		const c = this.edgeColorFromId(edgeId);
		return { color: c, highlight: c, hover: c, opacity };
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
		// Undirected hover: edge opacity based on the FARTHER endpoint's
		// hop distance. Direct connections (hop 0-1) are full opacity so
		// the edge color is vivid. Beyond that, edges fade with φ-decay.
		const df = distances.get(f);
		const dt = distances.get(t);
		const maxD = Math.max(df ?? 99, dt ?? 99);
		if (df === undefined && dt === undefined) {
			edgeTargets.set(id, 0.05);
		} else {
			edgeTargets.set(id, this.edgeOpacityForDistance(maxD));
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
		// Bail on large graphs — iterating + updating O(N) DataSet items on
		// every hover change is the #1 cause of UI freezes at 3000+ nodes.
		// Each nodeDS.update() call triggers vis-network's internal diff +
		// render pipeline; at scale this is a multi-hundred-ms main-thread block.
		if ((this.nodeDS.length ?? 0) > HOVER_DISABLE_THRESHOLD) return;
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
					edgeUpdates.push({
						id,
						color: this.edgeColorObj(id, val),
					});
				}
			}
			if (edgeUpdates.length > 0) this.edgeDS?.update(edgeUpdates);
		};

		if (!animate) {
			commit(1);
			return;
		}

		const duration = this.hoverFocus || this.hoverFocus ? 200 : 300;
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
		// The halo loop calls network.redraw() every animation frame, which
		// triggers a full canvas repaint of ALL visible nodes + edges. At
		// 3000+ nodes this alone drops framerate to single digits. Skip it.
		if ((this.nodeDS?.length ?? 0) > HOVER_DISABLE_THRESHOLD) return;
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

		// ── Saved layout restore: if we have a converged layout for this
		//    model hash, pre-seed node positions so we can skip the 200-iteration
		//    stabilization from scratch. New nodes (not in the saved layout) get
		//    no position — vis-network will place them via physics. ──
		const modelHash = this.computeModelHash(model);
		const savedLayout = this.savedLayouts.get(modelHash);
		let hasSavedLayout = false;
		if (savedLayout && savedLayout.size > 0) {
			hasSavedLayout = true;
			for (const node of nodes) {
				const pos = savedLayout.get(node.id as string);
				if (pos) {
					(node as VisNode & { x?: number; y?: number }).x = pos.x;
					(node as VisNode & { x?: number; y?: number }).y = pos.y;
				}
			}
		}

		const nodeDS = new DataSet<VisNode, 'id'>(nodes);
		const edgeDS = new DataSet<VisEdge, 'id'>(edges);
		this.nodeDS = nodeDS;
		this.edgeDS = edgeDS;
		const options = this.buildOptions(nodes.length, edges.length);
		// When we have a saved layout, reduce stabilization iterations
		// dramatically — the positions are already close to converged.
		if (hasSavedLayout) {
			(options as Record<string, Record<string, unknown>>).physics = {
				...((options as Record<string, Record<string, unknown>>).physics as object),
				stabilization: { iterations: 10 },
			};
		}
		this.network = new Network(
			this.canvasEl,
			{ nodes: nodeDS, edges: edgeDS },
			options,
		);
		if (this.degraded) {
			new Notice(
				`Code graph: ${nodes.length} nodes · ${edges.length} edges — performance mode active (smoothing/zones/continuous-physics reduced).`,
				6000,
			);
		}
		// Stabilization progress — show a brief notice for large graphs so
		// the user knows the layout is computing, not frozen.
		if (nodes.length > 200) {
			let lastPct = -1;
			this.network.on('stabilizationProgress', (params: { iterations: number; total: number }) => {
				const pct = Math.round((params.iterations / params.total) * 100);
				if (pct >= lastPct + 25) {
					lastPct = pct;
					this.setStatus(`Stabilizing layout… ${pct}%`);
				}
			});
			this.network.once('stabilizationIterationsDone', () => {
				this.setStatus(`${nodes.length} nodes · ${edges.length} edges`);
			});
		}
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

		// ── Drag behavior: pin dragged nodes + semi-transparent edges during
		//    canvas pan/zoom. ──
		// When the user drags a NODE, pin it at the drop position (fixed: true).
		// This means "I put this here" — the node stays, the graph settles
		// around it. No snap-back, no stabilize. To unpin, drag it again or
		// double-click empty canvas.
		//
		// When the user drags the CANVAS (pan), temporarily lower edge opacity
		// so the structure stays visible (semi-transparent) without the full
		// draw cost. Restores on dragEnd.
		let canvasDragging = false;
		let preDragEdgeOpacities: Map<string, number> | null = null;

		this.network.on('dragStart', (params) => {
			const typed = params as { nodes?: string[] } | undefined;
			const nodeIds = typed?.nodes;
			// If dragging a node → pin it (handled in dragEnd).
			// If no nodes → it's a canvas pan → dim edges.
			if (!nodeIds || nodeIds.length === 0) {
				canvasDragging = true;
				// Lower all edge opacities for the duration of the canvas drag.
				// Uses edgeColorObj to set color+highlight+hover so vis-network
				// doesn't fall back to grey.
				if (this.edgeDS) {
					preDragEdgeOpacities = new Map();
					const updates: VisEdge[] = [];
					for (const e of this.edgeDS.get()) {
						const id = e.id as string;
						const cur = (e as VisEdge & { color?: { opacity?: number } }).color;
						const baseOp = cur?.opacity ?? DEFAULT_EDGE_OPACITY;
						preDragEdgeOpacities.set(id, baseOp);
						updates.push({
							id,
							color: this.edgeColorObj(id, baseOp * 0.15),
						});
					}
					if (updates.length > 0) this.edgeDS.update(updates);
				}
			}
		});

		this.network.on('dragEnd', (params) => {
			const typed = params as { nodes?: string[] } | undefined;
			const nodeIds = typed?.nodes;

			if (canvasDragging) {
				// Canvas pan ended → restore edge opacities.
				canvasDragging = false;
				if (this.edgeDS && preDragEdgeOpacities) {
					const updates: VisEdge[] = [];
					for (const [id, op] of preDragEdgeOpacities) {
						updates.push({ id, color: this.edgeColorObj(id, op) });
					}
					if (updates.length > 0) this.edgeDS.update(updates);
				}
				preDragEdgeOpacities = null;
				return;
			}

			// Node drag ended → toggle pin at dropped position.
			// If the node was NOT pinned → pin it (fixed: true). The node stays
			// where the user put it — "I put this here."
			// If the node WAS already pinned → unpin it (fixed: false). The
			// node releases back to physics. This lets you drag a pinned node
			// to unpin it, or drag a free node to pin it.
			if (nodeIds && nodeIds.length > 0 && this.network) {
				const body = (
					this.network as unknown as {
						body: { nodes: Record<string, { options: { fixed?: { x?: boolean; y?: boolean } }; setOptions: (o: unknown) => void }> };
					}
				).body;
				for (const id of nodeIds) {
					try {
						const node = body.nodes[id];
						if (!node) continue;
						const wasFixed = node.options?.fixed?.x === true || node.options?.fixed?.y === true;
						if (wasFixed) {
							// Unpin: release back to physics
							node.setOptions({ fixed: { x: false, y: false } });
						} else {
							// Pin: fix at current position
							const pos = this.network.getPositions([id])[id];
							if (pos) {
								this.network.moveNode(id, pos.x, pos.y);
								node.setOptions({ fixed: { x: true, y: true } });
							}
						}
					} catch {
						// node may have been clustered/removed
					}
				}
			}
		});

		// Double-click empty canvas → unpin all nodes (release the layout).
		// This lets the user "let go" of all pinned nodes and re-stabilize.
		// Double-clicking a node still expands/collapses symbols.

		this.network.on('doubleClick', (params) => {
			const typed = params as { nodes?: string[] } | undefined;
			const id = typed?.nodes?.[0];

			// Empty canvas double-click → unpin all + re-stabilize
			if (!id) {
				if (this.network) {
					const body = (
						this.network as unknown as {
							body: { nodes: Record<string, { setOptions: (o: unknown) => void }> };
						}
					).body;
					let unpinned = 0;
					for (const nid of Object.keys(body.nodes)) {
						try {
							body.nodes[nid]?.setOptions({
								fixed: { x: false, y: false },
							});
							unpinned++;
						} catch {
							// skip
						}
					}
					if (unpinned > 0) {
						this.network.stabilize();
						new Notice(`Unpinned ${unpinned} nodes`);
					}
				}
				return;
			}

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
		// Zone heatmap: each node emits a colored aura. Overlapping auras
		// accumulate (additive blending) to show group/domain/community density.

		this.network.on('beforeDrawing', (rawCtx: unknown) => {
			const ctx = rawCtx as CanvasRenderingContext2D;
			if (!ctx) return;

			const s = this.plugin.settings;
			if (!s.showZones) return;

			// Don't draw auras during initial stabilization — node positions
			// are still shifting rapidly, causing the auras to appear
			// detached from their nodes. Only draw once the layout has settled.
			if (!this.layoutStable) return;

			const drawCommunities =
				this.cachedCommunityLabels &&
				this.cachedCommunityLabels.size > 0;
			const activeGroups = s.colorGroups.filter((g) => g.enabled);
			const model = this.plugin.graphModel;
			const domainHasAny =
				s.zoneColorMode === 'domain' &&
				!!model &&
				Object.values(model.nodes).some((n) => n.domain);
			const groupsActive = s.zoneColorMode === 'groups' && activeGroups.length > 0;
			const commActive = s.zoneColorMode === 'community' && drawCommunities;
			if (!domainHasAny && !groupsActive && !commActive) return;

			const scale = this.network?.getScale() ?? 1;
			const blobRadius = Math.max(30, 80 / scale);

			const positions = this.network?.getPositions();
			if (!positions) return;

			const positionIds = Object.keys(positions);
			// Hard cap for extreme graphs — at this point auras are meaningless
			if (positionIds.length > 3000) return;

			// LOD: above 500 nodes, use cheap solid circles instead of
			// radial gradients. Gradients are ~5× more GPU-expensive per node.
			const useGradient = positionIds.length <= 500;

			// Cache group colors per node to avoid re-evaluating
			// matchesColorGroup every frame.
			const zoneColorFor = (id: string): string | null => {
				if (s.zoneColorMode === 'domain' && model) {
					const node = model.nodes[id];
					if (node?.domain) return domainColor(node.domain);
				} else if (s.zoneColorMode === 'groups' && activeGroups.length > 0 && model) {
					const node = model.nodes[id];
					if (node) {
						for (const g of activeGroups) {
							if (matchesColorGroup(node, g.query)) return g.color;
						}
					}
				} else if (s.zoneColorMode === 'community' && drawCommunities && this.cachedCommunityLabels) {
					const label = this.cachedCommunityLabels.get(id);
					if (label !== undefined) return communityColor(label);
				}
				return null;
			};

			ctx.save();
			ctx.globalCompositeOperation = 'lighter';

			for (const id of positionIds) {
				const pos = positions[id];
				if (!pos) continue;

				if (this.hoverFocus) {
					const d = this.hoverFocus.distances.get(id);
					if (d === undefined || d >= 3) continue;
				}

				const color = zoneColorFor(id);
				if (!color) continue;

				if (useGradient) {
					// High-detail: radial gradient (small graphs only)
					const grad = ctx.createRadialGradient(
						pos.x, pos.y, 0,
						pos.x, pos.y, blobRadius,
					);
					grad.addColorStop(0, colorToRgba(color, 0.06));
					grad.addColorStop(1, colorToRgba(color, 0));
					ctx.fillStyle = grad;
				} else {
					// Cheap LOD: solid semi-transparent circle — no gradient
					// allocation, 5× faster on GPU
					ctx.fillStyle = colorToRgba(color, 0.03);
				}
				ctx.beginPath();
				ctx.arc(pos.x, pos.y, blobRadius, 0, Math.PI * 2);
				ctx.fill();
			}

			ctx.restore();
		});

		this.network.once('stabilizationIterationsDone', () => {
			this.network?.fit({ animation: true });
			this.applyClustering();

			// Layout is now stable — enable zone auras + edge animation
			this.layoutStable = true;

			// ── Place isolated nodes around the perimeter of the main graph.
			//    Isolated nodes (no visible edges) have no springs holding them
			// near the cluster — repulsion pushes them to the edges of the
			// canvas, sometimes way out of view. After stabilization, we
			// compute the bounding circle of the connected graph and place
			// isolated nodes in a ring just outside it, evenly distributed
			// using the golden angle (137.5°) for natural-looking spacing. ──
			if (this.network && this.nodeDS) {
				this.placeIsolatedNodes(nodes);
			}

			// ── Save the converged layout for this model hash so the next
			//    reindex (which may produce the same structure hash) can skip
			//    the full 200-iteration stabilization. ──
			if (this.network) {
				const positions = this.network.getPositions();
				const layout = new Map<string, { x: number; y: number }>();
				for (const id of Object.keys(positions)) {
					const pos = positions[id];
					if (pos) layout.set(id, { x: pos.x, y: pos.y });
				}
				this.savedLayouts.set(modelHash, layout);
				// Cap the cache size — keep the 5 most recent layouts.
				if (this.savedLayouts.size > 5) {
					const oldest = this.savedLayouts.keys().next().value;
					if (oldest) this.savedLayouts.delete(oldest);
				}
			}

			// Restore camera state if we have one saved — prevents the graph
			// from resetting zoom/pan every time a setting is toggled.
			if (this.network && this.savedCamera) {
				this.network.moveTo({
					position: { x: this.savedCamera.x, y: this.savedCamera.y },
					scale: this.savedCamera.scale,
					animation: false,
				});
			}
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
			// Intent-gauging debounce: the user must REST on a node for 300ms
			// before focus kicks in. This prevents rapid flashing as the mouse
			// moves across the graph — the user has to actually stop and look
			// at a node before the spotlight activates. 300ms is fast enough
			// to feel responsive but slow enough to filter out pass-through
			// mouse movement.
			if (this.hoverDebounceTimer !== null)
				window.clearTimeout(this.hoverDebounceTimer);
			this.hoverDebounceTimer = window.setTimeout(() => {
				this.hoverDebounceTimer = null;
				this.setHoverFocus(id);
			}, 300);
		});
		this.network.on('blurNode', () => {
			if (this.hoverDebounceTimer !== null) {
				window.clearTimeout(this.hoverDebounceTimer);
				this.hoverDebounceTimer = null;
			}
			// Delay clearing too — so moving from one node to an adjacent one
			// doesn't flash full-opacity → dark → focus again. 150ms grace
			// period: if the user hovers a new node within 150ms, the blur
			// is cancelled by the new hoverNode event.
			window.setTimeout(() => {
				// Only clear if no new hover started during the grace period
				if (this.hoverDebounceTimer === null && !this.hoverFocus) return;
				this.clearHoverFocus();
			}, 150);
		});
		this.network.on('hoverEdge', () => {
			// Edge hover intentionally does nothing — node hover already shows
			// the full neighborhood with a distance gradient, which is more
			// useful than highlighting a single edge's two endpoints.
		});
		this.network.on('blurEdge', () => {
			// No-op — edge focus was removed.
		});

		// ── Pulsing halo around the focused node (drawn behind the node) ──
		this.network.on('beforeDrawing', (rawCtx: unknown) => {
			const ctx = rawCtx as CanvasRenderingContext2D;
			if (!ctx || !this.hoverFocus || !this.network) return;
			// getPositions() returns ALL visible node positions — at 3000+
			// nodes this allocates a massive object every frame. Use the
			// targeted single-node overload instead.
			let pos: { x: number; y: number } | undefined;
			try {
				const singlePos = this.network.getPositions([
					this.hoverFocus.nodeId,
				]);
				pos = singlePos
					? (singlePos as Record<string, { x: number; y: number }>)[
							this.hoverFocus.nodeId
						]
					: undefined;
			} catch {
				return; // node may have been removed
			}
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

		// ── Edge animation: dashed lines flow in arrow direction, solid
		//    edges get an electric pulse. Drawn via beforeDrawing so pulses
		//    appear BEHIND nodes. ──
		if (this.plugin.settings.animateEdges && shouldAnimateEdges(edges.length)) {
			// Build a lookup map for edge info (from/to/width/type/roundness)
			const edgeInfoMap = new Map<string, EdgeAnimInfo>();
			for (const e of edges) {
				const parts = (e.id as string).split('\u0001');
				const type = parts[2] as EdgeType;
				// Extract roundness from the edge's smooth config
				const smoothCfg = (e as VisEdge & { smooth?: { roundness?: number } }).smooth;
				const roundness = smoothCfg?.roundness ?? EDGE_STYLE[type]?.roundness ?? 0.15;
				edgeInfoMap.set(e.id as string, {
					from: String(e.from ?? parts[0] ?? ''),
					to: String(e.to ?? parts[1] ?? ''),
					width: e.width ?? 1,
					type,
					roundness,
				});
			}
			const edgeIds = edges.map((e) => e.id as string);

			this.network.on('beforeDrawing', (rawCtx: unknown) => {
				const ctx = rawCtx as CanvasRenderingContext2D;
				if (!ctx || !this.network) return;
				const positions = this.network.getPositions();
				const scale = this.network.getScale();
				const view = this.network.getViewPosition();
				const net = this.network as unknown as {
					canvas?: { canvas?: { clientWidth?: number; clientHeight?: number } };
					body?: {
						container?: HTMLElement;
						edges?: Record<string, { edgeType?: { via?: { x: number; y: number } }; via?: { x: number; y: number } }>;
					};
				};
				const canvasW = net.canvas?.canvas?.clientWidth ?? net.body?.container?.clientWidth ?? window.innerWidth;
				const canvasH = net.canvas?.canvas?.clientHeight ?? net.body?.container?.clientHeight ?? window.innerHeight;
				const halfW = canvasW / (2 * scale);
				const halfH = canvasH / (2 * scale);

				// Extract actual Bezier control points from vis-network internals.
				// Each edge object stores its computed `via` point after geometry
				// calc. Using these exact points ensures pulses follow the exact
				// same curve vis-network renders — no approximation error.
				const viaPoints = new Map<string, { x: number; y: number }>();
				const bodyEdges = net.body?.edges;
				if (bodyEdges) {
					for (const edgeId of edgeIds) {
						const edgeObj = bodyEdges[edgeId];
						const via = edgeObj?.edgeType?.via ?? edgeObj?.via;
						if (via) viaPoints.set(edgeId, via);
					}
				}

				drawEdgeAnimation(ctx, positions, edgeIds, edgeInfoMap, {
					hoverFocusId: this.hoverFocus?.nodeId ?? null,
					hopDistances: this.hoverFocus?.distances ?? null,
					scale,
					viewport: {
						left: view.x - halfW,
						right: view.x + halfW,
						top: view.y - halfH,
						bottom: view.y + halfH,
					},
					viaPoints,
				});
			});

			// Start the edge animation redraw loop
			this.startEdgeAnimation();
		}

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

		// ── Derived-data cache (keyed off model.builtAt) ──
		// Fan-in/fan-out/maxes/community labels are functions of the MODEL, not
		// the render filters. Computing them here on every buildData() call
		// (which fires on every debounced filter toggle) re-scans the full
		// edge table 4-6× and re-runs detectCommunities() (O(V·E)·15).
		// Cache them per model version so filter toggles are instant.
		let derived = this.derivedCache;
		if (!derived || derived.builtAt !== model.builtAt) {
			const fanIn = new Map<string, number>();
			const fanOut = new Map<string, number>();
			for (const e of model.edges) {
				if (e.type === 'contains') continue;
				fanIn.set(e.dst, (fanIn.get(e.dst) ?? 0) + 1);
				fanOut.set(e.src, (fanOut.get(e.src) ?? 0) + 1);
			}
			const nodeDegree = (id: string): number =>
				(fanIn.get(id) ?? 0) + (fanOut.get(id) ?? 0);
			let maxLOC = 1, maxDeg = 1, maxFi = 1, maxFo = 1;
			for (const n of Object.values(model.nodes)) {
				maxLOC = Math.max(maxLOC, n.lines ?? 0);
				maxDeg = Math.max(maxDeg, nodeDegree(n.id));
				maxFi = Math.max(maxFi, fanIn.get(n.id) ?? 0);
				maxFo = Math.max(maxFo, fanOut.get(n.id) ?? 0);
			}
			// Community detection: compute ONCE per model, not per render.
			// Run on ALL nodes (not just visible) so the labels are stable
			// across filter toggles. This is the O(V·E)·15 hot path — moving
			// it here from the per-toggle path is the main interactivity win.
			const allNodeIds = Object.keys(model.nodes);
			const communityLabels = detectCommunities(
				model.edges,
				allNodeIds,
			);
			// Hover-focus adjacency: build once per model so computeHopDistances
			// doesn't rebuild the full edge→adjacency map on every hover.
			// Uses ALL non-contains edges (not filtered by enabled types)
			// because hover should show the real dependency neighborhood.
			const hoverAdjacency = new Map<string, Map<string, number>>();
			for (const e of model.edges) {
				if (e.type === 'contains') continue;
				let bucket = hoverAdjacency.get(e.src);
				if (!bucket) { bucket = new Map(); hoverAdjacency.set(e.src, bucket); }
				bucket.set(e.dst, Math.max(bucket.get(e.dst) ?? 0, e.weight));
				let bucket2 = hoverAdjacency.get(e.dst);
				if (!bucket2) { bucket2 = new Map(); hoverAdjacency.set(e.dst, bucket2); }
				bucket2.set(e.src, Math.max(bucket2.get(e.src) ?? 0, e.weight));
			}
			derived = {
				builtAt: model.builtAt,
				fanIn,
				fanOut,
				maxLOC,
				maxDeg,
				maxFi,
				maxFo,
				communityLabels,
				hoverAdjacency,
			};
			this.derivedCache = derived;
		}

		const { fanIn, fanOut, maxLOC, maxDeg, maxFi, maxFo } = derived;
		this.cachedFanIn = fanIn;
		this.cachedFanOut = fanOut;
		this.cachedCommunityLabels = derived.communityLabels;
		const nodeDegree = (id: string): number =>
			(fanIn.get(id) ?? 0) + (fanOut.get(id) ?? 0);

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

		// ── maxNodes render cap with top-N-by-degree sampling ──
		// When the visible set exceeds maxNodes, keep the highest-degree nodes
		// (most connected = most important) and drop the long tail. This is the
		// Obsidian-native-graph approach: don't render everything, render what
		// matters. Auto-degrade zones/smoothing is handled in buildOptions.
		const maxNodes = s.maxNodes;
		let cappedNodeIds: Set<string> | null = null;
		if (maxNodes > 0 && nodeIds.size > maxNodes && !visible) {
			// Only cap when showing the whole graph (no neighborhood filter).
			const ranked = [...nodeIds].sort(
				(a, b) => nodeDegree(b) - nodeDegree(a),
			);
			cappedNodeIds = new Set(ranked.slice(0, maxNodes));
		}

		// ── Incident set (for hideIsolated + edge filtering) ──
		const effectiveNodeIds = cappedNodeIds ?? nodeIds;
		const incident = new Set<string>();
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			if (effectiveNodeIds.has(e.src) && effectiveNodeIds.has(e.dst)) {
				incident.add(e.src);
				incident.add(e.dst);
			}
		}

		// ── Community labels (from cache — already computed per model) ──
		const communityLabels =
			s.colorMode === 'community' || s.zoneColorMode === 'community'
				? derived.communityLabels
				: null;

		// ── Color group matching (user-defined groups override defaults) ──
		const activeGroups = s.colorGroups.filter((g) => g.enabled);
		const groupColorFor = (node: GraphNode): string | null => {
			for (const g of activeGroups) {
				if (matchesColorGroup(node, g.query)) return g.color;
			}
			return null;
		};

		// (Edge smoothing is always enabled — see edgeStyle() for details)
		// (disableSmooth removed — edges are always smooth with type 'dynamic'
		// so connection points distribute around the node perimeter naturally)

		// ── Build vis nodes ──
		const nodes: VisNode[] = [];
		for (const id of effectiveNodeIds) {
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

			// ── Node mass proportional to degree, φ-weighted ──
			// vis-network's barnesHut physics models edges as springs. When
			// you drag a node, the spring force pulls connected nodes. But if
			// all nodes have the same default mass (1), hubs with 200 edges
			// barely pull their neighbors. Setting mass ∝ degree × φ means:
			// - Hubs are "heavy" (mass up to 80) — they anchor clusters and
			//   pull their neighbors along when dragged.
			// - Small nodes have a floor mass of 2 — they resist being yanked
			//   by every little drag, so the graph doesn't wobble forever.
			// - φ scaling gives a natural progression: degree 1 → 2, degree 5
			//   → 8, degree 10 → 16, degree 50 → 50 (capped at 80).
			const deg = nodeDegree(id);
			const mass = Math.max(2, Math.min(Math.round(deg * PHI), 80));

			const visNode: VisNode = {
				id,
				label,
				title,
				mass,
				...nodeStyle(styledNode, sz, isDead, s.colorMode, communityLabels, activeGroups.length > 0 ? activeGroups : null),
			};
			nodes.push(visNode);
		}

		// ── Build vis edges ──
		// Per-edge rest length: intra-folder edges are tight (÷ stretchiness),
		// cross-folder edges are stretchy (× stretchiness). This lets you pull
		// a cluster away from the graph — cross-cluster edges stretch like
		// rubber bands instead of dragging the whole graph. Intra-cluster
		// edges stay short, so the cluster moves as a cohesive unit.
		// The stretchiness factor is user-controllable: 1.0 = uniform (all
		// edges same length), 1.618 = golden ratio (default), 3.0 = very
		// stretchy (clusters pull apart easily).
		const baseLen = s.linkDistance;
		const stretch = s.stretchiness;
		const intraLen = Math.round(baseLen / stretch);
		const crossLen = Math.round(baseLen * stretch);
		// Pre-compute folder keys for visible nodes (avoids re-splitting path
		// strings for every edge).
		const folderOf = new Map<string, string>();
		for (const id of effectiveNodeIds) {
			const n = model.nodes[id];
			if (n) folderOf.set(id, folderKey(n));
		}

		// ── Build vis edges ──
		// Detect parallel edges (same src→dst pair, different types) so we can
		// assign fan-out roundness offsets. Without this, multiple edges between
		// the same pair would overlap. Each parallel edge gets an additional
		// roundness offset so they curve to different "lanes" — like cables
		// on a suspension bridge fanning out from the same anchor point.
		const parallelCount = new Map<string, number>();
		const edges: VisEdge[] = [];
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			if (visible && (!visible.has(e.src) || !visible.has(e.dst)))
				continue;
			if (!effectiveNodeIds.has(e.src) || !effectiveNodeIds.has(e.dst))
				continue;

			// Track how many edges connect this same pair (either direction)
			const pairKey = e.src < e.dst ? `${e.src}\u0001${e.dst}` : `${e.dst}\u0001${e.src}`;
			const count = parallelCount.get(pairKey) ?? 0;
			parallelCount.set(pairKey, count + 1);

			// Determine edge length: same folder → tight, different folder → stretchy
			const srcFolder = folderOf.get(e.src);
			const dstFolder = folderOf.get(e.dst);
			const sameCluster = srcFolder !== undefined && srcFolder === dstFolder;
			const edgeLen = sameCluster ? intraLen : crossLen;

			// Fan-out: for parallel edges, add an offset so each curves to a
			// different lane. The first edge uses the type's base roundness.
			// Each additional edge gets ±0.15 extra curvature, alternating
			// direction (clockwise / counter-clockwise) so they fan symmetrically.
			let roundnessOverride: number | undefined;
			if (count > 0) {
				const direction = count % 2 === 1 ? 1 : -1;
				const magnitude = Math.ceil(count / 2) * 0.15;
				roundnessOverride = EDGE_STYLE[e.type].roundness + direction * magnitude;
			}

			const visEdge: VisEdge = {
				id: `${e.src}\u0001${e.dst}\u0001${e.type}`,
				from: e.src,
				to: e.dst,
				...edgeStyle(e.type, e.weight, roundnessOverride, edgeLen),
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
		// Use cached adjacency if available (built once per model version).
		// Previously this rebuilt the full adjacency from ALL edges on every
		// single hover event — at 6000 edges that's 12000 Map operations
		// synchronously on the main thread, causing 50-100ms freezes.
		const neighbors = this.derivedCache?.hoverAdjacency ?? new Map<string, Map<string, number>>();

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

	/**
	 * Place isolated nodes (degree 0 in the visible graph) in a ring around
	 * the perimeter of the main connected graph. Uses the golden angle
	 * (137.5° = 360°/φ²) for natural, non-clumping distribution. If there are
	 * few isolated nodes, they cluster together on one side of the ring; if
	 * many, they spread evenly around the full perimeter.
	 *
	 * This prevents isolated nodes from drifting to the edges of the canvas
	 * or way out into "outer space" — they stay near the graph, just outside
	 * the main cluster, in a predictable ring.
	 */
	private placeIsolatedNodes(allNodes: VisNode[]): void {
		if (!this.network) return;
		const s = this.plugin.settings;
		const enabled = s.edgeTypesEnabled;

		// Find which node IDs are isolated (no enabled edges connect them)
		const model = this.plugin.graphModel;
		if (!model) return;
		const connectedIds = new Set<string>();
		for (const e of model.edges) {
			if (!enabled[e.type]) continue;
			connectedIds.add(e.src);
			connectedIds.add(e.dst);
		}
		const isolatedIds = allNodes
			.map((n) => n.id as string)
			.filter((id) => !connectedIds.has(id));
		if (isolatedIds.length === 0) return;

		// Compute bounding circle of the connected graph
		const positions = this.network.getPositions();
		let cx = 0, cy = 0, connectedCount = 0;
		let maxR = 0;
		for (const id of Object.keys(positions)) {
			if (!connectedIds.has(id)) continue;
			const pos = positions[id];
			if (!pos) continue;
			cx += pos.x;
			cy += pos.y;
			connectedCount++;
		}
		if (connectedCount === 0) return;
		cx /= connectedCount;
		cy /= connectedCount;
		for (const id of Object.keys(positions)) {
			if (!connectedIds.has(id)) continue;
			const pos = positions[id];
			if (!pos) continue;
			const r = Math.hypot(pos.x - cx, pos.y - cy);
			if (r > maxR) maxR = r;
		}

		// Place isolated nodes in a ring just outside the main graph's
		// bounding circle. The ring radius is derived purely from the graph's
		// actual extent (maxR) — scaled by φ so it's proportional to the graph
		// size, not a hardcoded pixel offset. A tiny graph gets a tight ring;
		// a 3000-node graph gets a proportionally larger ring.
		const ringRadius = maxR * PHI;
		const goldenAngle = 2 * Math.PI / (PHI * PHI); // ≈ 137.5°
		const startOffset = Math.random() * Math.PI * 2; // random rotation
		const body = (
			this.network as unknown as {
				body: { nodes: Record<string, { setOptions: (o: unknown) => void }> };
			}
		).body;
		for (let i = 0; i < isolatedIds.length; i++) {
			const id = isolatedIds[i]!;
			const angle = startOffset + i * goldenAngle;
			const x = cx + Math.cos(angle) * ringRadius;
			const y = cy + Math.sin(angle) * ringRadius;
			try {
				this.network.moveNode(id, x, y);
				// Pin isolated nodes so physics doesn't push them off-screen.
				// The user can still drag them (drag toggles the pin).
				body.nodes[id]?.setOptions({ fixed: { x: true, y: true } });
			} catch {
				// node may have been clustered/removed
			}
		}
	}

	/** Start the edge animation redraw loop without rebuilding the graph. */
	private startEdgeAnimation(): void {
		if (this.edgeAnimTimer !== null) return;
		if (!this.network) return;
		const tick = (): void => {
			if (!this.network) {
				this.edgeAnimTimer = null;
				return;
			}
			this.network.redraw();
			this.edgeAnimTimer = window.requestAnimationFrame(tick);
		};
		this.edgeAnimTimer = window.requestAnimationFrame(tick);
	}

	/** Stop the edge animation redraw loop. */
	private stopEdgeAnimation(): void {
		if (this.edgeAnimTimer !== null) {
			window.cancelAnimationFrame(this.edgeAnimTimer);
			this.edgeAnimTimer = null;
		}
		// Redraw once more to clear the animation overlay
		this.network?.redraw();
	}

	private buildOptions(nodeCount: number, edgeCount: number): Options {
		const s = this.plugin.settings;
		// ── Auto-degrade: when node/edge count exceeds thresholds, disable
		//    expensive features automatically. Small graphs stay full-quality. ──
		const maxNodes = s.maxNodes;
		const smoothThreshold = s.edgeSmoothThreshold;
		const overNodeCap =
			maxNodes > 0 && nodeCount > maxNodes;
		const overEdgeCap =
			smoothThreshold > 0 && edgeCount > smoothThreshold;
		this.degraded = overNodeCap || overEdgeCap;
		// Hover detection is vis-network's most expensive interaction feature:
		// it hit-tests every visible node on every mousemove. Above the
		// threshold, disable it so mouse movement doesn't trigger per-frame
		// canvas work. The user can still click nodes — they just lose hover
		// dimming/spotlight (which is unreadable at this scale anyway).
		const hoverTooExpensive = nodeCount > HOVER_DISABLE_THRESHOLD;

		const options: Options = {
			nodes: { shape: 'dot', font: { size: 13 } },
			edges: {
				// Per-edge smooth is set in edgeStyle(); global default is neutral
				smooth: { enabled: false },
				// Set all color sub-properties so vis-network never falls back
				// to its default grey (#848484) during any render state.
				color: {
					color: '#64748b',
					highlight: '#64748b',
					hover: '#64748b',
					inherit: false,
					opacity: 0.85,
				},
				// Disable vis-network's built-in hover/select edge styling.
				// Without this, hovering causes vis-network to override our
				// edge colors with its default grey (#848484). Our
				// applyHoverOpacity system is the sole controller of edge
				// appearance.
				chosen: { edge: false, label: false },
			},
			physics: {
				enabled: s.physicsEnabled,
				stabilization: { iterations: 200 },
				barnesHut: {
					gravitationalConstant: -(s.repelForce / 100) * 12000,
					centralGravity: s.centerForce / 100,
					// Spring constant: how strongly edges pull connected nodes.
					// Per-edge `length` (set in buildData) makes cross-cluster
					// edges stretchy (× stretchiness) and intra-cluster edges
					// tight (÷ stretchiness), so you can pull clusters apart.
					springConstant: (s.linkForce / 100) * 0.5,
					springLength: s.linkDistance,
					// Damping 0.55: high enough that oscillations die quickly
					// after drag/stabilization. Combined with minVelocity below,
					// the graph settles instead of jittering forever.
					damping: 0.55,
				},
				// minVelocity: below this, physics treats velocity as zero and
				// stops the simulation. This is the key settling parameter.
				// Higher value = settles faster (but may stop before perfect
				// convergence). 5.0 is a good balance — the graph looks settled
				// visually but doesn't waste CPU on micro-oscillations.
				minVelocity: 5.0,
				// maxVelocity: cap so nodes don't fly off-screen during drag.
				maxVelocity: 30,
				// adaptiveTimestep: vis-network adjusts the integration step
				// for stability. Helps prevent the "explosive" behavior when
				// you release a dragged node.
				adaptiveTimestep: true,
				timestep: 0.35,
			},
			interaction: {
				hover: !hoverTooExpensive,
				tooltipDelay: 120,
				navigationButtons: false,
				keyboard: false,
			},
		} as Options;

		// ── Perf escape hatches ──
		// Don't use hideEdgesOnDrag — it makes edges vanish completely during
		// canvas pan/zoom, which is jarring. Instead we hook dragStart/dragEnd
		// to temporarily lower edge opacity (semi-transparent) during canvas
		// drag. This keeps the graph structure visible while still reducing
		// the per-frame draw cost. See the dragStart/dragEnd handlers in render().
		(options as Record<string, Record<string, unknown>>).interaction = {
			...((options as Record<string, Record<string, unknown>>).interaction as object),
			hideEdgesOnDrag: false,
			hideNodesOnDrag: overNodeCap || nodeCount > HOVER_DISABLE_THRESHOLD,
		};

		// improvedLayout defaults to true but is O(N²) — disable on large graphs
		if (overNodeCap) {
			(options as Record<string, Record<string, unknown>>).layout = {
				improvedLayout: false,
				randomSeed: 42,
			};
		}

		return options;
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
