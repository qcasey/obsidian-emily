import type {DateRange, ResolvedTopic} from "../types";

interface HeatmapOptions {
	topics: ResolvedTopic[];
	enabledTopics: Set<string>;
	range: DateRange;
	onHover: (text: string | null, x: number, y: number, date?: string) => void;
}

const CELL_SIZE = 18;
const CELL_GAP = 3;

export function renderHeatmap(container: HTMLElement, options: HeatmapOptions): void {
	const {topics, enabledTopics, range, onHover} = options;
	container.empty();

	const visible = topics.filter(t => enabledTopics.has(t.name));
	if (visible.length === 0) return;

	const totalDays = Math.round((range.end.getTime() - range.start.getTime()) / 86400000);
	if (totalDays < 7) return;

	container.createEl("div", {cls: "emily-section-title", text: "Heatmap"});

	const grid = container.createEl("div", {cls: "emily-heatmap-grid"});

	for (const topic of visible) {
		const cell = grid.createEl("div", {cls: "emily-heatmap-cell"});
		renderTopicHeatmap(cell, topic, range, onHover);
	}
}

function renderTopicHeatmap(
	container: HTMLElement,
	topic: ResolvedTopic,
	range: DateRange,
	onHover: (text: string | null, x: number, y: number, date?: string) => void,
): void {
	// Build daily values — collect per-date then aggregate
	const dateEntries = new Map<string, number[]>();
	for (const e of topic.entries) {
		const existing = dateEntries.get(e.date);
		if (existing) existing.push(e.value);
		else dateEntries.set(e.date, [e.value]);
	}

	const dailyValues = new Map<string, number>();
	for (const [date, vals] of dateEntries) {
		if (topic.config.displayType === "range") {
			dailyValues.set(date, vals.reduce((a, b) => a + b, 0) / vals.length);
		} else {
			dailyValues.set(date, vals.reduce((a, b) => a + b, 0));
		}
	}

	const values = [...dailyValues.values()];
	const maxVal = values.reduce((a, b) => Math.max(a, b), 1);
	const useGradient = topic.config.heatmapGradient;

	// Generate all dates in range
	const dates: {str: string; dayOfWeek: number}[] = [];
	const d = new Date(range.start);
	while (d <= range.end) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		dates.push({str: `${y}-${m}-${day}`, dayOfWeek: d.getDay()});
		d.setDate(d.getDate() + 1);
	}

	const firstDayOfWeek = dates[0]?.dayOfWeek ?? 0;

	// Topic label
	container.createEl("div", {
		cls: "emily-heatmap-label",
		text: topic.name,
	}).style.color = topic.config.color;

	// Wrapper: day-of-week labels + grid side by side
	const wrapper = container.createEl("div", {cls: "emily-heatmap-wrapper"});

	// Day-of-week labels column
	const labelsCol = wrapper.createEl("div", {cls: "emily-heatmap-day-labels"});
	for (const label of ["S", "M", "T", "W", "T", "F", "S"]) {
		labelsCol.createEl("div", {cls: "emily-heatmap-day-label", text: label});
	}

	// CSS Grid for day cells
	const gridEl = wrapper.createEl("div", {cls: "emily-heatmap-days"});
	gridEl.style.gridTemplateRows = `repeat(7, ${CELL_SIZE}px)`;
	gridEl.style.gridAutoColumns = `${CELL_SIZE}px`;
	gridEl.style.gap = `${CELL_GAP}px`;

	// Placeholder cells for first-week offset
	for (let i = 0; i < firstDayOfWeek; i++) {
		gridEl.createEl("div", {cls: "emily-heatmap-day emily-heatmap-day--empty"});
	}

	// Render each date cell
	for (const dateInfo of dates) {
		const val = dailyValues.get(dateInfo.str);
		const hasData = val !== undefined;
		const dayEl = gridEl.createEl("div", {cls: "emily-heatmap-day"});

		if (!hasData) {
			dayEl.addClass("emily-heatmap-day--no-data");
		} else if (useGradient) {
			dayEl.style.backgroundColor = topic.config.color;
			dayEl.style.opacity = String(Math.max(0.25, val / maxVal));
		} else {
			dayEl.style.backgroundColor = topic.config.color;
		}

		if (hasData) dayEl.style.cursor = "pointer";

		const label = hasData
			? `${topic.name}: ${Math.round(val * 10) / 10}`
			: `no data`;
		dayEl.addEventListener("mouseenter", (event: MouseEvent) => {
			const rect = (event.target as HTMLElement).getBoundingClientRect();
			onHover(label, rect.left + rect.width / 2, rect.top, dateInfo.str);
		});
		dayEl.addEventListener("mouseleave", () => onHover(null, 0, 0));
	}
}
