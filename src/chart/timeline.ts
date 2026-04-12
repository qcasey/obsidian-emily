import * as d3 from "d3";
import type {ResolvedTopic, TrackingEntry} from "../types";
import {DEFAULT_SCALE_MAX} from "../types";
import type {ChartTheme} from "./theme";

interface TimelineOptions {
	topics: ResolvedTopic[];
	enabledTopics: Set<string>;
	theme: ChartTheme;
	onHover: (entry: TrackingEntry | null, x: number, y: number) => void;
	onClick: (entry: TrackingEntry) => void;
}

const MARGIN = {top: 20, right: 20, bottom: 40, left: 45};

function aggregateEntries(entries: TrackingEntry[], mode: "sum" | "average"): TrackingEntry[] {
	const byDate = new Map<string, TrackingEntry[]>();
	for (const e of entries) {
		const existing = byDate.get(e.date);
		if (existing) existing.push(e);
		else byDate.set(e.date, [e]);
	}

	const result: TrackingEntry[] = [];
	for (const [, dayEntries] of byDate) {
		const values = dayEntries.map(e => e.value);
		const aggValue = mode === "sum"
			? values.reduce((a, b) => a + b, 0)
			: values.reduce((a, b) => a + b, 0) / values.length;

		// Use noon of that day as the timestamp for the aggregated point
		const base = dayEntries[0] as TrackingEntry;
		const [year, month, day] = base.date.split("-").map(Number);
		const noonTimestamp = new Date(year as number, (month as number) - 1, day, 12, 0).getTime();

		const narrations = dayEntries.filter(e => e.narration).map(e => `${e.time}: ${e.narration}`);

		result.push({
			...base,
			value: Math.round(aggValue * 10) / 10,
			timestamp: noonTimestamp,
			time: mode === "sum" ? `${dayEntries.length} entries` : `avg of ${dayEntries.length}`,
			narration: narrations.join(" | "),
		});
	}

	return result.sort((a, b) => a.timestamp - b.timestamp);
}

export function renderTimeline(container: HTMLElement, options: TimelineOptions): void {
	const {topics, enabledTopics, theme, onHover, onClick} = options;

	container.empty();

	// Determine if multi-day
	const xExtentRaw = d3.extent(topics.flatMap(t => t.entries), d => d.timestamp) as [number, number];
	const isMultiDay = (xExtentRaw[1] - xExtentRaw[0]) > 86400000;

	// Apply aggregation for multi-day views
	const visibleTopics = topics.filter(t => enabledTopics.has(t.name)).map(t => {
		if (isMultiDay && t.config.aggregate !== "none") {
			return {...t, entries: aggregateEntries(t.entries, t.config.aggregate)};
		}
		return t;
	});

	const allEntries = visibleTopics.flatMap(t => t.entries);

	if (allEntries.length === 0) {
		const empty = container.createEl("div", {cls: "emily-chart-empty"});
		empty.setText("No data for the selected range and topics.");
		return;
	}

	const rect = container.getBoundingClientRect();
	const width = rect.width;
	const height = Math.min(Math.max(rect.height, 250), 500);

	const svg = d3.select(container)
		.append("svg")
		.attr("width", width)
		.attr("height", height)
		.attr("viewBox", `0 0 ${width} ${height}`);

	const innerWidth = width - MARGIN.left - MARGIN.right;
	const innerHeight = height - MARGIN.top - MARGIN.bottom;

	const g = svg.append("g")
		.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

	// Build a normalize function: maps each topic's raw value to 0–DEFAULT_SCALE_MAX
	const normMap = new Map<string, (v: number) => number>();
	for (const t of visibleTopics) {
		const tMin = t.config.min ?? 0;
		const visibleMax = d3.max(t.entries, e => e.value) ?? 0;
		const tMax = Math.max(t.historicalMax || DEFAULT_SCALE_MAX, visibleMax);
		const range = tMax - tMin || 1;
		normMap.set(t.name, (v: number) => ((v - tMin) / range) * DEFAULT_SCALE_MAX);
	}
	const normalize = (topic: string, value: number) => (normMap.get(topic) ?? ((v: number) => v))(value);

	// Scales
	const xExtent = d3.extent(allEntries, d => d.timestamp) as [number, number];
	const xScale = d3.scaleTime()
		.domain([new Date(xExtent[0]), new Date(xExtent[1])])
		.range([0, innerWidth]);

	const yScale = d3.scaleLinear()
		.domain([0, DEFAULT_SCALE_MAX * 1.05])
		.range([innerHeight, 0]);

	// Grid
	g.append("g")
		.attr("class", "emily-grid")
		.selectAll("line")
		.data(yScale.ticks(5))
		.join("line")
		.attr("x1", 0)
		.attr("x2", innerWidth)
		.attr("y1", d => yScale(d))
		.attr("y2", d => yScale(d))
		.attr("stroke", theme.gridLine)
		.attr("stroke-dasharray", "3,3");

	// Axes
	const xAxis = d3.axisBottom(xScale)
		.ticks(Math.min(innerWidth / 80, 10))
		.tickFormat(d => d3.timeFormat("%-m/%-d")(d as Date));

	g.append("g")
		.attr("transform", `translate(0,${innerHeight})`)
		.call(xAxis)
		.attr("color", theme.textMuted);

	const yAxis = d3.axisLeft(yScale).ticks(5);
	g.append("g")
		.call(yAxis)
		.attr("color", theme.textMuted);

	// Draw each topic — subtle topics first so they render behind
	const sortedTopics = [...visibleTopics].sort((a, b) => (a.config.subtle ? 0 : 1) - (b.config.subtle ? 0 : 1));

	for (const topic of sortedTopics) {
		const color = topic.config.color;
		const sorted = [...topic.entries].sort((a, b) => a.timestamp - b.timestamp);
		const subtle = topic.config.subtle;
		const sOp = topic.config.subtleOpacity;

		const topicName = topic.name;

		// Auto-spike: if only 1 entry and type is range, render as spike instead of a lone dot
		const effectiveType = (sorted.length === 1 && topic.config.displayType === "range")
			? "spike" as const
			: topic.config.displayType;

		if (effectiveType === "range") {
			// Line
			const line = d3.line<TrackingEntry>()
				.x(d => xScale(new Date(d.timestamp)))
				.y(d => yScale(normalize(topicName, d.value)))
				.curve(d3.curveMonotoneX);

			g.append("path")
				.datum(sorted)
				.attr("fill", "none")
				.attr("stroke", color)
				.attr("stroke-width", subtle ? 1 : 2)
				.attr("opacity", subtle ? sOp : 1)
				.attr("d", line);

			// Points
			g.selectAll(null)
				.data(sorted)
				.join("circle")
				.attr("cx", d => xScale(new Date(d.timestamp)))
				.attr("cy", d => yScale(normalize(topicName, d.value)))
				.attr("r", subtle ? 2.5 : 4)
				.attr("fill", color)
				.attr("stroke", theme.background)
				.attr("stroke-width", subtle ? 0.5 : 1.5)
				.attr("opacity", subtle ? sOp : 1)
				.attr("class", "emily-data-point")
				.style("cursor", "pointer");
		} else if (effectiveType === "spike_full") {
			// Full-height spike lines
			g.selectAll(null)
				.data(sorted)
				.join("line")
				.attr("x1", d => xScale(new Date(d.timestamp)))
				.attr("x2", d => xScale(new Date(d.timestamp)))
				.attr("y1", 0)
				.attr("y2", innerHeight)
				.attr("stroke", color)
				.attr("stroke-width", subtle ? 1 : 2)
				.attr("opacity", subtle ? sOp * 0.7 : 0.5);

			// Dot at normalized value
			g.selectAll(null)
				.data(sorted)
				.join("circle")
				.attr("cx", d => xScale(new Date(d.timestamp)))
				.attr("cy", d => yScale(normalize(topicName, d.value)))
				.attr("r", subtle ? 4 : 6)
				.attr("fill", color)
				.attr("opacity", subtle ? sOp : 1)
				.attr("class", "emily-data-point")
				.style("cursor", "pointer");
		} else {
			// Spikes
			g.selectAll(null)
				.data(sorted)
				.join("line")
				.attr("x1", d => xScale(new Date(d.timestamp)))
				.attr("x2", d => xScale(new Date(d.timestamp)))
				.attr("y1", yScale(0))
				.attr("y2", d => yScale(normalize(topicName, d.value)))
				.attr("stroke", color)
				.attr("stroke-width", subtle ? 1.5 : 3)
				.attr("stroke-linecap", "round")
				.attr("opacity", subtle ? sOp : 0.8);

			// Spike tops
			g.selectAll(null)
				.data(sorted)
				.join("circle")
				.attr("cx", d => xScale(new Date(d.timestamp)))
				.attr("cy", d => yScale(normalize(topicName, d.value)))
				.attr("r", subtle ? 2.5 : 4)
				.attr("fill", color)
				.attr("opacity", subtle ? sOp : 1)
				.attr("class", "emily-data-point")
				.style("cursor", "pointer");
		}
	}

	// Hover overlay
	const allPoints = visibleTopics.flatMap(t =>
		t.entries.map(e => ({entry: e, topic: t}))
	);

	const overlay = g.append("rect")
		.attr("width", innerWidth)
		.attr("height", innerHeight)
		.attr("fill", "none")
		.attr("pointer-events", "all");

	function findNearest(mouseX: number, mouseY: number): TrackingEntry | null {
		const xDate = xScale.invert(mouseX);
		const xTime = xDate.getTime();

		let closest: {entry: TrackingEntry; dist: number} | null = null;

		for (const {entry, topic} of allPoints) {
			const px = xScale(new Date(entry.timestamp));
			const py = yScale(normalize(topic.name, entry.value));
			const dist = Math.sqrt((px - mouseX) ** 2 + (py - mouseY) ** 2);

			if (dist < 30 && (!closest || dist < closest.dist)) {
				closest = {entry, dist};
			}
		}

		return closest?.entry ?? null;
	}

	overlay.on("mousemove touchstart", function (event: MouseEvent | TouchEvent) {
		const [mx, my] = d3.pointer(event, this as SVGRectElement);
		const entry = findNearest(mx, my);
		const svgRect = (svg.node() as SVGSVGElement).getBoundingClientRect();
		onHover(entry, svgRect.left + MARGIN.left + mx, svgRect.top + MARGIN.top + my);
	});

	overlay.on("mouseleave touchend", () => {
		onHover(null, 0, 0);
	});

	overlay.on("click", function (event: MouseEvent) {
		const [mx, my] = d3.pointer(event, this as SVGRectElement);
		const entry = findNearest(mx, my);
		if (entry) onClick(entry);
	});
}
