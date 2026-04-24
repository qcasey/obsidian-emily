/**
 * Feelings wheel renderer — inspired by https://feelingswheel.com
 * Based on the Gloria Willcox feelings wheel.
 */
import {buildFlatSegments, type FlatSegment} from "./feelings-data";

const SENSITIVITY = 0.003;
const FRICTION = 0.92;
const MIN_VELOCITY = 0.0002;
const MAX_VELOCITY = 0.035;

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
	private lastPointerY = 0;
	private lastPointerTime = 0;
	private totalDragDist = 0;
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

	constructor(
		private container: HTMLElement,
		private onTapEmotion: (emotion: string) => void,
	) {
		const segments = buildFlatSegments();
		this.coreSegments = segments.core;
		this.secSegments = segments.secondary;
		this.tertSegments = segments.tertiary;

		this.canvas = document.createElement("canvas");
		this.canvas.className = "emily-feelings-canvas";
		this.container.appendChild(this.canvas);

		this.ctx = this.canvas.getContext("2d")!;

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
		const targetVisibleWidth = Math.min(w * 0.65, this.radius * 0.75);
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

		this.drawRing(ctx, cx, cy, R, rot, this.coreSegments, CORE_INNER, CORE_OUTER, 18);
		this.drawRing(ctx, cx, cy, R, rot, this.secSegments, SEC_INNER, SEC_OUTER, 15);
		this.drawRing(ctx, cx, cy, R, rot, this.tertSegments, TERT_INNER, TERT_OUTER, 14);

		// Ring border circles
		ctx.strokeStyle = "rgba(255,255,255,0.35)";
		ctx.lineWidth = 1.5 * dpr;
		for (const r of [CORE_INNER, CORE_OUTER, SEC_OUTER, TERT_OUTER]) {
			ctx.beginPath();
			ctx.arc(cx, cy, R * r, 0, Math.PI * 2);
			ctx.stroke();
		}
	}

	private drawRing(
		ctx: CanvasRenderingContext2D,
		cx: number, cy: number, R: number,
		rot: number,
		segments: FlatSegment[],
		innerFrac: number, outerFrac: number,
		fontSize: number,
	): void {
		const dpr = this.dpr;
		const innerR = R * innerFrac;
		const outerR = R * outerFrac;
		const midR = (innerR + outerR) / 2;
		const fs = fontSize * dpr;

		ctx.font = `bold ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`;

		for (const seg of segments) {
			const startA = seg.startAngle + rot;
			const endA = seg.endAngle + rot;

			// Draw arc segment
			ctx.beginPath();
			ctx.arc(cx, cy, outerR, startA, endA);
			ctx.arc(cx, cy, innerR, endA, startA, true);
			ctx.closePath();

			ctx.fillStyle = seg.color;
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

			// Text — uniform size, always drawn (clipped naturally by canvas bounds)
			const midAngle = (startA + endA) / 2;
			const tx = cx + Math.cos(midAngle) * midR;
			const ty = cy + Math.sin(midAngle) * midR;

			ctx.save();
			ctx.translate(tx, ty);

			let textAngle = midAngle;
			const normAngle = ((textAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
			if (normAngle > Math.PI / 2 && normAngle < Math.PI * 1.5) {
				textAngle += Math.PI;
			}
			ctx.rotate(textAngle);

			ctx.font = `bold ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`;
			ctx.fillStyle = "#1a1a1a";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(seg.label, 0, 0);

			ctx.restore();
		}
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

	private onPointerDown(e: PointerEvent): void {
		e.preventDefault();
		e.stopPropagation();
		this.isDragging = true;
		this.velocity = 0;
		this.totalDragDist = 0;
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
		const deltaY = e.clientY - this.lastPointerY;
		const deltaAngle = deltaY * SENSITIVITY;
		const dt = Math.max(now - this.lastPointerTime, 1);

		this.angle += deltaAngle;
		this.totalDragDist += Math.abs(deltaY);
		this.velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, deltaAngle / (dt / 16.67)));
		this.lastPointerY = e.clientY;
		this.lastPointerTime = now;

		this.draw();
	}

	private onPointerUp(e: PointerEvent): void {
		if (!this.isDragging) return;
		this.isDragging = false;

		// Tap detection
		if (this.totalDragDist < 6) {
			const emotion = this.hitTest(e.clientX, e.clientY);
			if (emotion) {
				this.flashEmotion(emotion);
				this.onTapEmotion(emotion);
				return;
			}
		}

		// Light inertia — short coast then stop
		if (Math.abs(this.velocity) > MIN_VELOCITY) {
			this.startMomentum();
		}
	}

	private startMomentum(): void {
		const loop = () => {
			if (this.isDragging) return;
			this.velocity *= FRICTION;

			// As velocity drops, gently steer toward the nearest segment center
			const speed = Math.abs(this.velocity);
			if (speed < MAX_VELOCITY * 0.5) {
				const correction = this.getCenterCorrection();
				// Blend in more correction as speed decreases
				const strength = 1 - (speed / (MAX_VELOCITY * 0.5));
				this.velocity += correction * 0.08 * strength;
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

		let hitAngle = Math.atan2(dy, dx) - this.angle;
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
