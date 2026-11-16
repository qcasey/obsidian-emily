import {ItemView, WorkspaceLeaf, debounce} from "obsidian";
import type EmilyPlugin from "./main";
import type {AggregateMode, DateRange, DisplayType, ResolvedTopic, TrackingEntry} from "./types";
import {DataService} from "./data-service";
import {renderTimeline} from "./chart/timeline";
import {renderStats} from "./chart/stats";
import {renderCorrelation} from "./chart/correlation";
import {renderHeatmap} from "./chart/heatmap";
import {renderTimeOfDay} from "./chart/timeofday";
import {getTheme} from "./chart/theme";
import {endOfDay, formatDateKey, isUsableDateKey, rangeForDays, restoreRange, serializeRange, startOfDay} from "./chart-state";

export const VIEW_TYPE_EMILY = "emily-tracker";

const PRESET_DAYS = [1, 7, 14, 30, 90, 365];
const UNGROUPED = "Other";

function presetLabel(days: number): string {
	return days === 365 ? "1y" : `${days}d`;
}

type SectionKey = "correlation" | "heatmap" | "timeOfDay";

export class TrackingView extends ItemView {
	private plugin: EmilyPlugin;
	private dataService: DataService;
	private topics: ResolvedTopic[] = [];
	private enabledTopics: Set<string> = new Set();
	private typeOverrides: Map<string, DisplayType> = new Map();
	private aggOverrides: Map<string, AggregateMode> = new Map();
	private sectionToggles: Record<SectionKey, boolean> = {correlation: true, heatmap: true, timeOfDay: true};
	private dateRange: DateRange;
	/** The rolling "last N days" preset in use, or null for hand-picked dates. */
	private presetDays: number | null;
	private persist = debounce(() => this.saveState(), 500, true);
	private resizeObserver: ResizeObserver | null = null;

	// DOM elements
	private toolbarEl: HTMLElement;
	private startInput: HTMLInputElement;
	private endInput: HTMLInputElement;
	private dateInputsEl: HTMLElement;
	private presetBtns: Map<number, HTMLElement> = new Map();
	private sectionBtns: Map<SectionKey, HTMLElement> = new Map();
	private chartEl: HTMLElement;
	private correlationEl: HTMLElement;
	private heatmapEl: HTMLElement;
	private timeOfDayEl: HTMLElement;
	private statsEl: HTMLElement;
	private legendEl: HTMLElement;
	private tooltipEl: HTMLElement;
	private tooltipHideTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: EmilyPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.dataService = new DataService(this.app, plugin.settings);

		// Reopen with whatever was showing last time
		const saved = plugin.settings.chartState;
		const restored = restoreRange(saved, plugin.settings.defaultDateRangeDays);
		this.dateRange = restored.range;
		this.presetDays = restored.presetDays;
		if (saved) {
			this.enabledTopics = new Set(saved.enabledTopics ?? []);
			this.sectionToggles = {...this.sectionToggles, ...saved.sections};
			this.typeOverrides = new Map(Object.entries(saved.typeOverrides ?? {}));
			this.aggOverrides = new Map(Object.entries(saved.aggOverrides ?? {}));
			this.hasInitialized = true;
		}
	}

	private saveState(): void {
		this.plugin.settings.chartState = {
			...serializeRange(this.dateRange, this.presetDays),
			enabledTopics: [...this.enabledTopics].sort(),
			sections: {...this.sectionToggles},
			typeOverrides: Object.fromEntries(this.typeOverrides),
			aggOverrides: Object.fromEntries(this.aggOverrides),
		};
		void this.plugin.saveSettings();
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

		// Stats
		this.statsEl = contentEl.createEl("div", {cls: "emily-stats"});

		// Additional visualizations
		this.correlationEl = contentEl.createEl("div", {cls: "emily-correlation"});
		this.heatmapEl = contentEl.createEl("div", {cls: "emily-heatmap"});
		this.timeOfDayEl = contentEl.createEl("div", {cls: "emily-timeofday"});

		// Tooltip (absolute positioned)
		this.tooltipEl = contentEl.createEl("div", {cls: "emily-tooltip"});
		this.tooltipEl.style.display = "none";
		this.tooltipEl.addEventListener("mouseenter", () => {
			if (this.tooltipHideTimeout) {
				clearTimeout(this.tooltipHideTimeout);
				this.tooltipHideTimeout = null;
			}
		});
		this.tooltipEl.addEventListener("mouseleave", () => {
			this.scheduleHideTooltip();
		});

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
		this.persist.run();
	}

	/** Built once: rebuilding it would throw away a date input that is being typed into. */
	private buildToolbar(): void {
		this.toolbarEl.empty();
		this.presetBtns.clear();
		this.sectionBtns.clear();

		const presets = this.toolbarEl.createEl("div", {cls: "emily-presets"});
		for (const days of PRESET_DAYS) {
			const btn = presets.createEl("button", {
				cls: "emily-preset-btn",
				text: presetLabel(days),
			});
			btn.addEventListener("click", () => this.setRange(days));
			this.presetBtns.set(days, btn);
		}

		// Hand-picked dates
		const custom = this.dateInputsEl = this.toolbarEl.createEl("div", {cls: "emily-date-inputs"});

		this.startInput = custom.createEl("input", {type: "date"});
		this.startInput.addEventListener("change", () => this.onDateInput());

		custom.createEl("span", {cls: "emily-date-sep", text: "to"});

		this.endInput = custom.createEl("input", {type: "date"});
		this.endInput.addEventListener("change", () => this.onDateInput());

		// Section toggles
		const sections = this.toolbarEl.createEl("div", {cls: "emily-section-toggles"});
		for (const [key, label] of [["correlation", "Correlations"], ["heatmap", "Heatmap"], ["timeOfDay", "Time of day"]] as const) {
			const btn = sections.createEl("button", {
				cls: "emily-preset-btn",
				text: label,
			});
			btn.addEventListener("click", () => {
				this.sectionToggles[key] = !this.sectionToggles[key];
				this.persist();
				this.syncToolbar();
				this.render();
			});
			this.sectionBtns.set(key, btn);
		}

		this.syncToolbar();
	}

	/** Bring the toolbar in line with the current range and sections without rebuilding it. */
	private syncToolbar(force = false): void {
		for (const [days, btn] of this.presetBtns) {
			btn.toggleClass("emily-preset-active", this.presetDays === days);
		}
		for (const [key, btn] of this.sectionBtns) {
			btn.toggleClass("emily-preset-active", this.sectionToggles[key]);
		}
		this.dateInputsEl.toggleClass("emily-preset-active", this.presetDays === null);

		// Leave a field alone while it is being edited, unless a preset just replaced the range
		const start = formatDateKey(this.dateRange.start);
		if ((force || document.activeElement !== this.startInput) && this.startInput.value !== start) {
			this.startInput.value = start;
		}
		const end = formatDateKey(this.dateRange.end);
		if ((force || document.activeElement !== this.endInput) && this.endInput.value !== end) {
			this.endInput.value = end;
		}
	}

	private onDateInput(): void {
		const start = this.startInput.value;
		const end = this.endInput.value;
		// Half-typed dates (an empty field, a year of 0002) are not a choice yet
		if (!isUsableDateKey(start) || !isUsableDateKey(end)) return;

		this.dateRange = {start: startOfDay(start), end: endOfDay(end)};
		this.presetDays = null;
		this.persist();
		void this.refresh();
	}

	/** Turn topics on or off, then redraw and remember the choice. */
	private setTopicsEnabled(names: string[], enabled: boolean): void {
		for (const name of names) {
			if (enabled) this.enabledTopics.add(name);
			else this.enabledTopics.delete(name);
		}
		this.persist();
		this.buildLegend();
		this.render();
	}

	/** Topics by category, in name order, with uncategorized topics last. A topic in two categories is listed in both. */
	private groupTopics(): [string, ResolvedTopic[]][] {
		const byGroup = new Map<string, ResolvedTopic[]>();
		const ungrouped: ResolvedTopic[] = [];
		for (const topic of this.topics) {
			if (topic.config.group.length === 0) {
				ungrouped.push(topic);
				continue;
			}
			for (const group of new Set(topic.config.group)) {
				const list = byGroup.get(group);
				if (list) list.push(topic);
				else byGroup.set(group, [topic]);
			}
		}
		const groups = [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
		if (ungrouped.length > 0) groups.push([UNGROUPED, ungrouped]);
		return groups;
	}

	private buildLegend(): void {
		this.legendEl.empty();
		if (this.topics.length === 0) return;

		const groups = this.groupTopics();
		const names = this.topics.map(t => t.name);

		// Everything on or off
		const allEnabled = names.every(n => this.enabledTopics.has(n));
		const allRow = this.legendEl.createEl("div", {cls: "emily-legend-group"});
		const toggleAll = allRow.createEl("button", {
			cls: "emily-legend-item emily-toggle-all",
			text: allEnabled ? "None" : "All",
		});
		toggleAll.addEventListener("click", () => this.setTopicsEnabled(names, !allEnabled));

		for (const [group, groupTopics] of groups) {
			const row = this.legendEl.createEl("div", {cls: "emily-legend-group"});

			// A lone "Other" row needs no switch of its own: All/None already covers it
			if (groups.length > 1 || group !== UNGROUPED) {
				const groupNames = groupTopics.map(t => t.name);
				const enabledCount = groupNames.filter(n => this.enabledTopics.has(n)).length;
				const allGroupEnabled = enabledCount === groupNames.length;
				const groupBtn = row.createEl("button", {
					cls: "emily-legend-item emily-toggle-group",
					text: group,
				});
				groupBtn.setAttribute("aria-pressed", String(allGroupEnabled));
				groupBtn.setAttribute("aria-label", allGroupEnabled ? `Hide all ${group} topics` : `Show all ${group} topics`);
				if (enabledCount === 0) groupBtn.addClass("emily-legend-disabled");
				else if (!allGroupEnabled) groupBtn.addClass("emily-legend-partial");
				groupBtn.addEventListener("click", () => this.setTopicsEnabled(groupNames, !allGroupEnabled));
			}

			const items = row.createEl("div", {cls: "emily-legend-topics"});
			for (const topic of groupTopics) {
				const enabled = this.enabledTopics.has(topic.name);
				const item = items.createEl("button", {cls: "emily-legend-item"});
				item.style.setProperty("--emily-topic-color", topic.config.color);
				if (!enabled) item.addClass("emily-legend-disabled");

				const dot = item.createEl("span", {cls: "emily-legend-dot"});
				dot.style.backgroundColor = topic.config.color;

				item.createEl("span", {text: topic.name});

				item.addEventListener("click", () => this.setTopicsEnabled([topic.name], !enabled));
			}
		}
	}

	private hasInitialized = false;

	private async refresh(): Promise<void> {
		// A rolling range keeps up with today when the view stays open overnight
		if (this.presetDays !== null) this.dateRange = rangeForDays(this.presetDays);

		this.topics = await this.dataService.loadData(this.dateRange);

		if (!this.hasInitialized) {
			// First load: enable topics with tracking_visible_default: true,
			// falling back to the default enabled group if none are marked visible
			const visibleDefaults = this.topics.filter(t => t.config.visibleDefault);
			if (visibleDefaults.length > 0) {
				this.enabledTopics = new Set(visibleDefaults.map(t => t.name));
			} else {
				const group = this.plugin.settings.defaultEnabledGroup;
				if (group) {
					this.enabledTopics = new Set(
						this.topics.filter(t => t.config.group.some(g => g.toLowerCase() === group.toLowerCase())).map(t => t.name)
					);
				}
			}
			this.hasInitialized = true;
		}

		this.syncToolbar();
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

		const textHover = (text: string | null, x: number, y: number, date?: string) => this.showTextTooltip(text, x, y, date);

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
				this.persist();
				this.render();
			},
			onAggregateChange: (name, mode) => {
				this.aggOverrides.set(name, mode);
				this.persist();
				this.render();
			},
		});
	}

	private scheduleHideTooltip(): void {
		if (this.tooltipHideTimeout) clearTimeout(this.tooltipHideTimeout);
		this.tooltipHideTimeout = setTimeout(() => {
			this.tooltipEl.style.display = "none";
			this.tooltipHideTimeout = null;
		}, 150);
	}

	private cancelHideTooltip(): void {
		if (this.tooltipHideTimeout) {
			clearTimeout(this.tooltipHideTimeout);
			this.tooltipHideTimeout = null;
		}
	}

	private showTooltip(entry: TrackingEntry | null, x: number, y: number): void {
		if (!entry) {
			this.scheduleHideTooltip();
			return;
		}

		this.cancelHideTooltip();
		const topic = this.getDisplayTopics().find(t => t.name === entry.topic);
		const color = topic?.config.color ?? "#888";

		this.tooltipEl.empty();
		this.tooltipEl.style.display = "block";

		const header = this.tooltipEl.createEl("div", {cls: "emily-tooltip-header"});
		const dot = header.createEl("span", {cls: "emily-tooltip-dot"});
		dot.style.backgroundColor = color;
		const unit = topic?.config.unit ? ` ${topic.config.unit}` : "";
		const displayVal = Number.isInteger(entry.value) ? entry.value : Math.round(entry.value * 10) / 10;
	header.createEl("strong", {text: `${entry.topic}: ${displayVal}${unit}`});

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
		this.positionTooltip(x, y);
	}

	private showTextTooltip(text: string | null, x: number, y: number, date?: string): void {
		if (!text) {
			this.scheduleHideTooltip();
			return;
		}

		this.cancelHideTooltip();
		this.tooltipEl.empty();
		this.tooltipEl.style.display = "block";

		for (const line of text.split("\n")) {
			this.tooltipEl.createEl("div", {text: line});
		}

		if (date) {
			const dateLink = this.tooltipEl.createEl("a", {cls: "emily-tooltip-date-link", text: date});
			dateLink.addEventListener("click", (e) => {
				e.preventDefault();
				this.openDate(date);
			});
		}

		this.positionTooltip(x, y);
	}

	private openDate(date: string): void {
		const topics = this.getDisplayTopics();
		for (const t of topics) {
			const entry = t.entries.find(e => e.date === date);
			if (entry) {
				this.openSource(entry);
				return;
			}
		}
	}

	private positionTooltip(x: number, y: number): void {
		const viewRect = this.contentEl.getBoundingClientRect();
		let left = x - viewRect.left + 10;
		let top = y - viewRect.top + this.contentEl.scrollTop - 10;

		// Keep tooltip in bounds
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
		a.download = `emily-${formatDateKey(this.dateRange.start)}-to-${formatDateKey(this.dateRange.end)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	private setRange(days: number): void {
		this.presetDays = days;
		this.dateRange = rangeForDays(days);
		this.syncToolbar(true);
		this.persist();
		void this.refresh();
	}
}
