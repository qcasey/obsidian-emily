import * as d3 from "d3";
import type {ResolvedTopic} from "../types";
import type {ChartTheme} from "./theme";

export interface CorrelationOptions {
	topics: ResolvedTopic[];
	enabledTopics: Set<string>;
	theme: ChartTheme;
	onHover: (text: string | null, x: number, y: number, date?: string) => void;
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
	container.createEl("div", {
		cls: "emily-correlation-desc",
		text: "Each chart shows how two topics move together day-by-day. Dots closer to the trend line mean a stronger relationship. A positive slope means both rise together; a negative slope means one falls as the other rises.",
	});

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

			// Pearson r + interpretation
			const r = pearsonR(points);
			const {strength, detail} = interpretR(r, tA.name, tB.name);
			const label = cell.createEl("div", {cls: "emily-correlation-label"});
			const top = label.createEl("div");
			top.createEl("span", {cls: "emily-correlation-r", text: `r = ${r.toFixed(2)}`});
			top.createEl("span", {text: ` · ${strength}`});
			label.createEl("div", {text: detail});
		}
	}
}

function pearsonR(points: {x: number; y: number}[]): number {
	const n = points.length;
	if (n < 2) return 0;
	const xMean = d3.mean(points, d => d.x) ?? 0;
	const yMean = d3.mean(points, d => d.y) ?? 0;
	let num = 0, denX = 0, denY = 0;
	for (const p of points) {
		const dx = p.x - xMean;
		const dy = p.y - yMean;
		num += dx * dy;
		denX += dx * dx;
		denY += dy * dy;
	}
	const den = Math.sqrt(denX * denY);
	return den === 0 ? 0 : num / den;
}

function interpretR(r: number, nameX: string, nameY: string): {strength: string; detail: string} {
	const abs = Math.abs(r);
	if (abs < 0.2) return {strength: "Very weak", detail: `${nameX} and ${nameY} don't clearly move together.`};
	if (abs < 0.4) {
		return r >= 0
			? {strength: "Weak positive", detail: `${nameX} and ${nameY} slightly tend to rise together.`}
			: {strength: "Weak negative", detail: `When ${nameX} goes up, ${nameY} slightly tends to go down.`};
	}
	if (abs < 0.6) {
		return r >= 0
			? {strength: "Moderate positive", detail: `${nameX} and ${nameY} somewhat rise and fall together.`}
			: {strength: "Moderate negative", detail: `${nameX} tends to fall when ${nameY} rises.`};
	}
	if (abs < 0.8) {
		return r >= 0
			? {strength: "Strong positive", detail: `${nameX} and ${nameY} clearly rise and fall together.`}
			: {strength: "Strong negative", detail: `${nameX} clearly falls when ${nameY} rises.`};
	}
	return r >= 0
		? {strength: "Very strong positive", detail: `${nameX} and ${nameY} move almost in lockstep.`}
		: {strength: "Very strong negative", detail: `${nameX} and ${nameY} move almost perfectly opposite.`};
}

function renderScatter(
	container: HTMLElement,
	topicX: ResolvedTopic,
	topicY: ResolvedTopic,
	points: {x: number; y: number; date: string}[],
	theme: ChartTheme,
	onHover: (text: string | null, x: number, y: number, date?: string) => void,
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
		.attr("font-weight", "bold")
		.text(topicX.name);

	svg.append("text")
		.attr("transform", `rotate(-90)`)
		.attr("x", -height / 2)
		.attr("y", 12)
		.attr("text-anchor", "middle")
		.attr("fill", topicY.config.color)
		.attr("font-size", "11px")
		.attr("font-weight", "bold")
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
			const rx = Math.round(d.x * 10) / 10;
			const ry = Math.round(d.y * 10) / 10;
			onHover(`${topicX.name}: ${rx}\n${topicY.name}: ${ry}`, r.left + r.width / 2, r.top, d.date);
		})
		.on("mouseout", function () {
			d3.select(this).attr("r", 4);
			onHover(null, 0, 0);
		});
}
