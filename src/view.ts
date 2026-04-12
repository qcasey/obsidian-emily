import {ItemView, WorkspaceLeaf, debounce} from "obsidian";
import type EmilyPlugin from "./main";
import type {DateRange, ResolvedTopic, TrackingEntry} from "./types";
import {DataService} from "./data-service";
import {renderTimeline} from "./chart/timeline";
import {renderStats} from "./chart/stats";
import {renderCorrelation} from "./chart/correlation";
import {renderHeatmap} from "./chart/heatmap";
import {renderTimeOfDay} from "./chart/timeofday";
import {getTheme} from "./chart/theme";

export const VIEW_TYPE_EMILY = "emily-tracker";

export class TrackingView extends ItemView {
	private plugin: EmilyPlugin;
	private dataService: DataService;
	private topics: ResolvedTopic[] = [];
	private enabledTopics: Set<string> = new Set();
	private typeOverrides: Map<string, "range" | "spike" | "spike_full"> = new Map();
	private aggOverrides: Map<string, "none" | "sum" | "average"> = new Map();
	private sectionToggles = {correlation: true, heatmap: true, timeOfDay: true};
	private dateRange: DateRange;
	private resizeObserver: ResizeObserver | null = null;

	// DOM elements
	private toolbarEl: HTMLElement;
	private chartEl: HTMLElement;
	private correlationEl: HTMLElement;
	private heatmapEl: HTMLElement;
	private timeOfDayEl: HTMLElement;
	private statsEl: HTMLElement;
	private legendEl: HTMLElement;
	private tooltipEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: EmilyPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.dataService = new DataService(this.app, plugin.settings);

		const now = new Date();
		const start = new Date(now);
		start.setDate(start.getDate() - (plugin.settings.defaultDateRangeDays - 1));
		start.setHours(0, 0, 0, 0);
		const end = new Date(now);
		end.setHours(23, 59, 59, 999);
		this.dateRange = {start, end};
	}

	getViewType(): string {
		return VIEW_TYPE_EMILY;
	}

	getDisplayText(): string {
		return "Emily";
	}

	getIcon(): string {
		return "line-chart";
	}

	async onOpen(): Promise<void> {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("emily-view");

		// Toolbar
		this.toolbarEl = contentEl.createEl("div", {cls: "emily-toolbar"});
		this.buildToolbar();

		// Legend
		this.legendEl = contentEl.createEl("div", {cls: "emily-legend"});

		// Chart
		this.chartEl = contentEl.createEl("div", {cls: "emily-chart"});

		// Additional visualizations
		this.correlationEl = contentEl.createEl("div", {cls: "emily-correlation"});
		this.heatmapEl = contentEl.createEl("div", {cls: "emily-heatmap"});
		this.timeOfDayEl = contentEl.createEl("div", {cls: "emily-timeofday"});

		// Stats
		this.statsEl = contentEl.createEl("div", {cls: "emily-stats"});

		// Tooltip (absolute positioned)
		this.tooltipEl = contentEl.createEl("div", {cls: "emily-tooltip"});
		this.tooltipEl.style.display = "none";

		// Responsive resize
		this.resizeObserver = new ResizeObserver(
			debounce(() => this.render(), 200, true)
		);
		this.resizeObserver.observe(this.chartEl);

		// Listen for vault changes
		this.registerEvent(
			this.app.vault.on("modify", debounce(() => this.refresh(), 500, true))
		);

		this.registerEvent(
			this.app.workspace.on("css-change", () => this.render())
		);

		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
	}

	private buildToolbar(): void {
		this.toolbarEl.empty();

		const presets = this.toolbarEl.createEl("div", {cls: "emily-presets"});
		for (const days of [1, 7, 14, 30, 90]) {
			const btn = presets.createEl("button", {
				cls: "emily-preset-btn",
				text: `${days}d`,
			});
			if (this.getDaySpan() === days) {
				btn.addClass("emily-preset-active");
			}
			btn.addEventListener("click", () => this.setRange(days));
		}

		// Desktop: date inputs
		const custom = this.toolbarEl.createEl("div", {cls: "emily-date-inputs"});

		const startInput = custom.createEl("input", {type: "date"});
		startInput.value = this.formatDateInput(this.dateRange.start);
		startInput.addEventListener("change", () => {
			this.dateRange.start = new Date(startInput.value + "T00:00:00");
			this.refresh();
		});

		custom.createEl("span", {cls: "emily-date-sep", text: "to"});

		const endInput = custom.createEl("input", {type: "date"});
		endInput.value = this.formatDateInput(this.dateRange.end);
		endInput.addEventListener("change", () => {
			this.dateRange.end = new Date(endInput.value + "T23:59:59");
			this.refresh();
		});

		// Section toggles
		const sections = this.toolbarEl.createEl("div", {cls: "emily-section-toggles"});
		for (const [key, label] of [["correlation", "Corr"], ["heatmap", "Heat"], ["timeOfDay", "Time"]] as const) {
			const btn = sections.createEl("button", {
				cls: "emily-preset-btn",
				text: label,
			});
			if (this.sectionToggles[key]) btn.addClass("emily-preset-active");
			btn.addEventListener("click", () => {
				this.sectionToggles[key] = !this.sectionToggles[key];
				this.buildToolbar();
				this.render();
			});
		}

		// Mobile: preset dropdown (replaces buttons)
		const mobilePresets = this.toolbarEl.createEl("div", {cls: "emily-preset-dropdown"});
		const presetSelect = mobilePresets.createEl("select");
		for (const days of [1, 7, 14, 30, 90]) {
			const opt = presetSelect.createEl("option", {value: String(days), text: `${days}d`});
			if (this.getDaySpan() === days) opt.selected = true;
		}
		presetSelect.addEventListener("change", () => {
			this.setRange(parseInt(presetSelect.value, 10));
		});
	}

	private buildLegend(): void {
		this.legendEl.empty();

		// Toggle all button
		const allEnabled = this.topics.every(t => this.enabledTopics.has(t.name));
		const toggleAll = this.legendEl.createEl("button", {
			cls: "emily-legend-item emily-toggle-all",
			text: allEnabled ? "None" : "All",
		});
		toggleAll.addEventListener("click", () => {
			if (allEnabled) {
				this.enabledTopics.clear();
			} else {
				this.enabledTopics = new Set(this.topics.map(t => t.name));
			}
			this.buildLegend();
			this.render();
		});

		// Group toggle buttons
		const groups = new Set(this.topics.map(t => t.config.group).filter(g => g));
		for (const group of groups) {
			const groupTopics = this.topics.filter(t => t.config.group === group);
			const allGroupEnabled = groupTopics.every(t => this.enabledTopics.has(t.name));
			const groupBtn = this.legendEl.createEl("button", {
				cls: "emily-legend-item emily-toggle-group",
				text: group,
			});
			if (!allGroupEnabled) groupBtn.addClass("emily-legend-disabled");
			groupBtn.addEventListener("click", () => {
				for (const t of groupTopics) {
					if (allGroupEnabled) {
						this.enabledTopics.delete(t.name);
					} else {
						this.enabledTopics.add(t.name);
					}
				}
				this.buildLegend();
				this.render();
			});
		}

		for (const topic of this.topics) {
			const item = this.legendEl.createEl("button", {cls: "emily-legend-item"});
			if (!this.enabledTopics.has(topic.name)) {
				item.addClass("emily-legend-disabled");
			}

			const dot = item.createEl("span", {cls: "emily-legend-dot"});
			dot.style.backgroundColor = topic.config.color;

			item.createEl("span", {text: topic.name});

			item.addEventListener("click", () => {
				if (this.enabledTopics.has(topic.name)) {
					this.enabledTopics.delete(topic.name);
				} else {
					this.enabledTopics.add(topic.name);
				}
				this.buildLegend();
				this.render();
			});
		}
	}

	private hasInitialized = false;

	private async refresh(): Promise<void> {
		this.topics = await this.dataService.loadData(this.dateRange);

		if (!this.hasInitialized) {
			// First load: only enable topics with tracking_visible_default: true
			this.enabledTopics = new Set(
				this.topics.filter(t => t.config.visibleDefault).map(t => t.name)
			);
			this.hasInitialized = true;
		}

		this.buildToolbar();
		this.buildLegend();
		this.render();
	}

	private getDisplayTopics(): ResolvedTopic[] {
		return this.topics.map(t => {
			const typeOvr = this.typeOverrides.get(t.name);
			const aggOvr = this.aggOverrides.get(t.name);
			if (typeOvr || aggOvr) {
				return {...t, config: {
					...t.config,
					...(typeOvr ? {displayType: typeOvr} : {}),
					...(aggOvr ? {aggregate: aggOvr} : {}),
				}};
			}
			return t;
		});
	}

	private render(): void {
		const theme = getTheme(this.contentEl);
		const displayTopics = this.getDisplayTopics();

		renderTimeline(this.chartEl, {
			topics: displayTopics,
			enabledTopics: this.enabledTopics,
			theme,
			onHover: (entry, x, y) => this.showTooltip(entry, x, y),
			onClick: (entry) => this.openSource(entry),
		});

		const textHover = (text: string | null, x: number, y: number) => this.showTextTooltip(text, x, y);

		if (this.sectionToggles.correlation) {
			renderCorrelation(this.correlationEl, {
				topics: displayTopics,
				enabledTopics: this.enabledTopics,
				theme,
				onHover: textHover,
			});
		} else {
			this.correlationEl.empty();
		}

		if (this.sectionToggles.heatmap) {
			renderHeatmap(this.heatmapEl, {
				topics: displayTopics,
				enabledTopics: this.enabledTopics,
				range: this.dateRange,
				theme,
				onHover: textHover,
			});
		} else {
			this.heatmapEl.empty();
		}

		if (this.sectionToggles.timeOfDay) {
			renderTimeOfDay(this.timeOfDayEl, {
				topics: displayTopics,
				enabledTopics: this.enabledTopics,
				theme,
				onHover: textHover,
			});
		} else {
			this.timeOfDayEl.empty();
		}

		renderStats(this.statsEl, {
			topics: displayTopics,
			enabledTopics: this.enabledTopics,
			range: this.dateRange,
			theme,
			onDisplayTypeChange: (name, type) => {
				this.typeOverrides.set(name, type);
				this.render();
			},
			onAggregateChange: (name, mode) => {
				this.aggOverrides.set(name, mode);
				this.render();
			},
		});
	}

	private showTooltip(entry: TrackingEntry | null, x: number, y: number): void {
		if (!entry) {
			this.tooltipEl.style.display = "none";
			return;
		}

		const topic = this.getDisplayTopics().find(t => t.name === entry.topic);
		const color = topic?.config.color ?? "#888";

		this.tooltipEl.empty();
		this.tooltipEl.style.display = "block";

		const header = this.tooltipEl.createEl("div", {cls: "emily-tooltip-header"});
		const dot = header.createEl("span", {cls: "emily-tooltip-dot"});
		dot.style.backgroundColor = color;
		const unit = topic?.config.unit ? ` ${topic.config.unit}` : "";
		header.createEl("strong", {text: `${entry.topic}: ${entry.value}${unit}`});

		this.tooltipEl.createEl("div", {
			cls: "emily-tooltip-time",
			text: `${entry.time} \u2014 ${entry.date}`,
		});

		if (entry.narration) {
			this.tooltipEl.createEl("div", {
				cls: "emily-tooltip-narration",
				text: entry.narration,
			});
		}

		// Position relative to the view container
		const viewRect = this.contentEl.getBoundingClientRect();
		let left = x - viewRect.left + 10;
		let top = y - viewRect.top - 10;

		// Keep tooltip in bounds
		const tipWidth = 220;
		if (left + tipWidth > viewRect.width) {
			left = left - tipWidth - 20;
		}
		if (top < 0) top = 10;

		this.tooltipEl.style.left = `${left}px`;
		this.tooltipEl.style.top = `${top}px`;
	}

	private showTextTooltip(text: string | null, x: number, y: number): void {
		if (!text) {
			this.tooltipEl.style.display = "none";
			return;
		}

		this.tooltipEl.empty();
		this.tooltipEl.style.display = "block";

		for (const line of text.split("\n")) {
			this.tooltipEl.createEl("div", {text: line});
		}

		const viewRect = this.contentEl.getBoundingClientRect();
		let left = x - viewRect.left + 10;
		let top = y - viewRect.top - 10;

		const tipWidth = 220;
		if (left + tipWidth > viewRect.width) left = left - tipWidth - 20;
		if (top < 0) top = 10;

		this.tooltipEl.style.left = `${left}px`;
		this.tooltipEl.style.top = `${top}px`;
	}

	private openSource(entry: TrackingEntry): void {
		const file = this.app.vault.getAbstractFileByPath(entry.sourceFile);
		if (file) {
			this.app.workspace.getLeaf("tab").openFile(file as any);
		}
	}

	public exportCsv(): void {
		const displayTopics = this.getDisplayTopics();
		const visible = displayTopics.filter(t => this.enabledTopics.has(t.name));
		const allEntries = visible.flatMap(t =>
			t.entries.map(e => ({...e, unit: t.config.unit}))
		).sort((a, b) => a.timestamp - b.timestamp);

		const header = "date,time,topic,value,unit,narration";
		const rows = allEntries.map(e => {
			const narration = e.narration.replace(/"/g, '""');
			return `${e.date},${e.time},${e.topic},${e.value},${e.unit},"${narration}"`;
		});
		const csv = [header, ...rows].join("\n");

		const blob = new Blob([csv], {type: "text/csv"});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `emily-${this.formatDateInput(this.dateRange.start)}-to-${this.formatDateInput(this.dateRange.end)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	private setRange(days: number): void {
		const now = new Date();
		const start = new Date(now);
		start.setDate(start.getDate() - (days - 1));
		start.setHours(0, 0, 0, 0);
		const end = new Date(now);
		end.setHours(23, 59, 59, 999);
		this.dateRange = {start, end};
		this.refresh();
	}

	private getDaySpan(): number {
		const ms = this.dateRange.end.getTime() - this.dateRange.start.getTime();
		return Math.round(ms / 86400000) || 1;
	}

	private formatDateInput(date: Date): string {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}
}
