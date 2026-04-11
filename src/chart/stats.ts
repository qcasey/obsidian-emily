import * as d3 from "d3";
import type {DateRange, ResolvedTopic} from "../types";
import type {ChartTheme} from "./theme";

interface StatsOptions {
	topics: ResolvedTopic[];
	enabledTopics: Set<string>;
	range: DateRange;
	theme: ChartTheme;
	onDisplayTypeChange: (topicName: string, type: "range" | "spike" | "spike_full") => void;
	onAggregateChange: (topicName: string, mode: "none" | "sum" | "average") => void;
}

export function renderStats(container: HTMLElement, options: StatsOptions): void {
	const {topics, enabledTopics, range, theme, onDisplayTypeChange, onAggregateChange} = options;
	container.empty();

	const visibleTopics = topics.filter(t => enabledTopics.has(t.name));

	if (visibleTopics.length === 0) return;

	const grid = container.createEl("div", {cls: "emily-stats-grid"});

	for (const topic of visibleTopics) {
		const entries = topic.entries;
		if (entries.length === 0) continue;

		const card = grid.createEl("div", {cls: "emily-stat-card"});
		card.style.borderLeftColor = topic.config.color;

		const header = card.createEl("div", {cls: "emily-stat-header"});
		const dot = header.createEl("span", {cls: "emily-stat-dot"});
		dot.style.backgroundColor = topic.config.color;
		header.createEl("span", {cls: "emily-stat-name", text: topic.name});

		const controls = header.createEl("div", {cls: "emily-stat-controls"});

		const typeSelect = controls.createEl("select", {cls: "emily-type-select"});
		for (const opt of ["range", "spike", "spike_full"] as const) {
			const el = typeSelect.createEl("option", {value: opt, text: opt});
			if (topic.config.displayType === opt) el.selected = true;
		}
		typeSelect.addEventListener("change", () => {
			onDisplayTypeChange(topic.name, typeSelect.value as "range" | "spike" | "spike_full");
		});

		const aggSelect = controls.createEl("select", {cls: "emily-type-select"});
		for (const opt of [["none", "raw"], ["sum", "sum/day"], ["average", "avg/day"]] as const) {
			const el = aggSelect.createEl("option", {value: opt[0], text: opt[1]});
			if (topic.config.aggregate === opt[0]) el.selected = true;
		}
		aggSelect.addEventListener("change", () => {
			onAggregateChange(topic.name, aggSelect.value as "none" | "sum" | "average");
		});

		const body = card.createEl("div", {cls: "emily-stat-body"});

		const values = entries.map(e => e.value);

		const unit = topic.config.unit;

		if (topic.config.displayType === "range") {
			renderRangeStats(body, values, entries, unit);
		} else { // spike and spike_full
			renderSpikeStats(body, values, entries, range, unit);
		}

		// Sparkline
		const sparkContainer = card.createEl("div", {cls: "emily-sparkline"});
		renderSparkline(sparkContainer, entries, topic.config.color);
	}
}

function renderRangeStats(
	el: HTMLElement,
	values: number[],
	entries: {value: number; timestamp: number}[],
	unit: string,
): void {
	const latest = entries[entries.length - 1];
	const avg = d3.mean(values) ?? 0;
	const min = d3.min(values) ?? 0;
	const max = d3.max(values) ?? 0;
	const u = unit ? ` ${unit}` : "";

	const metrics = el.createEl("div", {cls: "emily-stat-metrics"});

	addMetric(metrics, "Current", (latest?.value.toFixed(1) ?? "-") + u);
	addMetric(metrics, "Average", avg.toFixed(1) + u);
	addMetric(metrics, "Min", min + u);
	addMetric(metrics, "Max", max + u);
	addMetric(metrics, "Entries", String(entries.length));

	// Trend: compare last third vs first third of entries
	if (entries.length >= 3) {
		const third = Math.floor(entries.length / 3);
		const earlyAvg = d3.mean(entries.slice(0, third).map(e => e.value)) ?? 0;
		const lateAvg = d3.mean(entries.slice(-third).map(e => e.value)) ?? 0;
		const diff = lateAvg - earlyAvg;
		const arrow = diff > 0.3 ? "\u2191" : diff < -0.3 ? "\u2193" : "\u2192";
		addMetric(metrics, "Trend", arrow);
	}
}

function renderSpikeStats(
	el: HTMLElement,
	values: number[],
	entries: {value: number; timestamp: number; date: string}[],
	range: DateRange,
	unit: string,
): void {
	const total = d3.sum(values);
	const uniqueDays = new Set(entries.map(e => e.date)).size;
	const totalDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86400000));
	const dailyAvg = total / totalDays;
	const u = unit ? ` ${unit}` : "";

	const metrics = el.createEl("div", {cls: "emily-stat-metrics"});

	addMetric(metrics, "Total", (total % 1 === 0 ? String(total) : total.toFixed(1)) + u);
	addMetric(metrics, "Daily avg", dailyAvg.toFixed(1) + u);
	addMetric(metrics, "Days active", `${uniqueDays}/${totalDays}`);
	addMetric(metrics, "Entries", String(entries.length));
}

function addMetric(container: HTMLElement, label: string, value: string): void {
	const metric = container.createEl("div", {cls: "emily-metric"});
	metric.createEl("span", {cls: "emily-metric-value", text: value});
	metric.createEl("span", {cls: "emily-metric-label", text: label});
}

function renderSparkline(container: HTMLElement, entries: {value: number; timestamp: number}[], color: string): void {
	if (entries.length < 2) return;

	const width = 120;
	const height = 30;

	const svg = d3.select(container)
		.append("svg")
		.attr("width", width)
		.attr("height", height)
		.attr("viewBox", `0 0 ${width} ${height}`);

	const xScale = d3.scaleLinear()
		.domain(d3.extent(entries, d => d.timestamp) as [number, number])
		.range([2, width - 2]);

	const yExtent = d3.extent(entries, d => d.value) as [number, number];
	const yPadding = (yExtent[1] - yExtent[0]) * 0.15 || 1;
	const yScale = d3.scaleLinear()
		.domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
		.range([height - 2, 2]);

	const line = d3.line<{value: number; timestamp: number}>()
		.x(d => xScale(d.timestamp))
		.y(d => yScale(d.value))
		.curve(d3.curveMonotoneX);

	svg.append("path")
		.datum(entries)
		.attr("fill", "none")
		.attr("stroke", color)
		.attr("stroke-width", 1.5)
		.attr("d", line);
}
