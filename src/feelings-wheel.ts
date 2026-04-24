/**
 * Feelings wheel renderer — inspired by https://feelingswheel.com
 * Based on the Gloria Willcox feelings wheel.
 */
import {buildFlatSegments, type FlatSegment} from "./feelings-data";

const SNAP_THRESHOLD = 0.02; // velocity below which snap-to-center kicks in
const MIN_VELOCITY = 0.0002;
const DRUM_ZOOM_BOOST = 0.85; // additional angular warp when 3D is on
const DRUM_MIN_OPACITY = 0.1; // opacity at the far side of the drum

// Ring radii as fractions of total radius
const CORE_INNER = 0.28;
const CORE_OUTER = 0.48;
const SEC_INNER = 0.48;
const SEC_OUTER = 0.73;
const TERT_INNER = 0.73;
const TERT_OUTER = 1.0;

export class FeelingsWheel {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private angle = 0;
	private velocity = 0;
	private animFrameId: number | null = null;
	private isDragging = false;
	private lastPointerAngle = 0;
	private lastPointerTime = 0;
	private totalDragDist = 0;
	private lastPointerY = 0;
	private highlightedLabel: string | null = null;
	private highlightAlpha = 0;

	private radius = 0;
	private centerX = 0;
	private centerY = 0;
	private dpr = 1;

	private coreSegments: FlatSegment[];
	private secSegments: FlatSegment[];
	private tertSegments: FlatSegment[];

	private boundPointerDown: (e: PointerEvent) => void;
	private boundPointerMove: (e: PointerEvent) => void;
	private boundPointerUp: (e: PointerEvent) => void;

	private zoomStrength: number;

	constructor(
		private container: HTMLElement,
		private onTapEmotion: (emotion: string) => void,
		zoomPercent = 50,
		private drum3d: "off" | "opacity" | "size" = "off",
		rolodex = {k: 60, floor: 0.1, peak: 300, resolution: 1024, snap: 0.02, fontScale: 0.5, fontCeiling: 0.8, weightScale: 0.5},
		private physics = {snap: 0.08, friction: 0.92, reach: 0.95},
		private onTapEmpty?: () => void,
	) {
		// Map 0-100 slider to 0-0.9 warp strength
		this.zoomStrength = (zoomPercent / 100) * 0.9;
		this.rolodexK = rolodex.k;
		this.rolodexFloor = rolodex.floor;
		this.rolodexPeak = rolodex.peak;
		this.rolodexN = rolodex.resolution;
		this.rolodexSnap = rolodex.snap;
		this.rolodexFontScale = rolodex.fontScale;
		this.rolodexFontCeiling = rolodex.fontCeiling;
		this.rolodexWeightScale = rolodex.weightScale;
		const segments = buildFlatSegments();
		this.coreSegments = segments.core;
		this.secSegments = segments.secondary;
		this.tertSegments = segments.tertiary;

		this.buildSizeWarpTable();

		this.canvas = document.createElement("canvas");
		this.canvas.className = "emily-feelings-canvas";
		this.container.appendChild(this.canvas);

		this.ctx = this.canvas.getContext("2d", {desynchronized: true}) as CanvasRenderingContext2D;

		this.boundPointerDown = this.onPointerDown.bind(this);
		this.boundPointerMove = this.onPointerMove.bind(this);
		this.boundPointerUp = this.onPointerUp.bind(this);

		this.canvas.addEventListener("pointerdown", this.boundPointerDown);
		window.addEventListener("pointermove", this.boundPointerMove);
		window.addEventListener("pointerup", this.boundPointerUp);

		this.resize();
	}

	resize(): void {
		this.dpr = window.devicePixelRatio || 1;
		const rect = this.container.getBoundingClientRect();
		const w = rect.width;
		const h = rect.height;

		if (w === 0 || h === 0) return;

		this.radius = h * 0.85;
		const targetVisibleWidth = Math.min(w * this.physics.reach, this.radius * 0.75);
		this.centerX = targetVisibleWidth - this.radius;
		this.centerY = h / 2;

		const visibleWidth = Math.ceil(this.centerX + this.radius * TERT_OUTER) + 40;
		const canvasW = Math.min(Math.max(visibleWidth, 100), w);

		this.canvas.style.width = `${canvasW}px`;
		this.canvas.style.height = `${h}px`;
		this.canvas.width = canvasW * this.dpr;
		this.canvas.height = h * this.dpr;

		this.draw();
	}

	private draw(): void {
		const ctx = this.ctx;
		const dpr = this.dpr;
		const R = this.radius * dpr;
		const cx = this.centerX * dpr;
		const cy = this.centerY * dpr;
		const rot = this.angle;

		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		this.drawRing(ctx, cx, cy, R, rot, this.coreSegments, CORE_INNER, CORE_OUTER, 18, false);
		this.drawRing(ctx, cx, cy, R, rot, this.secSegments, SEC_INNER, SEC_OUTER, 15, false);
		this.drawRing(ctx, cx, cy, R, rot, this.tertSegments, TERT_INNER, TERT_OUTER, 14, true);

		// Ring border circles
		ctx.strokeStyle = "rgba(255,255,255,0.35)";
		ctx.lineWidth = 1.5 * dpr;
		for (const r of [CORE_INNER, CORE_OUTER, SEC_OUTER, TERT_OUTER]) {
			ctx.beginPath();
			ctx.arc(cx, cy, R * r, 0, Math.PI * 2);
			ctx.stroke();
		}
	}

	/**
	 * Warp an angle so arcs near the indicator (angle 0) expand and far arcs compress.
	 * f(θ) = θ + A·sin(θ)  — monotonic for A < 1, preserves 0 and 2π.
	 */
	/** Total effective warp strength (zoom slider + drum boost) */
	private get effectiveWarp(): number {
		const base = this.zoomStrength;
		if (this.drum3d === "opacity") return Math.min(base + DRUM_ZOOM_BOOST, 0.95);
		if (this.drum3d === "size") return base; // size mode uses its own warp
		return base;
	}

	// Precomputed size-warp lookup table
	private sizeWarpFwd: number[] = [];
	private sizeWarpRev: number[] = [];
	private rolodexK: number;
	private rolodexFloor: number;
	private rolodexPeak: number;
	private rolodexN: number;
	private rolodexSnap: number;
	private rolodexFontScale: number;
	private rolodexFontCeiling: number;
	private rolodexWeightScale: number;

	/** Build lookup tables for size warp (called once in constructor) */
	private buildSizeWarpTable(): void {
		const N = this.rolodexN;
		const K = this.rolodexK;
		const TWO_PI = Math.PI * 2;
		const dt = TWO_PI / N;

		const FLOOR = this.rolodexFloor;
		const PEAK = this.rolodexPeak;
		const cum: number[] = [0];
		for (let i = 0; i < N; i++) {
			let d = (i + 0.5) * dt; // angle from 0
			if (d > Math.PI) d = TWO_PI - d; // shortest wrap distance
			cum.push(cum[i]! + (FLOOR + PEAK * Math.exp(-K * d * d)) * dt);
		}
		const total = cum[N]!;

		// Forward table: original angle → warped angle
		this.sizeWarpFwd = [];
		for (let i = 0; i <= N; i++) {
			this.sizeWarpFwd.push((cum[i]! / total) * TWO_PI);
		}

		// Inverse table via binary search
		this.sizeWarpRev = [];
		for (let i = 0; i <= N; i++) {
			const target = (i / N) * TWO_PI;
			let lo = 0, hi = N;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (this.sizeWarpFwd[mid]! < target) lo = mid + 1;
				else hi = mid;
			}
			const idx = Math.max(0, lo - 1);
			const a0 = this.sizeWarpFwd[idx]!;
			const a1 = this.sizeWarpFwd[idx + 1]!;
			const t = a1 > a0 ? (target - a0) / (a1 - a0) : 0;
			this.sizeWarpRev.push(((idx + t) / N) * TWO_PI);
		}
	}

	/** Interpolate from a lookup table */
	private tableLookup(table: number[], θ: number): number {
		const TWO_PI = Math.PI * 2;
		const N = this.rolodexN;
		const a = ((θ % TWO_PI) + TWO_PI) % TWO_PI;
		const idx = (a / TWO_PI) * N;
		const i = Math.min(Math.floor(idx), N - 1);
		const t = idx - i;
		return table[i]! + t * (table[i + 1]! - table[i]!) + (θ - a);
	}

	private sizeWarpAngle(θ: number): number {
		return this.tableLookup(this.sizeWarpFwd, θ);
	}

	private sizeUnwarpAngle(warped: number): number {
		return this.tableLookup(this.sizeWarpRev, warped);
	}

	private warpAngle(angle: number): number {
		if (this.drum3d === "size") {
			// Apply zoom warp first, then size warp on top
			const zoomed = this.zoomStrength > 0
				? angle + this.zoomStrength * Math.sin(angle)
				: angle;
			return this.sizeWarpAngle(zoomed);
		}
		const w = this.effectiveWarp;
		if (w === 0) return angle;
		return angle + w * Math.sin(angle);
	}

	private unwarpAngle(warped: number): number {
		if (this.drum3d === "size") {
			const target = this.sizeUnwarpAngle(warped);
			if (this.zoomStrength > 0) {
				// Invert zoom warp: solve x + A*sin(x) = target for x
				let x = target;
				for (let i = 0; i < 8; i++) {
					const f = x + this.zoomStrength * Math.sin(x) - target;
					const fp = 1 + this.zoomStrength * Math.cos(x);
					x -= f / fp;
				}
				return x;
			}
			return target;
		}
		const w = this.effectiveWarp;
		if (w === 0) return warped;
		let θ = warped;
		for (let i = 0; i < 10; i++) {
			const f = θ + w * Math.sin(θ) - warped;
			const fp = 1 + w * Math.cos(θ);
			θ -= f / fp;
		}
		return θ;
	}

	/**
	 * Drum visibility: 1.0 at the indicator (angle 0), rapidly fading using
	 * cos^3 so the effect is visible within the on-screen arc (~±60°).
	 */
	private drumVisibility(displayedAngle: number): number {
		if (this.drum3d === "off") return 1;
		let a = displayedAngle % (Math.PI * 2);
		if (a > Math.PI) a -= Math.PI * 2;
		if (a < -Math.PI) a += Math.PI * 2;
		const c = Math.max(0, Math.cos(a));
		const t = c * c * c; // cos^3 — tight spotlight falloff
		return DRUM_MIN_OPACITY + (1 - DRUM_MIN_OPACITY) * t;
	}

	private drawRing(
		ctx: CanvasRenderingContext2D,
		cx: number, cy: number, R: number,
		rot: number,
		segments: FlatSegment[],
		innerFrac: number, outerFrac: number,
		fontSize: number,
		scaleFont: boolean,
	): void {
		const dpr = this.dpr;
		const innerR = R * innerFrac;
		const outerR = R * outerFrac;
		const ringMidR = (innerR + outerR) / 2;
		const fs = fontSize * dpr;

		for (const seg of segments) {
			const startA = this.warpAngle(seg.startAngle + rot);
			const endA = this.warpAngle(seg.endAngle + rot);
			const midA = (startA + endA) / 2;
			const vis = this.drumVisibility(midA);

			const isOpacity = this.drum3d === "opacity";

			if (isOpacity) ctx.globalAlpha = vis;

			// Draw arc segment — always uniform radii, angular warp handles size
			ctx.beginPath();
			ctx.arc(cx, cy, outerR, startA, endA);
			ctx.arc(cx, cy, innerR, endA, startA, true);
			ctx.closePath();

			if (isOpacity) {
				const br = 0.5 + 0.5 * vis;
				ctx.fillStyle = this.adjustBrightness(seg.color, br);
			} else {
				ctx.fillStyle = seg.color;
			}
			ctx.fill();

			// Highlight overlay
			if (seg.label === this.highlightedLabel && this.highlightAlpha > 0) {
				ctx.fillStyle = `rgba(0,0,0,${this.highlightAlpha})`;
				ctx.fill();
			}

			// Segment border
			ctx.strokeStyle = "rgba(255,255,255,0.25)";
			ctx.lineWidth = 1 * dpr;
			ctx.stroke();

			// Text — at ring midline, optionally scaled by warped arc size in rolodex mode
			const tx = cx + Math.cos(midA) * ringMidR;
			const ty = cy + Math.sin(midA) * ringMidR;

			ctx.save();
			ctx.translate(tx, ty);

			let textAngle = midA;
			const normAngle = ((textAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
			if (normAngle > Math.PI / 2 && normAngle < Math.PI * 1.5) {
				textAngle += Math.PI;
			}
			ctx.rotate(textAngle);

			let scaledFs = fs;
			let weight = 600;
			if (scaleFont && this.drum3d === "size") {
				const origArc = seg.endAngle - seg.startAngle;
				const warpedArc = Math.abs(endA - startA);
				const ratio = warpedArc / origArc;
				if (this.rolodexFontScale > 0) {
					scaledFs = fs * (1 + (ratio - 1) * this.rolodexFontScale * this.rolodexFontCeiling);
					scaledFs = Math.max(scaledFs, fs * 0.3);
					scaledFs = Math.round(scaledFs);
				}
				if (this.rolodexWeightScale > 0) {
					// Interpolate weight: ratio < 1 → lighter (300), ratio > 1 → bolder (900)
					const t = Math.max(0, Math.min(1, (ratio - 0.3) / (3 - 0.3)));
					weight = Math.round(300 + (900 - 300) * t * this.rolodexWeightScale + 600 * (1 - this.rolodexWeightScale));
					weight = Math.round(weight / 100) * 100; // quantize to 100s
				}
			}
			ctx.font = `${weight} ${scaledFs}px -apple-system, BlinkMacSystemFont, sans-serif`;
			// letterSpacing is supported in modern browsers but not in the TS Canvas types yet
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(ctx as any).letterSpacing = `${0.3 * dpr}px`;
			ctx.fillStyle = "#ffffff";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
			ctx.shadowBlur = 3 * dpr;
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
			ctx.fillText(seg.label, 0, 0);
			ctx.shadowColor = "transparent";

			ctx.restore();
			if (isOpacity) ctx.globalAlpha = 1;
		}
	}

	/** Adjust a hex color's brightness (0 = black, 1 = original) */
	private adjustBrightness(hex: string, factor: number): string {
		const r = Math.min(255, Math.round(parseInt(hex.slice(1, 3), 16) * factor));
		const g = Math.min(255, Math.round(parseInt(hex.slice(3, 5), 16) * factor));
		const b = Math.min(255, Math.round(parseInt(hex.slice(5, 7), 16) * factor));
		return `rgb(${r},${g},${b})`;
	}

	/** Quick dark flash that fades out in ~150ms */
	flashEmotion(label: string): void {
		this.highlightedLabel = label;
		this.highlightAlpha = 0.5;
		const fade = () => {
			this.highlightAlpha -= 0.05;
			if (this.highlightAlpha <= 0) {
				this.highlightAlpha = 0;
				this.highlightedLabel = null;
				this.draw();
				return;
			}
			this.draw();
			requestAnimationFrame(fade);
		};
		this.draw();
		requestAnimationFrame(fade);
	}

	/** Angle of a pointer event relative to the wheel center */
	private pointerAngle(e: PointerEvent): number {
		const rect = this.canvas.getBoundingClientRect();
		const dx = e.clientX - rect.left - this.centerX;
		const dy = e.clientY - rect.top - this.centerY;
		return Math.atan2(dy, dx);
	}

	private onPointerDown(e: PointerEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.isDragging = true;
		this.velocity = 0;
		this.totalDragDist = 0;
		this.lastPointerAngle = this.pointerAngle(e);
		this.lastPointerY = e.clientY;
		this.lastPointerTime = performance.now();
		this.canvas.setPointerCapture(e.pointerId);

		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.isDragging) return;
		e.preventDefault();
		e.stopPropagation();

		const now = performance.now();
		const angle = this.pointerAngle(e);
		let deltaAngle = angle - this.lastPointerAngle;
		// Unwrap across ±π boundary
		if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
		if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
		const dt = Math.max(now - this.lastPointerTime, 1);

		this.angle += deltaAngle;
		this.totalDragDist += Math.abs(e.clientY - this.lastPointerY);
		this.velocity = deltaAngle / (dt / 16.67);
		this.lastPointerAngle = angle;
		this.lastPointerY = e.clientY;
		this.lastPointerTime = now;

		this.draw();
	}

	private onPointerUp(e: PointerEvent): void {
		if (!this.isDragging) return;
		this.isDragging = false;

		// Tap detection — generous threshold for touch screens
		if (this.totalDragDist < 20) {
			const emotion = this.hitTest(e.clientX, e.clientY);
			if (emotion) {
				this.flashEmotion(emotion);
				this.onTapEmotion(emotion);
				return;
			}
			// Tapped empty canvas area (corners, outside rings)
			this.onTapEmpty?.();
			return;
		}

		// Light inertia — short coast then stop
		if (Math.abs(this.velocity) > MIN_VELOCITY) {
			this.startMomentum();
		}
	}

	private startMomentum(): void {
		const loop = () => {
			if (this.isDragging) return;
			this.velocity *= this.physics.friction;

			// As velocity drops, gently steer toward the nearest segment center
			const speed = Math.abs(this.velocity);
			if (speed < SNAP_THRESHOLD) {
				const correction = this.getCenterCorrection();
				const strength = 1 - (speed / SNAP_THRESHOLD);
				const snapForce = this.drum3d === "size" ? this.rolodexSnap : this.physics.snap;
				this.velocity += correction * snapForce * strength;
			}

			this.angle += this.velocity;
			this.draw();

			if (Math.abs(this.velocity) > MIN_VELOCITY) {
				this.animFrameId = requestAnimationFrame(loop);
			} else {
				this.velocity = 0;
				this.animFrameId = null;
			}
		};
		this.animFrameId = requestAnimationFrame(loop);
	}

	/** Get a small angular correction to nudge toward the nearest segment center */
	private getCenterCorrection(): number {
		let indicatorAngle = ((-this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

		for (const seg of this.tertSegments) {
			if (indicatorAngle >= seg.startAngle && indicatorAngle < seg.endAngle) {
				const segCenter = (seg.startAngle + seg.endAngle) / 2;
				let delta = segCenter - indicatorAngle;
				if (delta > Math.PI) delta -= Math.PI * 2;
				if (delta < -Math.PI) delta += Math.PI * 2;
				return -delta;
			}
		}
		return 0;
	}

	private hitTest(clientX: number, clientY: number): string | null {
		const rect = this.canvas.getBoundingClientRect();
		const localX = clientX - rect.left;
		const localY = clientY - rect.top;

		const dx = localX - this.centerX;
		const dy = localY - this.centerY;
		const dist = Math.sqrt(dx * dx + dy * dy);

		// The visual angle on screen; unwarp to get back to original segment space
		const visualAngle = Math.atan2(dy, dx);
		const unwarpedVisual = this.unwarpAngle(visualAngle);
		let hitAngle = unwarpedVisual - this.angle;
		hitAngle = ((hitAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

		const distFrac = dist / this.radius;
		let segments: FlatSegment[];
		if (distFrac >= TERT_INNER && distFrac <= TERT_OUTER) {
			segments = this.tertSegments;
		} else if (distFrac >= SEC_INNER && distFrac < TERT_INNER) {
			segments = this.secSegments;
		} else if (distFrac >= CORE_INNER && distFrac < SEC_INNER) {
			segments = this.coreSegments;
		} else {
			return null;
		}

		for (const seg of segments) {
			if (hitAngle >= seg.startAngle && hitAngle < seg.endAngle) {
				return seg.label;
			}
		}
		return null;
	}

	getPointedEmotion(): string {
		let indicatorAngle = ((-this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
		for (const seg of this.tertSegments) {
			if (indicatorAngle >= seg.startAngle && indicatorAngle < seg.endAngle) {
				return seg.label;
			}
		}
		return "";
	}

	getPointedColor(): string {
		let indicatorAngle = ((-this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
		for (const seg of this.coreSegments) {
			if (indicatorAngle >= seg.startAngle && indicatorAngle < seg.endAngle) {
				return seg.color;
			}
		}
		return "#888";
	}

	getVisibleEdgeX(): number {
		return this.centerX + this.radius * TERT_OUTER;
	}

	destroy(): void {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
		}
		this.canvas.removeEventListener("pointerdown", this.boundPointerDown);
		window.removeEventListener("pointermove", this.boundPointerMove);
		window.removeEventListener("pointerup", this.boundPointerUp);
		this.canvas.remove();
	}
}
