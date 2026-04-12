import * as d3 from "d3";
import type {ResolvedTopic} from "../types";
import type {ChartTheme} from "./theme";

export interface CorrelationOptions {
	topics: ResolvedTopic[];
	enabledTopics: Set<string>;
	theme: ChartTheme;
	onHover: (text: string | null, x: number, y: number) => void;
}

const MARGIN = {top: 30, right: 20, bottom: 45, left: 50};

export function renderCorrelation(container: HTMLElement, options: CorrelationOptions): void {
	const {topics, enabledTopics, theme, onHover} = options;
	container.empty();

	const visible = topics.filter(t => enabledTopics.has(t.name));
	if (visible.length < 2) return;

	// Build daily averages per topic
	const dailyAvgs = new Map<string, Map<string, number>>(); // topic -> date -> avg
	for (const t of visible) {
		const byDate = new Map<string, number[]>();
		for (const e of t.entries) {
			const existing = byDate.get(e.date);
			if (existing) existing.push(e.value);
			else byDate.set(e.date, [e.value]);
		}
		const avgs = new Map<string, number>();
		for (const [date, vals] of byDate) {
			avgs.set(date, vals.reduce((a, b) => a + b, 0) / vals.length);
		}
		dailyAvgs.set(t.name, avgs);
	}

	// Create a scatter for each pair of topics (limit to first 4 to avoid overload)
	const corrTopics = visible.slice(0, 4);
	if (corrTopics.length < 2) return;

	const title = container.createEl("div", {cls: "emily-section-title", text: "Correlations"});

	const grid = container.createEl("div", {cls: "emily-correlation-grid"});

	for (let i = 0; i < corrTopics.length; i++) {
		for (let j = i + 1; j < corrTopics.length; j++) {
			const tA = corrTopics[i] as ResolvedTopic;
			const tB = corrTopics[j] as ResolvedTopic;
			const avgsA = dailyAvgs.get(tA.name);
			const avgsB = dailyAvgs.get(tB.name);
			if (!avgsA || !avgsB) continue;

			// Find common dates
			const points: {x: number; y: number; date: string}[] = [];
			for (const [date, valA] of avgsA) {
				const valB = avgsB.get(date);
				if (valB !== undefined) {
					points.push({x: valA, y: valB, date});
				}
			}

			if (points.length < 2) continue;

			const cell = grid.createEl("div", {cls: "emily-correlation-cell"});
			renderScatter(cell, tA, tB, points, theme, onHover);
		}
	}
}

function renderScatter(
	container: HTMLElement,
	topicX: ResolvedTopic,
	topicY: ResolvedTopic,
	points: {x: number; y: number; date: string}[],
	theme: ChartTheme,
	onHover: (text: string | null, x: number, y: number) => void,
): void {
	const width = 260;
	const height = 220;

	const svg = d3.select(container)
		.append("svg")
		.attr("width", "100%")
		.attr("height", height)
		.attr("viewBox", `0 0 ${width} ${height}`);

	const innerW = width - MARGIN.left - MARGIN.right;
	const innerH = height - MARGIN.top - MARGIN.bottom;

	const g = svg.append("g")
		.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

	const xExtent = d3.extent(points, d => d.x) as [number, number];
	const yExtent = d3.extent(points, d => d.y) as [number, number];
	const xPad = (xExtent[1] - xExtent[0]) * 0.1 || 1;
	const yPad = (yExtent[1] - yExtent[0]) * 0.1 || 1;

	const xScale = d3.scaleLinear()
		.domain([xExtent[0] - xPad, xExtent[1] + xPad])
		.range([0, innerW]);

	const yScale = d3.scaleLinear()
		.domain([yExtent[0] - yPad, yExtent[1] + yPad])
		.range([innerH, 0]);

	// Axes
	g.append("g")
		.attr("transform", `translate(0,${innerH})`)
		.call(d3.axisBottom(xScale).ticks(4))
		.attr("color", theme.textMuted);

	g.append("g")
		.call(d3.axisLeft(yScale).ticks(4))
		.attr("color", theme.textMuted);

	// Labels
	svg.append("text")
		.attr("x", width / 2)
		.attr("y", height - 4)
		.attr("text-anchor", "middle")
		.attr("fill", topicX.config.color)
		.attr("font-size", "11px")
		.text(topicX.name);

	svg.append("text")
		.attr("transform", `rotate(-90)`)
		.attr("x", -height / 2)
		.attr("y", 12)
		.attr("text-anchor", "middle")
		.attr("fill", topicY.config.color)
		.attr("font-size", "11px")
		.text(topicY.name);

	// Trend line
	if (points.length >= 3) {
		const xMean = d3.mean(points, d => d.x) ?? 0;
		const yMean = d3.mean(points, d => d.y) ?? 0;
		let num = 0, den = 0;
		for (const p of points) {
			num += (p.x - xMean) * (p.y - yMean);
			den += (p.x - xMean) ** 2;
		}
		if (den !== 0) {
			const slope = num / den;
			const intercept = yMean - slope * xMean;
			const x1 = xExtent[0] - xPad;
			const x2 = xExtent[1] + xPad;
			g.append("line")
				.attr("x1", xScale(x1))
				.attr("y1", yScale(slope * x1 + intercept))
				.attr("x2", xScale(x2))
				.attr("y2", yScale(slope * x2 + intercept))
				.attr("stroke", theme.textMuted)
				.attr("stroke-width", 1)
				.attr("stroke-dasharray", "4,4")
				.attr("opacity", 0.5);
		}
	}

	// Points
	g.selectAll("circle")
		.data(points)
		.join("circle")
		.attr("cx", d => xScale(d.x))
		.attr("cy", d => yScale(d.y))
		.attr("r", 4)
		.attr("fill", topicX.config.color)
		.attr("opacity", 0.7)
		.style("cursor", "pointer")
		.on("mouseover", function (event: MouseEvent, d) {
			d3.select(this).attr("r", 6);
			const r = (event.target as SVGElement).getBoundingClientRect();
			onHover(`${d.date}\n${topicX.name}: ${d.x}\n${topicY.name}: ${d.y}`, r.left + r.width / 2, r.top);
		})
		.on("mouseout", function () {
			d3.select(this).attr("r", 4);
			onHover(null, 0, 0);
		});
}
