import {type Editor, setIcon} from "obsidian";
import {FeelingsWheel} from "./feelings-wheel";
import {buildFlatSegments} from "./feelings-data";

export class FeelingsOverlay {
	private backdrop: HTMLElement;
	private wheel: FeelingsWheel;
	private indicator: HTMLElement;
	private pendingEmotions: string[] = [];
	private emotionColors: Map<string, string> = new Map();
	private pendingListEl: HTMLElement;
	private doneBtn: HTMLElement;
	private sidebar: HTMLElement;

	constructor(
		private editor: Editor,
		private onDone: (emotions: string[]) => void,
		private onCancel: () => void,
		private zoomPercent = 50,
		private drum3d: "off" | "opacity" | "size" = "off",
		private rolodex = {k: 60, floor: 0.1, peak: 300, resolution: 1024, snap: 0.02, sensitivity: 0.0015},
		private physics = {snap: 0.08, friction: 0.92, maxSpeed: 0.035, reach: 0.95, sensitivity: 0.003},
		private onOpenSettings?: () => void,
	) {
		// Build color lookup
		const segments = buildFlatSegments();
		for (const seg of [...segments.core, ...segments.secondary, ...segments.tertiary]) {
			this.emotionColors.set(seg.label, seg.color);
		}

		// Full-viewport backdrop — everything is a child of this
		this.backdrop = document.createElement("div");
		this.backdrop.className = "emily-feelings-backdrop";
		this.backdrop.addEventListener("pointerdown", (e) => {
			const target = e.target as HTMLElement;
			// Close when tapping the backdrop or non-interactive overlays (indicator, close btn area)
			if (target === this.backdrop || target === this.indicator) {
				e.preventDefault();
				this.close();
			}
		});

		// Settings cog
		if (this.onOpenSettings) {
			const settingsBtn = document.createElement("button");
			settingsBtn.className = "emily-feelings-settings";
			setIcon(settingsBtn, "settings");
			settingsBtn.addEventListener("click", () => {
				this.onOpenSettings!();
				this.close();
			});
			this.backdrop.appendChild(settingsBtn);
		}

		// Indicator arrow
		this.indicator = document.createElement("div");
		this.indicator.className = "emily-feelings-indicator";
		this.backdrop.appendChild(this.indicator);

		// Sidebar — bottom center, floating
		this.sidebar = document.createElement("div");
		this.sidebar.className = "emily-feelings-sidebar";
		this.backdrop.appendChild(this.sidebar);

		// Pending list — above the bottom row so no layout shift
		this.pendingListEl = document.createElement("div");
		this.pendingListEl.className = "emily-feelings-pending";
		this.sidebar.appendChild(this.pendingListEl);

		this.doneBtn = document.createElement("button");
		this.doneBtn.className = "emily-feelings-done";
		this.doneBtn.textContent = "Done";
		this.doneBtn.addEventListener("click", () => {
			if (this.pendingEmotions.length > 0) {
				this.onDone(this.pendingEmotions);
			}
			this.remove();
		});
		this.sidebar.appendChild(this.doneBtn);

		// Create wheel — renders directly into the backdrop
		this.wheel = new FeelingsWheel(this.backdrop, (emotion) => {
			this.addEmotion(emotion);
		}, this.zoomPercent, this.drum3d, this.rolodex, this.physics, () => {
			this.close();
		});

		// Position arrow at the wheel's right edge
		this.positionElements();
		window.addEventListener("resize", this.boundResize = () => {
			this.wheel.resize();
			this.positionElements();
		});

	}

	private boundResize: () => void;

	private positionElements(): void {
		const edgeX = this.wheel.getVisibleEdgeX();
		// Arrow sits at the wheel's right edge, vertically centered
		this.indicator.style.left = `${edgeX - 12}px`; // 12 = arrow width, so tip touches edge
	}

	private addEmotion(emotion: string): void {
		if (this.pendingEmotions.includes(emotion)) return;
		this.pendingEmotions.push(emotion);
		this.renderPending();
		this.updateDoneColor();
	}

	private removeEmotion(emotion: string): void {
		this.pendingEmotions = this.pendingEmotions.filter((e) => e !== emotion);
		this.renderPending();
		this.updateDoneColor();
	}

	private updateDoneColor(): void {
		if (this.pendingEmotions.length === 0) {
			this.doneBtn.style.setProperty("background", "rgba(255, 255, 255, 0.2)", "important");
			this.doneBtn.style.setProperty("color", "rgba(255, 255, 255, 0.8)", "important");
			this.doneBtn.textContent = "Done";
			return;
		}
		this.doneBtn.textContent = "Insert";
		this.doneBtn.style.setProperty("color", "#fff", "important");

		let rSum = 0, gSum = 0, bSum = 0;
		for (const emotion of this.pendingEmotions) {
			const hex = this.emotionColors.get(emotion) || "#888888";
			rSum += parseInt(hex.slice(1, 3), 16);
			gSum += parseInt(hex.slice(3, 5), 16);
			bSum += parseInt(hex.slice(5, 7), 16);
		}
		const n = this.pendingEmotions.length;
		const r = Math.round(rSum / n * 0.75);
		const g = Math.round(gSum / n * 0.75);
		const b = Math.round(bSum / n * 0.75);
		this.doneBtn.style.setProperty("background", `rgb(${r}, ${g}, ${b})`, "important");
	}

	private renderPending(): void {
		this.pendingListEl.empty();
		for (const emotion of this.pendingEmotions) {
			const chip = document.createElement("span");
			chip.className = "emily-feelings-chip";

			// Color chip with the emotion's color (darkened for readability)
			const hex = this.emotionColors.get(emotion) || "#888888";
			const r = Math.round(parseInt(hex.slice(1, 3), 16) * 0.7);
			const g = Math.round(parseInt(hex.slice(3, 5), 16) * 0.7);
			const b = Math.round(parseInt(hex.slice(5, 7), 16) * 0.7);
			chip.style.background = `rgb(${r}, ${g}, ${b})`;

			chip.textContent = emotion + " \u00d7";
			chip.addEventListener("click", () => {
				this.removeEmotion(emotion);
			});
			this.pendingListEl.appendChild(chip);
		}
	}

	open(): void {
		// Dismiss mobile keyboard
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}

		document.body.appendChild(this.backdrop);

		// Resize after DOM insertion so container has dimensions
		requestAnimationFrame(() => {
			this.wheel.resize();
			this.positionElements();
			this.backdrop.classList.add("emily-feelings-visible");
			this.sidebar.classList.add("emily-feelings-open");
		});
	}

	private close(): void {
		this.onCancel();
		this.sidebar.classList.remove("emily-feelings-open");
		this.backdrop.classList.remove("emily-feelings-visible");

		setTimeout(() => this.remove(), 300);
	}

	private removed = false;
	private remove(): void {
		if (this.removed) return;
		this.removed = true;
		window.removeEventListener("resize", this.boundResize);
		this.wheel.destroy();
		this.backdrop.remove();
	}
}
