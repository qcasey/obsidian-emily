import {App, TFile, moment} from "obsidian";
import type {DateRange, EmilySettings, ResolvedTopic, TopicConfig, TrackingEntry} from "./types";
import {DEFAULT_SCALE_MAX, hashTopicColor} from "./types";
import {parseLogEntries} from "./parser";

export class DataService {
	constructor(
		private app: App,
		private settings: EmilySettings,
	) {}

	isDailyNote(filePath: string): boolean {
		const {folder, format} = this.getDailyNotesConfig();
		let datePart: string;
		if (folder) {
			if (!filePath.startsWith(folder + "/")) return false;
			datePart = filePath.slice(folder.length + 1, -3);
		} else {
			datePart = filePath.slice(0, -3);
		}
		return moment(datePart, format, true).isValid();
	}

	async loadData(range: DateRange): Promise<ResolvedTopic[]> {
		const entries = await this.collectEntries(range);
		const allTimeEntries = await this.collectEntries(null);
		return this.resolveTopics(entries, allTimeEntries);
	}

	private async collectEntries(range: DateRange | null): Promise<TrackingEntry[]> {
		const {folder, format} = this.getDailyNotesConfig();
		const allFiles = this.app.vault.getMarkdownFiles();
		const entries: TrackingEntry[] = [];

		for (const file of allFiles) {
			// Get the path relative to the daily notes folder (without .md extension)
			let datePart: string;
			if (folder) {
				if (!file.path.startsWith(folder + "/")) continue;
				datePart = file.path.slice(folder.length + 1, -3);
			} else {
				datePart = file.path.slice(0, -3);
			}

			const parsed = moment(datePart, format, true);
			if (!parsed.isValid()) continue;

			if (range) {
				const fileDate = parsed.toDate();
				if (fileDate < range.start || fileDate > range.end) continue;
			}

			const content = await this.app.vault.cachedRead(file);
			const dateStr = parsed.format("YYYY-MM-DD");
			const fileEntries = parseLogEntries(content, dateStr, file.path, this.settings.logSectionHeading);
			entries.push(...fileEntries);
		}

		return entries.sort((a, b) => a.timestamp - b.timestamp);
	}

	private resolveTopics(entries: TrackingEntry[], allTimeEntries: TrackingEntry[]): ResolvedTopic[] {
		const topicMap = new Map<string, TrackingEntry[]>();
		for (const entry of entries) {
			const existing = topicMap.get(entry.topic);
			if (existing) {
				existing.push(entry);
			} else {
				topicMap.set(entry.topic, [entry]);
			}
		}

		// Compute all-time max per topic for normalization
		const allTimeMax = new Map<string, number>();
		for (const entry of allTimeEntries) {
			const cur = allTimeMax.get(entry.topic) ?? 0;
			if (entry.value > cur) allTimeMax.set(entry.topic, entry.value);
		}

		const topics: ResolvedTopic[] = [];
		for (const [name, topicEntries] of topicMap) {
			const config = this.getTopicConfig(name);
			if (config.enabled) {
				const histMax = config.max ?? allTimeMax.get(name) ?? DEFAULT_SCALE_MAX;
				topics.push({name, config, entries: topicEntries, historicalMax: histMax});
			}
		}

		return topics.sort((a, b) => a.name.localeCompare(b.name));
	}

	private getTopicConfig(topicName: string): TopicConfig {
		const file = this.app.metadataCache.getFirstLinkpathDest(topicName, "");
		const defaults: TopicConfig = {
			color: hashTopicColor(topicName),
			enabled: true,
			visibleDefault: false,
			displayType: "range",
			unit: "",
			max: null,
			min: null,
			subtle: false,
			subtleOpacity: 0.6,
			group: "",
			aggregate: "none",
			heatmapGradient: true,
		};

		if (!file) return defaults;

		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) return defaults;

		const maxVal = fm["tracking_max"];
		const minVal = fm["tracking_min"];

		return {
			color: (fm["tracking_color"] as string) || defaults.color,
			enabled: fm["tracking_enabled"] !== false,
			visibleDefault: fm["tracking_visible_default"] === true,
			displayType: (fm["tracking_type"] === "spike" || fm["tracking_type"] === "spike_full") ? fm["tracking_type"] as "spike" | "spike_full" : "range",
			unit: (fm["tracking_unit"] as string) || "",
			max: typeof maxVal === "number" ? maxVal : null,
			min: typeof minVal === "number" ? minVal : null,
			subtle: fm["tracking_subtle"] === true,
			subtleOpacity: typeof fm["tracking_subtle_opacity"] === "number" ? fm["tracking_subtle_opacity"] : 0.6,
			group: (fm["tracking_group"] as string) || "",
			aggregate: (fm["tracking_aggregate"] === "sum" || fm["tracking_aggregate"] === "average") ? fm["tracking_aggregate"] : "none",
			heatmapGradient: fm["tracking_heatmap_gradient"] !== false,
		};
	}

	private getDailyNotesConfig(): {folder: string; format: string} {
		// Try core Daily Notes plugin
		const dailyNotes = (this.app as any).internalPlugins?.getPluginById?.("daily-notes");
		if (dailyNotes?.enabled) {
			const opts = dailyNotes.instance?.options;
			if (opts) {
				return {
					folder: opts.folder || this.settings.dailyNotesFolder,
					format: opts.format || this.settings.dailyNotesFormat,
				};
			}
		}

		// Try Periodic Notes community plugin
		const periodic = (this.app as any).plugins?.getPlugin?.("periodic-notes");
		if (periodic) {
			const dailyConfig = periodic.settings?.daily;
			if (dailyConfig) {
				return {
					folder: dailyConfig.folder || this.settings.dailyNotesFolder,
					format: dailyConfig.format || this.settings.dailyNotesFormat,
				};
			}
		}

		return {
			folder: this.settings.dailyNotesFolder,
			format: this.settings.dailyNotesFormat,
		};
	}
}
