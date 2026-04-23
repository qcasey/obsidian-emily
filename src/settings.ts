import {App, PluginSettingTab, Setting} from "obsidian";
import type EmilyPlugin from "./main";
import type {EmilySettings} from "./types";

export class EmilySettingTab extends PluginSettingTab {
	plugin: EmilyPlugin;

	constructor(app: App, plugin: EmilyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Daily notes folder")
			.setDesc("Leave empty to auto-detect from Daily Notes or Periodic Notes plugin")
			.addText(text => text
				.setPlaceholder("e.g. Daily Notes")
				.setValue(this.plugin.settings.dailyNotesFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Daily notes format")
			.setDesc("Moment.js date format for daily note filenames (auto-detected if empty)")
			.addText(text => text
				.setPlaceholder("YYYY-MM-DD")
				.setValue(this.plugin.settings.dailyNotesFormat)
				.onChange(async (value) => {
					this.plugin.settings.dailyNotesFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Default date range")
			.setDesc("Number of days to show by default")
			.addDropdown(drop => drop
				.addOptions({"7": "7 days", "14": "14 days", "30": "30 days", "90": "90 days"})
				.setValue(String(this.plugin.settings.defaultDateRangeDays))
				.onChange(async (value) => {
					this.plugin.settings.defaultDateRangeDays = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Log section heading")
			.setDesc("The heading text that marks the start of log entries in daily notes")
			.addText(text => text
				.setPlaceholder("Log")
				.setValue(this.plugin.settings.logSectionHeading)
				.onChange(async (value) => {
					this.plugin.settings.logSectionHeading = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Auto-embed on daily notes")
			.setDesc("Automatically show a tracking chart at the bottom of daily notes")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoEmbed)
				.onChange(async (value) => {
					this.plugin.settings.autoEmbed = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Auto-embed topics")
			.setDesc("Comma-separated topic names to show in auto-embed (empty = all visible_default topics)")
			.addText(text => text
				.setPlaceholder("Mood, Anxiety, Caffeine")
				.setValue(this.plugin.settings.autoEmbedTopics)
				.onChange(async (value) => {
					this.plugin.settings.autoEmbedTopics = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Frequency-sorted link suggest")
			.setDesc("Show link suggestions sorted by usage frequency after inserting a timestamp")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.frequencySuggestEnabled)
				.onChange(async (value) => {
					this.plugin.settings.frequencySuggestEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Default enabled group")
			.setDesc("Group to enable on first load when no topics have tracking_visible_default set")
			.addText(text => text
				.setPlaceholder("mood")
				.setValue(this.plugin.settings.defaultEnabledGroup)
				.onChange(async (value) => {
					this.plugin.settings.defaultEnabledGroup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Narration inherit window")
			.setDesc("Entries without narration inherit from the nearest entry within this many minutes (0 = disabled)")
			.addText(text => text
				.setPlaceholder("0")
				.setValue(String(this.plugin.settings.narrationInheritMinutes))
				.onChange(async (value) => {
					const num = parseInt(value, 10);
					this.plugin.settings.narrationInheritMinutes = isNaN(num) ? 0 : Math.max(0, num);
					await this.plugin.saveSettings();
				}));
	}
}
