import type {App} from "obsidian";
import type {EmilySettings, ResolvedTopic, TrackingEntry} from "./types";
import {DataService} from "./data-service";
import {renderTimeline} from "./chart/timeline";
import {renderStats} from "./chart/stats";
import {getTheme} from "./chart/theme";

interface EmbedConfig {
	days: number;
	topics: string[] | null; // null = all
	showStats: boolean;
	showChart: boolean;
	showLegend: boolean;
}

function parseConfig(source: string): EmbedConfig {
	const config: EmbedConfig = {
		days: 7,
		topics: null,
		showStats: true,
		showChart: true,
		showLegend: true,
	};

	for (const line of source.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const [key, ...rest] = trimmed.split(":");
		const value = rest.join(":").trim();

		switch (key?.trim()) {
			case "days":
				config.days = parseInt(value, 10) || 7;
				break;
			case "topics":
				config.topics = value.split(",").map(t => t.trim()).filter(t => t);
				break;
			case "stats":
				config.showStats = value !== "false";
				break;
			case "chart":
				config.showChart = value !== "false";
				break;
			case "legend":
				config.showLegend = value !== "false";
				break;
		}
	}

	return config;
}

export async function renderEmbed(
	source: string,
	container: HTMLElement,
	app: App,
	settings: EmilySettings,
): Promise<void> {
	const config = parseConfig(source);
	const dataService = new DataService(app, settings);

	const now = new Date();
	const start = new Date(now);
	start.setDate(start.getDate() - (config.days - 1));
	start.setHours(0, 0, 0, 0);
	const end = new Date(now);
	end.setHours(23, 59, 59, 999);

	const range = {start, end};
	const allTopics = await dataService.loadData(range);

	let topics: ResolvedTopic[];
	if (config.topics) {
		const allowed = new Set(config.topics);
		topics = allTopics.filter(t => allowed.has(t.name));
	} else {
		topics = allTopics.filter(t => t.config.visibleDefault);
	}

	const enabledTopics = new Set(topics.map(t => t.name));

	container.empty();
	container.addClass("emily-embed");

	const theme = getTheme(container);

	const tooltipEl = container.createEl("div", {cls: "emily-tooltip"});
	tooltipEl.style.display = "none";

	const showTooltip = (entry: TrackingEntry | null, x: number, y: number) => {
		if (!entry) {
			tooltipEl.style.display = "none";
			return;
		}
		const topic = topics.find(t => t.name === entry.topic);
		const color = topic?.config.color ?? "#888";
		const unit = topic?.config.unit ? ` ${topic.config.unit}` : "";

		tooltipEl.empty();
		tooltipEl.style.display = "block";

		const header = tooltipEl.createEl("div", {cls: "emily-tooltip-header"});
		const dot = header.createEl("span", {cls: "emily-tooltip-dot"});
		dot.style.backgroundColor = color;
		header.createEl("strong", {text: `${entry.topic}: ${entry.value}${unit}`});

		tooltipEl.createEl("div", {
			cls: "emily-tooltip-time",
			text: `${entry.time} \u2014 ${entry.date}`,
		});

		if (entry.narration) {
			tooltipEl.createEl("div", {cls: "emily-tooltip-narration", text: entry.narration});
		}

		const rect = container.getBoundingClientRect();
		let left = x - rect.left + 10;
		let top = y - rect.top - 10;
		if (left + 220 > rect.width) left = left - 240;
		if (top < 0) top = 10;
		tooltipEl.style.left = `${left}px`;
		tooltipEl.style.top = `${top}px`;
	};

	if (config.showLegend) {
		const legendEl = container.createEl("div", {cls: "emily-legend"});
		for (const topic of topics) {
			const item = legendEl.createEl("span", {cls: "emily-legend-item"});
			item.style.setProperty("--emily-topic-color", topic.config.color);
			const dot = item.createEl("span", {cls: "emily-legend-dot"});
			dot.style.backgroundColor = topic.config.color;
			item.createEl("span", {text: topic.name});
		}
	}

	if (config.showChart) {
		const chartEl = container.createEl("div", {cls: "emily-chart"});
		renderTimeline(chartEl, {
			topics,
			enabledTopics,
			theme,
			onHover: showTooltip,
			onClick: () => {},
		});
	}

	if (config.showStats) {
		const statsEl = container.createEl("div", {cls: "emily-stats"});
		renderStats(statsEl, {
			topics,
			enabledTopics,
			range,
			theme,
			onDisplayTypeChange: () => {},
			onAggregateChange: () => {},
		});
	}
}
