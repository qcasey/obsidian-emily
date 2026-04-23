import * as d3 from "d3";
import type {ResolvedTopic} from "../types";
import type {ChartTheme} from "./theme";

interface TimeOfDayOptions {
	topics: ResolvedTopic[];
	enabledTopics: Set<string>;
	theme: ChartTheme;
	onHover: (text: string | null, x: number, y: number, date?: string) => void;
}

const MARGIN = {top: 20, right: 20, bottom: 35, left: 45};

export function renderTimeOfDay(container: HTMLElement, options: TimeOfDayOptions): void {
	const {topics, enabledTopics, theme, onHover} = options;
	container.empty();

	const visible = topics.filter(t => enabledTopics.has(t.name));
	if (visible.length === 0) return;

	const allEntries = visible.flatMap(t => t.entries);
	if (allEntries.length < 3) return;

	container.createEl("div", {cls: "emily-section-title", text: "Time of day"});

	const rect = container.getBoundingClientRect();
	const width = rect.width;
	const height = 200;

	const svg = d3.select(container)
		.append("svg")
		.attr("width", width)
		.attr("height", height)
		.attr("viewBox", `0 0 ${width} ${height}`);

	const innerW = width - MARGIN.left - MARGIN.right;
	const innerH = height - MARGIN.top - MARGIN.bottom;

	const g = svg.append("g")
		.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

	// X scale: 0-24 hours
	const xScale = d3.scaleLinear().domain([0, 24]).range([0, innerW]);

	// For each topic, create a histogram of entry times
	const hourBins = 24;

	// Y scale: max density across all topics
	let globalMax = 0;
	const topicHistograms = new Map<string, number[]>();

	for (const topic of visible) {
		const counts = new Array(hourBins).fill(0) as number[];
		for (const e of topic.entries) {
			const h = parseInt(e.time.split(":")[0] ?? "0", 10);
			if (h >= 0 && h < 24) counts[h] = (counts[h] ?? 0) + 1;
		}
		topicHistograms.set(topic.name, counts);
		const max = d3.max(counts) ?? 0;
		if (max > globalMax) globalMax = max;
	}

	const yScale = d3.scaleLinear()
		.domain([0, globalMax * 1.1 || 1])
		.range([innerH, 0]);

	// Grid
	g.append("g")
		.attr("class", "emily-grid")
		.selectAll("line")
		.data(yScale.ticks(3))
		.join("line")
		.attr("x1", 0)
		.attr("x2", innerW)
		.attr("y1", d => yScale(d))
		.attr("y2", d => yScale(d))
		.attr("stroke", theme.gridLine)
		.attr("stroke-dasharray", "3,3");

	// X axis
	const xAxis = d3.axisBottom(xScale)
		.tickValues([0, 3, 6, 9, 12, 15, 18, 21, 24])
		.tickFormat(d => {
			const h = d as number;
			if (h === 0 || h === 24) return "12a";
			if (h === 12) return "12p";
			return h < 12 ? `${h}a` : `${h - 12}p`;
		});

	g.append("g")
		.attr("transform", `translate(0,${innerH})`)
		.call(xAxis)
		.attr("color", theme.textMuted);

	g.append("g")
		.call(d3.axisLeft(yScale).ticks(3))
		.attr("color", theme.textMuted);

	// Draw area curves for each topic
	const barWidth = innerW / hourBins;

	for (const topic of visible) {
		const counts = topicHistograms.get(topic.name);
		if (!counts) continue;

		const points = counts.map((c, i) => ({hour: i + 0.5, count: c}));

		const area = d3.area<{hour: number; count: number}>()
			.x(d => xScale(d.hour))
			.y0(innerH)
			.y1(d => yScale(d.count))
			.curve(d3.curveMonotoneX);

		g.append("path")
			.datum(points)
			.attr("fill", topic.config.color)
			.attr("opacity", 0.2)
			.attr("d", area);

		const line = d3.line<{hour: number; count: number}>()
			.x(d => xScale(d.hour))
			.y(d => yScale(d.count))
			.curve(d3.curveMonotoneX);

		g.append("path")
			.datum(points)
			.attr("fill", "none")
			.attr("stroke", topic.config.color)
			.attr("stroke-width", 1.5)
			.attr("d", line);
	}

	// Hover overlay
	const overlay = g.append("rect")
		.attr("width", innerW)
		.attr("height", innerH)
		.attr("fill", "none")
		.attr("pointer-events", "all");

	overlay.on("mousemove touchstart", function (event: MouseEvent | TouchEvent) {
		const [mx] = d3.pointer(event, this as SVGRectElement);
		const hour = Math.floor(xScale.invert(mx));
		if (hour < 0 || hour >= 24) { onHover(null, 0, 0); return; }

		const lines: string[] = [];
		const h = hour % 12 || 12;
		const ampm = hour < 12 ? "am" : "pm";
		lines.push(`${h}:00 ${ampm}`);
		for (const topic of visible) {
			const counts = topicHistograms.get(topic.name);
			const count = counts?.[hour] ?? 0;
			if (count > 0) lines.push(`${topic.name}: ${count} entries`);
		}

		const svgRect = (svg.node() as SVGSVGElement).getBoundingClientRect();
		onHover(lines.join("\n"), svgRect.left + MARGIN.left + mx, svgRect.top + MARGIN.top);
	});

	overlay.on("mouseleave touchend", () => onHover(null, 0, 0));
}
