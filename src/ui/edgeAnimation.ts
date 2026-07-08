/**
 * @file Edge animation overlay — neural-net-visualizer style.
 *
 * Inspired by /home/josh/Downloads/neural-network-visualizer/src/script.js
 * (our own code). That visualizer fires pulses along connections as bright
 * radial-gradient dots with additive blending — vivid, organic, and
 * instantly readable as "data flowing."
 *
 * Two animation styles, determined by the edge's dash pattern:
 *
 * 1. **Dashed edges** (inherits, implements, etc.): the dash pattern flows
 *    in the arrow direction using Canvas `lineDashOffset`.
 *
 * 2. **Solid edges** (imports, calls, etc.): an "electric pulse" — a bright
 *    traveling dot with a radial-gradient glow halo, drawn with additive
 *    blending so overlapping pulses brighten naturally.
 *
 * **Curve alignment**: pulses follow the quadratic Bezier curve that
 * vis-network uses for `smooth.type: 'dynamic'` edges. The control point
 * is computed from the edge's `roundness` parameter so the pulse tracks
 * the visible curve, not a straight line.
 *
 * **LOD (Level of Detail)**: at low zoom (zoomed out), pulses skip the
 * expensive radial-gradient glow and fading trail, drawing only a simple
 * dot. At medium zoom, glow is added. At high zoom, full detail.
 *
 * **Viewport culling**: only edges with at least one endpoint within the
 * current viewport are animated, dramatically reducing work on large graphs.
 *
 * Integration with hover focus: animation speed and intensity scale with the
 * same φ-decay hop-distance logic used for opacity — no duplicated logic.
 */

import { EDGE_STYLE, type EdgeType, type EdgeArrow } from '../types';

/** Max visible edges before animation auto-disables for performance. */
const ANIM_EDGE_THRESHOLD = 5000;

// ── Animation constants ──
const BASE_PULSE_SPEED = 0.004;
const FOCUSED_PULSE_SPEED = 0.014;
const BULLET_TIME_SPEED = 0.1;
const DASH_SPEED = 0.5;
const PULSE_LENGTH = 0.15;
const BIDIR_PERIOD = 120;

/** LOD zoom thresholds: below these, simplify rendering. */
const LOD_DOT_ONLY = 0.3;   // below 0.3 zoom: skip glow + trail
const LOD_NO_TRAIL = 0.6;   // below 0.6 zoom: skip trail but keep glow

/** Viewport cull margin in graph units — don't cull edges whose endpoints
 * are just slightly off-screen (they may curve into view). */
const CULL_MARGIN = 200;

function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return h;
}

const PHI = 1.61803398875;

function animIntensity(hopDistance: number | undefined, isFocused: boolean): number {
	if (!isFocused) return 0.3;
	if (hopDistance === undefined) return 0.015;
	if (hopDistance <= 0) return 1.0;
	if (hopDistance === 1) return 0.9;
	const decay = Math.pow(1 / PHI, hopDistance) * 0.85 + 0.05;
	return Math.max(decay, 0.05);
}

function animSpeed(hopDistance: number | undefined, isFocused: boolean): number {
	if (!isFocused) return BASE_PULSE_SPEED;
	if (hopDistance === undefined) return BASE_PULSE_SPEED * BULLET_TIME_SPEED;
	if (hopDistance <= 1) return FOCUSED_PULSE_SPEED;
	return FOCUSED_PULSE_SPEED * Math.pow(1 / PHI, hopDistance - 1);
}

export interface EdgeAnimInfo {
	from: string;
	to: string;
	width: number;
	type: EdgeType;
	/** The edge's smooth roundness — used as fallback if no via point. */
	roundness: number;
}

interface EdgeAnimContext {
	hoverFocusId: string | null;
	hopDistances: Map<string, number> | null;
	scale: number;
	viewport: { left: number; right: number; top: number; bottom: number };
	/**
	 * Actual Bezier control points from vis-network internals.
	 * Map of edgeId → {x, y} via point. These are read from
	 * `network.body.edges[id].edgeType.via` each frame so the pulse
	 * follows the EXACT curve vis-network renders, not an approximation.
	 */
	viaPoints: Map<string, { x: number; y: number }>;
}

let frame = 0;

/**
 * Compute a point along a quadratic Bezier curve at parameter t (0-1).
 * Uses the actual control point from vis-network if available (via),
 * otherwise computes an approximation from roundness.
 */
function bezierPoint(
	x1: number, y1: number,
	x2: number, y2: number,
	roundness: number,
	via: { x: number; y: number } | undefined,
	t: number,
): { x: number; y: number } {
	let cpX: number;
	let cpY: number;
	if (via) {
		// Use the EXACT control point vis-network computed for this edge.
		cpX = via.x;
		cpY = via.y;
	} else {
		// Fallback: approximate from roundness
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.hypot(dx, dy);
		if (len < 0.001) return { x: x1, y: y1 };
		const perpX = dy / len;
		const perpY = -dx / len;
		const offsetDist = roundness * len;
		cpX = (x1 + x2) / 2 + perpX * offsetDist;
		cpY = (y1 + y2) / 2 + perpY * offsetDist;
	}
	const mt = 1 - t;
	const mt2 = mt * mt;
	const t2 = t * t;
	return {
		x: mt2 * x1 + 2 * mt * t * cpX + t2 * x2,
		y: mt2 * y1 + 2 * mt * t * cpY + t2 * y2,
	};
}

/** Quick check if a point is within the viewport (with margin). */
function inViewport(
	x: number, y: number,
	vp: { left: number; right: number; top: number; bottom: number },
): boolean {
	return (
		x >= vp.left - CULL_MARGIN && x <= vp.right + CULL_MARGIN &&
		y >= vp.top - CULL_MARGIN && y <= vp.bottom + CULL_MARGIN
	);
}

export function drawEdgeAnimation(
	ctx: CanvasRenderingContext2D,
	positions: Record<string, { x: number; y: number }>,
	edgeIds: string[],
	edgeData: Map<string, EdgeAnimInfo>,
	context: EdgeAnimContext,
): void {
	if (edgeIds.length > ANIM_EDGE_THRESHOLD) return;
	frame++;

	const isFocused = context.hoverFocusId !== null;
	const hopDistances = context.hopDistances;
	const scale = context.scale;
	const vp = context.viewport;
	const viaPoints = context.viaPoints;

	// LOD: determine what to render based on zoom level
	const dotOnly = scale < LOD_DOT_ONLY;
	const skipTrail = scale < LOD_NO_TRAIL;

	// ── Phase 1: dashed edges (flowing dash offset) ──
	ctx.save();
	for (const edgeId of edgeIds) {
		const info = edgeData.get(edgeId);
		if (!info) continue;
		const style = EDGE_STYLE[info.type];
		if (!style || !style.dashes) continue;

		const fromPos = positions[info.from];
		const toPos = positions[info.to];
		if (!fromPos || !toPos) continue;

		// Viewport culling: skip if both endpoints are far off-screen
		if (!inViewport(fromPos.x, fromPos.y, vp) && !inViewport(toPos.x, toPos.y, vp))
			continue;

		const dx = toPos.x - fromPos.x;
		const dy = toPos.y - fromPos.y;
		if (Math.hypot(dx, dy) < 2) continue;

		const hopDist = hopDistances?.get(info.from) ?? hopDistances?.get(info.to);
		const intensity = animIntensity(hopDist, isFocused);
		if (intensity < 0.01) continue;
		const speed = animSpeed(hopDist, isFocused);
		const dashSpeedMul = speed / BASE_PULSE_SPEED;

		drawFlowingDashes(
			ctx,
			fromPos.x, fromPos.y,
			toPos.x, toPos.y,
			info.roundness,
			viaPoints.get(edgeId),
			style.color,
			info.width,
			style.arrow,
			intensity,
			dashSpeedMul,
			dotOnly,
		);
	}
	ctx.restore();

	// ── Phase 2: solid edges (electric pulse with radial glow) ──
	ctx.save();
	ctx.globalCompositeOperation = 'lighter';

	for (const edgeId of edgeIds) {
		const info = edgeData.get(edgeId);
		if (!info) continue;
		const style = EDGE_STYLE[info.type];
		if (!style || style.dashes) continue;

		const fromPos = positions[info.from];
		const toPos = positions[info.to];
		if (!fromPos || !toPos) continue;

		// Viewport culling
		if (!inViewport(fromPos.x, fromPos.y, vp) && !inViewport(toPos.x, toPos.y, vp))
			continue;

		const dx = toPos.x - fromPos.x;
		const dy = toPos.y - fromPos.y;
		if (Math.hypot(dx, dy) < 5) continue;

		const hopDist = hopDistances?.get(info.from) ?? hopDistances?.get(info.to);
		const intensity = animIntensity(hopDist, isFocused);
		if (intensity < 0.02) continue;
		const speed = animSpeed(hopDist, isFocused);

		const typeHash = hashString(info.type + edgeId);
		const phase = ((frame * speed + (typeHash % 1000) / 1000) % 1 + 1) % 1;

		drawElectricPulse(
			ctx,
			fromPos.x, fromPos.y,
			toPos.x, toPos.y,
			info.roundness,
			viaPoints.get(edgeId),
			style.color,
			info.width,
			intensity,
			phase,
			dotOnly,
			skipTrail,
		);
	}

	ctx.restore();
}

/**
 * Draw flowing dashes along a curved edge. Uses `bezierPoint` to compute
 * the curve, then strokes dashes along it with a `lineDashOffset` that
 * shifts each frame in the arrow direction.
 */
function drawFlowingDashes(
	ctx: CanvasRenderingContext2D,
	x1: number, y1: number,
	x2: number, y2: number,
	roundness: number,
	via: { x: number; y: number } | undefined,
	color: string,
	width: number,
	arrow: EdgeArrow,
	intensity: number,
	speedMul: number,
	lodDotOnly: boolean,
): void {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'round';
	ctx.setLineDash([8, 4]);

	const effectiveSpeed = DASH_SPEED * speedMul;
	let offset: number;
	if (arrow === 'both') {
		offset = Math.sin((frame * speedMul / BIDIR_PERIOD) * Math.PI * 2) * 24;
	} else if (arrow === 'from') {
		offset = -frame * effectiveSpeed;
	} else {
		offset = frame * effectiveSpeed;
	}

	ctx.lineDashOffset = offset;
	ctx.globalAlpha = 0.3 + intensity * 0.6;

	// Draw along the actual Bezier curve using vis-network's control point.
	let cpX: number, cpY: number;
	if (via) {
		cpX = via.x;
		cpY = via.y;
	} else {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.hypot(dx, dy);
		const perpX = len > 0.001 ? dy / len : 0;
		const perpY = len > 0.001 ? -dx / len : 0;
		const offsetDist = roundness * len;
		cpX = (x1 + x2) / 2 + perpX * offsetDist;
		cpY = (y1 + y2) / 2 + perpY * offsetDist;
	}

	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.quadraticCurveTo(cpX, cpY, x2, y2);
	ctx.stroke();
	ctx.restore();
}

/**
 * Draw an electric pulse traveling along a curved edge. The pulse position
 * is computed using `bezierPoint()` so it follows the same Bezier curve
 * that vis-network renders for the edge.
 */
function drawElectricPulse(
	ctx: CanvasRenderingContext2D,
	x1: number, y1: number,
	x2: number, y2: number,
	roundness: number,
	via: { x: number; y: number } | undefined,
	color: string,
	width: number,
	intensity: number,
	phase: number,
	lodDotOnly: boolean,
	skipTrail: boolean,
): void {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = Math.hypot(dx, dy);
	if (len < 5) return;

	// Pulse position along the BEZIER CURVE using vis-network's exact via point
	const pos = bezierPoint(x1, y1, x2, y2, roundness, via, phase);

	const r = parseInt(color.slice(1, 3), 16);
	const g = parseInt(color.slice(3, 5), 16);
	const b = parseInt(color.slice(5, 7), 16);

	// ── LOD: glow halo only at medium+ zoom ──
	if (!lodDotOnly) {
		const glowRadius = (20 + width * 4) * (0.4 + intensity * 0.6);
		const glowAlpha = intensity * 0.5;
		const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowRadius);
		grad.addColorStop(0, `rgba(${r},${g},${b},${glowAlpha})`);
		grad.addColorStop(0.4, `rgba(${r},${g},${b},${glowAlpha * 0.15})`);
		grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
		ctx.fillStyle = grad;
		ctx.fillRect(pos.x - glowRadius, pos.y - glowRadius, glowRadius * 2, glowRadius * 2);
	}

	// ── Bright dot ──
	const dotSize = lodDotOnly
		? Math.max(1, width * 0.8)  // simpler at low zoom
		: 1.5 + width * 1.2 + intensity * 1.5;
	ctx.beginPath();
	ctx.arc(pos.x, pos.y, dotSize, 0, Math.PI * 2);
	ctx.fillStyle = `rgba(${r},${g},${b},${0.4 + intensity * 0.5})`;
	ctx.fill();

	// ── White-hot core (skip at lowest LOD) ──
	if (!lodDotOnly) {
		ctx.beginPath();
		ctx.arc(pos.x, pos.y, dotSize * 0.35, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(255,255,255,${0.3 + intensity * 0.4})`;
		ctx.fill();
	}

	// ── Fading trail along the Bezier curve (skip at low LOD) ──
	if (!skipTrail) {
		const trailLen = PULSE_LENGTH;
		const trailStart = ((phase - trailLen) % 1 + 1) % 1;
		const segments = 5;
		for (let i = 0; i < segments; i++) {
			const t0 = trailStart + (i / segments) * trailLen;
			const t1 = trailStart + ((i + 1) / segments) * trailLen;
			const ct0 = ((t0 % 1) + 1) % 1;
			const ct1 = ((t1 % 1) + 1) % 1;
			if (ct1 < ct0) continue;

			// Trail points along the Bezier curve using vis-network's via point
			const p0 = bezierPoint(x1, y1, x2, y2, roundness, via, ct0);
			const p1 = bezierPoint(x1, y1, x2, y2, roundness, via, ct1);

			const trailAlpha = (i / segments) * intensity * 0.3;
			ctx.strokeStyle = `rgba(${r},${g},${b},${trailAlpha})`;
			ctx.lineWidth = width * (0.8 + intensity * 0.4);
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(p0.x, p0.y);
			ctx.lineTo(p1.x, p1.y);
			ctx.stroke();
		}
	}
}

/** Whether the edge animation should be active (based on edge count). */
export function shouldAnimateEdges(edgeCount: number): boolean {
	return edgeCount <= ANIM_EDGE_THRESHOLD;
}