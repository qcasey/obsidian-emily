import * as d3 from "d3";
import type {DateRange, ResolvedTopic} from "../types";
import type {ChartTheme} from "./theme";

interface HeatmapOptions {
	topics: ResolvedTopic[];
	enabledTopics: Set<string>;
	range: DateRange;
	theme: ChartTheme;
	onHover: (text: string | null, x: number, y: number) => void;
}

const CELL_SIZE = 14;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;

export function renderHeatmap(container: HTMLElement, options: HeatmapOptions): void {
	const {topics, enabledTopics, range, theme, onHover} = options;
	container.empty();

	const visible = topics.filter(t => enabledTopics.has(t.name));
	if (visible.length === 0) return;

	const totalDays = Math.round((range.end.getTime() - range.start.getTime()) / 86400000);
	if (totalDays < 7) return;

	container.createEl("div", {cls: "emily-section-title", text: "Heatmap"});

	const grid = container.createEl("div", {cls: "emily-heatmap-grid"});

	for (const topic of visible) {
		const cell = grid.createEl("div", {cls: "emily-heatmap-cell"});
		renderTopicHeatmap(cell, topic, range, theme, onHover);
	}
}

function renderTopicHeatmap(
	container: HTMLElement,
	topic: ResolvedTopic,
	range: DateRange,
	theme: ChartTheme,
	onHover: (text: string | null, x: number, y: number) => void,
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
	const maxVal = d3.max(values) ?? 1;
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

	// Layout: 7 rows (day of week), columns are weeks
	// First date goes at its actual day-of-week position
	const firstDayOfWeek = dates[0]?.dayOfWeek ?? 0;
	const totalCols = Math.ceil((dates.length + firstDayOfWeek) / 7);
	const labelWidth = 16;
	const width = totalCols * CELL_STEP + labelWidth + 4;
	const height = 7 * CELL_STEP;

	container.createEl("div", {
		cls: "emily-heatmap-label",
		text: topic.name,
	}).style.color = topic.config.color;

	const svg = d3.select(container)
		.append("svg")
		.attr("width", "100%")
		.attr("height", height)
		.attr("viewBox", `0 0 ${width} ${height}`);

	const colorScale = d3.scaleSequential()
		.domain([0, maxVal])
		.interpolator(d3.interpolateRgb(theme.gridLine, topic.config.color));

	const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
	for (let i = 0; i < 7; i++) {
		svg.append("text")
			.attr("x", 0)
			.attr("y", i * CELL_STEP + CELL_SIZE - 2)
			.attr("fill", theme.textMuted)
			.attr("font-size", "9px")
			.text(dayLabels[i] as string);
	}

	for (let i = 0; i < dates.length; i++) {
		const dateInfo = dates[i] as {str: string; dayOfWeek: number};
		const col = Math.floor((i + firstDayOfWeek) / 7);
		const row = dateInfo.dayOfWeek;
		const val = dailyValues.get(dateInfo.str);
		const hasData = val !== undefined;

		let fill: string;
		let opacity: number;

		if (!hasData) {
			fill = theme.gridLine;
			opacity = 0.15;
		} else if (useGradient) {
			// Color gradient from grid to topic color
			fill = colorScale(val);
			opacity = Math.max(0.3, val / maxVal);
		} else {
			// Solid topic color, opacity = presence (on/off)
			fill = topic.config.color;
			opacity = 1;
		}

		const r = svg.append("rect")
			.attr("x", labelWidth + col * CELL_STEP)
			.attr("y", row * CELL_STEP)
			.attr("width", CELL_SIZE)
			.attr("height", CELL_SIZE)
			.attr("rx", 2)
			.attr("fill", fill)
			.attr("opacity", opacity)
			.style("cursor", hasData ? "pointer" : "default");

		const label = hasData
			? `${topic.name}: ${Math.round(val * 10) / 10}\n${dateInfo.str}`
			: `${dateInfo.str}: no data`;
		r.on("mouseover", function (event: MouseEvent) {
			const rect = (event.target as SVGElement).getBoundingClientRect();
			onHover(label, rect.left + rect.width / 2, rect.top);
		}).on("mouseout", () => onHover(null, 0, 0));
	}
}
